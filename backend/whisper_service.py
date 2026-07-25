import os
import gc
import logging
import time
import threading
import psutil
from typing import Dict, Any, Optional, Tuple
import numpy as np
import torch
import whisperx
import whisper  # OpenAI Whisper library
from faster_whisper import WhisperModel as FWModel  # Faster-Whisper library
from config import settings

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("whisper_service")

class ResourceMonitor(threading.Thread):
    def __init__(self, interval=0.1):
        super().__init__()
        self.interval = interval
        self.running = True
        self.process = psutil.Process(os.getpid())
        
        # Peaks
        self.max_cpu = 0.0
        self.max_ram_process_mb = 0.0
        
    def run(self):
        # Reset peak memory stats in torch if GPU is available
        if torch.cuda.is_available():
            try:
                torch.cuda.reset_peak_memory_stats(0)
            except Exception:
                pass
                
        # Dry run for cpu percent to clear first 0.0 reading
        try:
            psutil.cpu_percent(interval=None)
        except Exception:
            pass
            
        while self.running:
            try:
                # Get current CPU percent
                cpu = psutil.cpu_percent(interval=None)
                if cpu > self.max_cpu:
                    self.max_cpu = cpu
                    
                # Get current process RAM RSS memory usage in MB
                ram_mb = self.process.memory_info().rss / 1024 / 1024
                if ram_mb > self.max_ram_process_mb:
                    self.max_ram_process_mb = ram_mb
            except Exception:
                pass
            time.sleep(self.interval)
            
    def stop(self):
        self.running = False

def convert_types(obj: Any) -> Any:
    """Recursively convert numpy data types to native Python types for JSON compatibility."""
    if isinstance(obj, dict):
        return {k: convert_types(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_types(i) for i in obj]
    elif isinstance(obj, (np.float64, np.float32, np.float16)):
        return float(obj)
    elif isinstance(obj, (np.int64, np.int32, np.int16, np.int8)):
        return int(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    else:
        return obj

class WhisperService:
    def __init__(self):
        self._transcribe_models: Dict[str, Any] = {}
        self._openai_models: Dict[str, Any] = {}
        self._fw_models: Dict[str, Any] = {}
        self._align_models: Dict[str, Tuple[Any, Any]] = {}
        self._diarize_pipelines: Dict[str, Any] = {}
        
        # Full GPU Execution (NVIDIA CUDA)
        # All stages (transcription, alignment, diarization) run on GPU with CUDA support.
        self.gpu_available = torch.cuda.is_available()
        self.transcribe_device = "cuda" if self.gpu_available else "cpu"
        self.transcribe_compute_type = "float16" if self.transcribe_device == "cuda" else "int8"
        self.pytorch_device = "cuda" if self.gpu_available else "cpu"
        
        self.abort_requested = False
        self.transcribe_thread_id = None
        self.current_stage = "Idle"
        self.current_progress = ""
        
        self._detect_hardware()

    def check_abort(self):
        if self.abort_requested:
            logger.warning("Transcription process aborted by user.")
            raise RuntimeError("Process aborted by user")

    def abort(self):
        self.abort_requested = True
        if hasattr(self, 'transcribe_thread_id') and self.transcribe_thread_id:
            tid = self.transcribe_thread_id
            logger.warning(f"Forcing abort in transcription thread: {tid}")
            
            import ctypes
            res = ctypes.pythonapi.PyThreadState_SetAsyncExc(
                ctypes.c_long(tid), 
                ctypes.py_object(RuntimeError)
            )
            if res == 0:
                logger.error(f"Failed to raise abort exception: thread {tid} not found.")
            elif res > 1:
                ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_long(tid), None)
                logger.error("PyThreadState_SetAsyncExc failed (returned > 1)")

    import contextlib
    @contextlib.contextmanager
    def tqdm_progress(self):
        import tqdm
        original_init = tqdm.tqdm.__init__
        original_update = tqdm.tqdm.update
        original_display = tqdm.tqdm.display
        self_service = self
        
        def custom_init(self_tqdm, *args, **kwargs):
            # Force disable=False so update() is called and self_tqdm.n increments
            kwargs['disable'] = False
            original_init(self_tqdm, *args, **kwargs)
            self_tqdm.is_captured = True
            
        def custom_update(self_tqdm, n=1):
            original_update(self_tqdm, n)
            try:
                if getattr(self_tqdm, 'is_captured', False) and self_tqdm.total:
                    total = self_tqdm.total
                    current = self_tqdm.n
                    unit = getattr(self_tqdm, 'unit', '')
                    
                    if unit == "seconds" or unit == "s":
                        current_sec = current
                        total_sec = total
                    elif total > 100000:
                        current_sec = current / 16000.0
                        total_sec = total / 16000.0
                    elif total > 1000:
                        current_sec = current / 100.0
                        total_sec = total / 100.0
                    else:
                        current_sec = None
                        total_sec = None
                        
                    if current_sec is not None and total_sec is not None and total_sec > 0:
                        pct = (current / total) * 100
                        mins_curr = int(current_sec // 60)
                        secs_curr = int(current_sec % 60)
                        mins_tot = int(total_sec // 60)
                        secs_tot = int(total_sec % 60)
                        
                        self_service.current_progress = (
                            f"Procesado: {mins_curr:02d}:{secs_curr:02d} / "
                            f"{mins_tot:02d}:{secs_tot:02d} ({pct:.0f}%)"
                        )
                    else:
                        pct = (current / total) * 100 if total else 0.0
                        self_service.current_progress = (
                            f"Procesado: {current} de {total} ({pct:.0f}%)"
                        )
            except Exception:
                pass
                
        def custom_display(self_tqdm, *args, **kwargs):
            # No-op to suppress terminal output
            pass
            
        tqdm.tqdm.__init__ = custom_init
        tqdm.tqdm.update = custom_update
        tqdm.tqdm.display = custom_display
        try:
            yield
        finally:
            tqdm.tqdm.__init__ = original_init
            tqdm.tqdm.update = original_update
            tqdm.tqdm.display = original_display

    def _detect_hardware(self):
        """Log hardware configurations and log warning constraints."""
        logger.info("=== Whisper CUDA Execution Suite ===")
        logger.info(f"PyTorch CUDA available: {self.gpu_available}")
        if self.gpu_available:
            logger.info(f"NVIDIA GPU Detected: {torch.cuda.get_device_name(0)}")
            logger.info("GPU ('cuda') will be utilized for: Transcription, Phoneme Alignment & Speaker Diarization")
        else:
            logger.warning("No GPU detected. CPU fallback active for all steps.")
            
        logger.info(f"CTranslate2/PyTorch running on device: {self.transcribe_device} (Precision: {self.transcribe_compute_type})")
        logger.info("=======================================")

    def get_openai_model(self, model_name: str) -> Any:
        """Cache and retrieve native OpenAI Whisper model on GPU (or CPU if GPU unavailable)."""
        cache_key = f"{model_name}_{self.pytorch_device}"
        
        if cache_key not in self._openai_models:
            logger.info(f"Loading native OpenAI Whisper model '{model_name}' on device '{self.pytorch_device}'...")
            self._openai_models.clear()
            self._clear_memory()
            
            # Load Whisper model using native PyTorch (supports ROCm on Windows)
            self._openai_models[cache_key] = whisper.load_model(
                model_name, 
                device=self.pytorch_device
            )
            logger.info(f"Native OpenAI Whisper model '{model_name}' loaded successfully.")
            
        return self._openai_models[cache_key]

    def get_fw_model(self, model_name: str) -> Any:
        """Cache and retrieve native Faster-Whisper model on GPU/CPU."""
        cache_key = f"{model_name}_{self.transcribe_device}_{self.transcribe_compute_type}"
        
        if cache_key not in self._fw_models:
            logger.info(f"Loading native Faster-Whisper model '{model_name}' on '{self.transcribe_device}' with '{self.transcribe_compute_type}'...")
            self._fw_models.clear()
            self._clear_memory()
            
            self._fw_models[cache_key] = FWModel(
                model_name,
                device=self.transcribe_device,
                compute_type=self.transcribe_compute_type
            )
            logger.info(f"Native Faster-Whisper model '{model_name}' loaded successfully on {self.transcribe_device.upper()}.")
            
        return self._fw_models[cache_key]

    def get_transcribe_model(self, model_name: str) -> Any:
        """Cache and retrieve WhisperX transcription models on GPU/CPU."""
        cache_key = f"{model_name}_{self.transcribe_device}_{self.transcribe_compute_type}"
        
        if cache_key not in self._transcribe_models:
            logger.info(f"Loading WhisperX transcription model '{model_name}' on '{self.transcribe_device}' with '{self.transcribe_compute_type}'...")
            self._transcribe_models.clear()
            self._clear_memory()
            
            self._transcribe_models[cache_key] = whisperx.load_model(
                model_name, 
                device=self.transcribe_device, 
                compute_type=self.transcribe_compute_type
            )
            logger.info(f"WhisperX transcription model '{model_name}' loaded successfully on {self.transcribe_device.upper()}.")
            
        return self._transcribe_models[cache_key]

    def get_alignment_model(self, language_code: str) -> Tuple[Any, Any]:
        """Cache and retrieve WhisperX alignment models on GPU (if available)."""
        cache_key = f"{language_code}_{self.pytorch_device}"
        
        if cache_key not in self._align_models:
            logger.info(f"Loading alignment model for language '{language_code}' on device '{self.pytorch_device}'...")
            try:
                model_a, metadata = whisperx.load_align_model(
                    language_code=language_code, 
                    device=self.pytorch_device
                )
                self._align_models[cache_key] = (model_a, metadata)
                logger.info(f"Alignment model for language '{language_code}' loaded successfully.")
            except Exception as e:
                logger.error(f"Failed to load alignment model for language '{language_code}': {str(e)}")
                raise e
                
        return self._align_models[cache_key]

    def get_diarization_pipeline(self, hf_token: str) -> Any:
        """Cache and retrieve Pyannote Diarization pipelines.
        
        Runs on GPU if available.
        """
        diarize_device = self.pytorch_device
        cache_key = f"{hf_token}_{diarize_device}"
        
        if cache_key not in self._diarize_pipelines:
            logger.info(f"Loading Diarization Pipeline on device '{diarize_device}'...")
            self._diarize_pipelines.clear()
            self._clear_memory()
            
            from whisperx.diarize import DiarizationPipeline
            self._diarize_pipelines[cache_key] = DiarizationPipeline(
                token=hf_token, 
                device=diarize_device
            )
            logger.info(f"Diarization Pipeline loaded successfully on {diarize_device.upper()}.")
            
        return self._diarize_pipelines[cache_key]

    def _clear_memory(self):
        """Perform garbage collection, offload cached models, and clear GPU VRAM cache aggressively."""
        self._transcribe_models.clear()
        self._openai_models.clear()
        self._fw_models.clear()
        self._align_models.clear()
        self._diarize_pipelines.clear()
        
        import gc
        gc.collect()
        gc.collect()
        if self.gpu_available:
            try:
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
            except Exception:
                pass

    def get_status(self) -> Dict[str, Any]:
        """Get system status and hardware detection metrics."""
        cpu_percent = 0.0
        ram_mb = 0.0
        try:
            process = psutil.Process(os.getpid())
            cpu_percent = psutil.cpu_percent(interval=None)
            ram_mb = process.memory_info().rss / 1024 / 1024
        except Exception:
            pass

        vram_allocated_mb = 0.0
        vram_reserved_mb = 0.0

        if self.gpu_available:
            try:
                # Measure true physical VRAM used by the GPU (including PyTorch, CTranslate2, Ollama, X11, etc.)
                free_bytes, total_bytes = torch.cuda.mem_get_info(0)
                used_bytes = total_bytes - free_bytes
                vram_allocated_mb = round(used_bytes / 1024 / 1024, 2)
                vram_reserved_mb = round(torch.cuda.memory_reserved(0) / 1024 / 1024, 2)
            except Exception:
                vram_allocated_mb = round(torch.cuda.memory_allocated(0) / 1024 / 1024, 2)

        is_running = (self.current_stage not in ["Idle", "Listo / En espera", ""])
        stage = self.current_stage if is_running else "Idle"
        progress = self.current_progress if is_running else ""

        return {
            "is_running": is_running,
            "configured_device": settings.device,
            "transcribe_device": self.transcribe_device,
            "pytorch_device": self.pytorch_device,
            "cuda_available": self.gpu_available,
            "device_name": torch.cuda.get_device_name(0) if self.gpu_available else "N/A",
            "vram_allocated_mb": vram_allocated_mb,
            "vram_reserved_mb": vram_reserved_mb,
            "cpu_percent": round(cpu_percent, 1),
            "ram_process_mb": round(ram_mb, 1),
            "current_stage": stage,
            "current_progress": progress
        }

    def transcribe(
        self, 
        audio_path: str, 
        backend: str = "whisperx",
        model_name: Optional[str] = None,
        language: Optional[str] = None,
        align: bool = True,
        diarize: bool = False,
        hf_token_override: Optional[str] = None,
        min_speakers: Optional[int] = None,
        max_speakers: Optional[int] = None
    ) -> Dict[str, Any]:
        """Run transcription pipeline using selected backend (WhisperX, native Whisper, or Faster-Whisper)."""
        model_name = model_name or settings.whisper_model
        hf_token = hf_token_override or settings.hf_token
        
        logger.info(f"Starting transcription request: backend={backend}, file={audio_path}, model={model_name}")
        
        # Clear any leftover GPU memory from previous runs before starting a new one
        self._clear_memory()
        try:
            from rag_service import rag_service
            rag_service.unload_embedding_model()
        except Exception as e:
            logger.warning(f"Failed to unload embedding model inside whisper service: {str(e)}")
        
        self.abort_requested = False
        self.transcribe_thread_id = threading.get_ident()
        self.current_stage = "transcribing"
        self.current_progress = "Iniciando monitor de recursos..."
        
        # Start background resource monitor
        monitor = ResourceMonitor()
        monitor.start()
        
        from gpu_lock import gpu_lock
        gpu_lock_context = gpu_lock.acquire(f"Whisper Transcription ({backend}/{model_name})")
        gpu_lock_context.__enter__()
        
        try:
            self.check_abort()
            
            if backend == "whisper":
                # NATIVE OPENAI WHISPER ON GPU (ROCm)
                logger.info(f"Loading native OpenAI Whisper on GPU: {self.pytorch_device}")
                self.current_progress = f"Cargando modelo OpenAI Whisper '{model_name}'..."
                
                # 1. Model Loading Time
                start_load = time.time()
                model = self.get_openai_model(model_name)
                load_time = time.time() - start_load
                self.check_abort()
                
                # 2. Transcription Time
                self.current_progress = "Transcribiendo con OpenAI Whisper..."
                start_trans = time.time()
                transcribe_options = {
                    "word_timestamps": align,  # Returns word-level timestamps directly from model attention
                    "verbose": False            # Enable tqdm natively by setting verbose=False
                }
                if language:
                    transcribe_options["language"] = language
                    
                with self.tqdm_progress():
                    raw_result = model.transcribe(audio_path, **transcribe_options)
                trans_time = time.time() - start_trans
                detected_language = raw_result.get("language")
                self.check_abort()
                
                # Format output to match UI expected schema
                result = {
                    "language": detected_language,
                    "segments": raw_result.get("segments", []),
                    "word_timestamps_aligned": align,
                    "speaker_diarized": False,
                    "warnings": []
                }
                
                if diarize:
                    msg = "Diarization is only supported under the 'whisperx' backend."
                    logger.warning(msg)
                    result["warnings"].append(msg)
                    
                # Compute total words
                total_words = 0
                for seg in result["segments"]:
                    if "words" in seg and seg["words"]:
                        total_words += len(seg["words"])
                    else:
                        total_words += len(seg.get("text", "").split())
                        
                audio_duration = result["segments"][-1]["end"] if result["segments"] else 0.0
                
                # Get VRAM peak
                max_vram = 0.0
                if self.gpu_available:
                    try:
                        max_vram = torch.cuda.max_memory_allocated(0) / 1024 / 1024
                    except Exception:
                        pass
                    
                result["metrics"] = {
                    "model_load_time_seconds": round(load_time, 2),
                    "transcription_time_seconds": round(trans_time, 2),
                    "alignment_time_seconds": 0.0,
                    "diarization_time_seconds": 0.0,
                    "total_words": total_words,
                    "audio_duration_seconds": round(audio_duration, 2),
                    "max_cpu_percent": round(monitor.max_cpu, 1),
                    "max_ram_process_mb": round(monitor.max_ram_process_mb, 1),
                    "max_vram_allocated_mb": round(max_vram, 1),
                    "device": f"GPU ({torch.cuda.get_device_name(0)})" if self.gpu_available else "CPU",
                    "transcripted_words_per_second": round(total_words / trans_time, 2) if trans_time > 0 else 0.0
                }
                
                # Clean up numpy datatypes
                result = convert_types(result)
                self._clear_memory()
                return result
                
            elif backend == "faster_whisper":
                # NATIVE FASTER-WHISPER ON GPU/CPU (CTranslate2)
                logger.info(f"Loading native Faster-Whisper on {self.transcribe_device.upper()}: {model_name}")
                self.current_progress = f"Cargando modelo Faster-Whisper '{model_name}'..."
                
                # 1. Model Loading Time
                start_load = time.time()
                model = self.get_fw_model(model_name)
                load_time = time.time() - start_load
                self.check_abort()
                
                # 2. Transcription Time
                self.current_progress = "Transcribiendo con Faster-Whisper..."
                start_trans = time.time()
                transcribe_options = {
                    "word_timestamps": align,
                    "beam_size": 5
                }
                if language:
                    transcribe_options["language"] = language
                    
                segments, info = model.transcribe(audio_path, **transcribe_options)
                self.check_abort()
                    
                # Parse segments generator and convert objects to dicts
                formatted_segments = []
                for seg in segments:
                    self.check_abort()
                    
                    # Update status progress string with current timestamp and text
                    mins_start = int(seg.start // 60)
                    secs_start = int(seg.start % 60)
                    mins_end = int(seg.end // 60)
                    secs_end = int(seg.end % 60)
                    time_str = f"{mins_start:02d}:{secs_start:02d} -> {mins_end:02d}:{secs_end:02d}"
                    clean_text = seg.text.strip()
                    if len(clean_text) > 40:
                        clean_text = clean_text[:40] + "..."
                    self.current_progress = f"Procesado: {time_str} | \"{clean_text}\""
                    
                    seg_dict = {
                        "start": seg.start,
                        "end": seg.end,
                        "text": seg.text,
                        "words": []
                    }
                    if seg.words:
                        for w in seg.words:
                            seg_dict["words"].append({
                                "word": w.word,
                                "start": w.start,
                                "end": w.end,
                                "probability": w.probability
                            })
                    formatted_segments.append(seg_dict)
                trans_time = time.time() - start_trans
                self.check_abort()
                    
                result = {
                    "language": info.language,
                    "segments": formatted_segments,
                    "word_timestamps_aligned": align,
                    "speaker_diarized": False,
                    "warnings": []
                }
                
                if diarize:
                    msg = "Diarization is only supported under the 'whisperx' backend."
                    logger.warning(msg)
                    result["warnings"].append(msg)
                    
                # Compute total words
                total_words = 0
                for seg in result["segments"]:
                    if "words" in seg and seg["words"]:
                        total_words += len(seg["words"])
                    else:
                        total_words += len(seg.get("text", "").split())
                        
                audio_duration = result["segments"][-1]["end"] if result["segments"] else 0.0
                
                max_vram = 0.0
                if self.gpu_available:
                    try:
                        max_vram = torch.cuda.max_memory_allocated(0) / 1024 / 1024
                    except Exception:
                        pass
                    
                result["metrics"] = {
                    "model_load_time_seconds": round(load_time, 2),
                    "transcription_time_seconds": round(trans_time, 2),
                    "alignment_time_seconds": 0.0,
                    "diarization_time_seconds": 0.0,
                    "total_words": total_words,
                    "audio_duration_seconds": round(audio_duration, 2),
                    "max_cpu_percent": round(monitor.max_cpu, 1),
                    "max_ram_process_mb": round(monitor.max_ram_process_mb, 1),
                    "max_vram_allocated_mb": round(max_vram, 1),
                    "device": f"GPU ({torch.cuda.get_device_name(0)})" if (self.gpu_available and self.transcribe_device == "cuda") else "CPU",
                    "transcripted_words_per_second": round(total_words / trans_time, 2) if trans_time > 0 else 0.0
                }
                
                # Clean up numpy datatypes
                result = convert_types(result)
                self._clear_memory()
                return result

            elif backend == "whisperx":
                # HYBRID WHISPERX CPU/GPU
                # 1. Model Loading Time
                self.current_progress = f"Cargando modelo de transcripción '{model_name}'..."
                start_load = time.time()
                model = self.get_transcribe_model(model_name)
                load_time = time.time() - start_load
                self.check_abort()
                
                # 2. Transcription Time
                self.current_progress = "Cargando archivo de audio..."
                audio = whisperx.load_audio(audio_path)
                self.check_abort()
                
                self.current_progress = f"Ejecutando transcripción WhisperX (Batched {self.transcribe_device.upper()})..."
                start_trans = time.time()
                
                def transcribe_cb(pct):
                    self.current_progress = f"Transcribiendo: {pct:.0f}%"
                    
                transcribe_options = {
                    "progress_callback": transcribe_cb
                }
                if language:
                    transcribe_options["language"] = language
                    
                batch_size_to_use = min(settings.batch_size, 8)
                with self.tqdm_progress():
                    raw_result = model.transcribe(audio, batch_size=batch_size_to_use, **transcribe_options)

                trans_time = time.time() - start_trans
                detected_language = raw_result.get("language")
                logger.info(f"Transcription finished on {self.transcribe_device.upper()}. Detected language: {detected_language}")
                
                # Unload Whisper model from VRAM immediately before alignment starts
                del model
                self._clear_memory()
                self.check_abort()
                
                result = {
                    "language": detected_language,
                    "segments": raw_result["segments"],
                    "word_timestamps_aligned": False,
                    "speaker_diarized": False,
                    "warnings": []
                }
                
                # 3. Align (100% GPU / PyTorch CUDA)
                align_time = 0.0
                if align:
                    self.current_stage = "aligning"
                    self.current_progress = "Cargando modelo de alineación fonética en GPU..."
                    logger.info(f"Starting phoneme alignment on CUDA device: {self.pytorch_device}...")
                    start_align = time.time()
                    try:
                        model_a, metadata = self.get_alignment_model(detected_language)
                        self.check_abort()
                        
                        def align_cb(pct):
                            self.current_progress = f"Alineando: {pct:.0f}%"
                            
                        self.current_progress = "Alineando segmentos de palabras en GPU..."
                        aligned_result = whisperx.align(
                            raw_result["segments"], 
                            model_a, 
                            metadata, 
                            audio, 
                            self.pytorch_device, 
                            return_char_alignments=False,
                            progress_callback=align_cb
                        )
                        result["segments"] = aligned_result["segments"]
                        result["word_timestamps_aligned"] = True
                        logger.info("Alignment finished successfully on GPU.")
                    except Exception as e:
                        self.check_abort()
                        msg = f"Alignment skipped due to error: {str(e)}"
                        logger.error(msg)
                        result["warnings"].append(msg)
                    finally:
                        if 'model_a' in locals():
                            del model_a
                        if 'metadata' in locals():
                            del metadata
                        self._clear_memory()
                            
                    align_time = time.time() - start_align
                    self.check_abort()
                
                # 4. Speaker Diarization (100% GPU / PyTorch CUDA)
                diarize_time = 0.0
                if diarize:
                    self.current_stage = "diarizing"
                    if not hf_token:
                        msg = "Diarization requested but no Hugging Face token (HF_TOKEN) was provided."
                        logger.warning(msg)
                        result["warnings"].append(msg)
                    else:
                        self.current_progress = "Cargando pipeline de diarización en GPU..."
                        logger.info(f"Starting speaker diarization on CUDA device: {self.pytorch_device}...")
                        start_diarize = time.time()
                        try:
                            diarize_pipeline = self.get_diarization_pipeline(hf_token)
                            self.check_abort()
                            
                            def diarize_cb(pct):
                                self.current_progress = f"Diarizando: {pct:.0f}%"
                                
                            self.current_progress = "Analizando voces para segmentar locutores en GPU..."
                            diarize_options = {
                                "progress_callback": diarize_cb
                            }
                            if min_speakers is not None:
                                diarize_options["min_speakers"] = min_speakers
                            if max_speakers is not None:
                                diarize_options["max_speakers"] = max_speakers
                                
                            diarize_segments = diarize_pipeline(audio, **diarize_options)
                            self.check_abort()
                            
                            self.current_progress = "Asignando etiquetas de locutor..."
                            logger.info("Assigning speakers to segments...")
                            diarized_result = whisperx.assign_word_speakers(diarize_segments, result)
                            
                            result["segments"] = diarized_result["segments"]
                            result["speaker_diarized"] = True
                            logger.info("Diarization completed successfully on GPU.")
                        except Exception as e:
                            self.check_abort()
                            msg = f"Diarization skipped due to error: {str(e)}"
                            logger.error(msg)
                            result["warnings"].append(msg)
                        finally:
                            if 'diarize_pipeline' in locals():
                                del diarize_pipeline
                            self._clear_memory()
                                
                        diarize_time = time.time() - start_diarize
                        self.check_abort()
                
                # Compute total words
                total_words = 0
                for seg in result["segments"]:
                    if "words" in seg and seg["words"]:
                        total_words += len(seg["words"])
                    else:
                        total_words += len(seg.get("text", "").split())
                        
                audio_duration = result["segments"][-1]["end"] if result["segments"] else 0.0
                
                max_vram = 0.0
                if self.gpu_available:
                    try:
                        max_vram = torch.cuda.max_memory_allocated(0) / 1024 / 1024
                    except Exception:
                        pass
                    
                result["metrics"] = {
                    "model_load_time_seconds": round(load_time, 2),
                    "transcription_time_seconds": round(trans_time, 2),
                    "alignment_time_seconds": round(align_time, 2),
                    "diarization_time_seconds": round(diarize_time, 2),
                    "total_words": total_words,
                    "audio_duration_seconds": round(audio_duration, 2),
                    "max_cpu_percent": round(monitor.max_cpu, 1),
                    "max_ram_process_mb": round(monitor.max_ram_process_mb, 1),
                    "max_vram_allocated_mb": round(max_vram, 1),
                    "device": f"GPU ({torch.cuda.get_device_name(0)})" if self.gpu_available else "CPU",
                    "transcripted_words_per_second": round(total_words / trans_time, 2) if trans_time > 0 else 0.0
                }
                
                # Clean up numpy datatypes
                result = convert_types(result)
                self._clear_memory()
                return result
        finally:
            self.transcribe_thread_id = None
            self.current_stage = "Idle"
            self.current_progress = ""
            monitor.stop()
            monitor.join()
            try:
                gpu_lock_context.__exit__(None, None, None)
            except Exception:
                pass

# Singleton instance of the service
whisper_service = WhisperService()
