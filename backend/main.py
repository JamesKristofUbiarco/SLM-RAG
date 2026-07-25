import os
import sys
import shutil
import logging
import subprocess
import time
import datetime
import uuid
import json
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, Form, Query, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from pathlib import Path

# Add backend directory to sys.path to ensure internal imports work seamlessly
BACKEND_DIR = Path(__file__).parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from config import settings
from database import get_db, init_db
from whisper_service import whisper_service
from rag_service import rag_service

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rag_api")

# Make sure directories and database are initialized at project root
BASE_DIR = BACKEND_DIR.parent
STATIC_DIR = BASE_DIR / "frontend" / "dist"
LOGS_DIR = BASE_DIR / "logs"
LOGS_DIR.mkdir(exist_ok=True)
init_db()

app = FastAPI(
    title="Local Whisper RAG API",
    description="FastAPI backend integrating local Whisper transcription (GPU), SQLite vector indexing, and local LLM chat (Ollama Gemma4)",
    version="1.0.0"
)

generating_summaries = set()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def cleanup_temp_file(filepath: Path):
    try:
        if filepath.exists() and "uploads" in str(filepath):
            filepath.unlink()
            logger.info(f"Cleaned up temporary file: {filepath}")
    except Exception as e:
        logger.error(f"Failed to delete temporary file {filepath}: {str(e)}")

def process_embeddings_background(transcription_id: int, text: str):
    """Background task to run text chunking and embedding generation only."""
    try:
        logger.info(f"Starting background RAG embedding indexing for transcription ID {transcription_id}...")
        rag_service.store_chunks(transcription_id, text)
        logger.info(f"Background embedding generation and chunk indexing complete for transcription ID {transcription_id}.")
    except Exception as e:
        logger.error(f"Error in background embedding generation for transcription ID {transcription_id}: {str(e)}")

def process_summary_background(transcription_id: int, filename: str, text: str, mode: str = "meeting"):
    """Background task to run Ollama summary generation and speaker participation analysis."""
    try:
        logger.info(f"Starting background LLM summary generation (mode='{mode}') for transcription ID {transcription_id}...")
        
        # Read segments from DB
        segments = []
        with get_db() as conn:
            row = conn.execute("SELECT segments_json FROM transcriptions WHERE id = ?", (transcription_id,)).fetchone()
            if row:
                segments = json.loads(row["segments_json"])

        if mode == "essay":
            # Mode "essay": Video Essay / Conference / Podcast timestamped summary
            summary_text = rag_service.generate_essay_summary(filename, segments, text)
        else:
            # Mode "meeting": Executive summary + Speakers + Commitments
            summary_text = rag_service.generate_summary(filename, text)
            if segments:
                speaker_analysis = rag_service.generate_speaker_analysis(filename, segments)
                if speaker_analysis:
                    summary_text += f"\n\n---\n## Participación de los Miembros\n\n{speaker_analysis}"
                    logger.info("Speaker participation analysis appended to the summary.")
                    
            commitments = rag_service.generate_commitments(filename, text)
            if commitments:
                summary_text += f"\n\n---\n## Compromisos de la Reunión\n\n{commitments}"
                logger.info("Meeting commitments appended to the summary.")
                    
        # Store final summary and mode in DB
        with get_db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO summaries (transcription_id, text, mode) VALUES (?, ?, ?)",
                (transcription_id, summary_text, mode)
            )
            conn.commit()
            
        logger.info(f"LLM summary generation complete (mode='{mode}') for transcription ID {transcription_id}.")
    except Exception as e:
        logger.error(f"Error generating summary for transcription ID {transcription_id}: {str(e)}")
    finally:
        generating_summaries.discard(transcription_id)

# Mount static assets folder using absolute path and auto-create if missing
ASSETS_DIR = STATIC_DIR / "assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")

@app.get("/favicon.svg")
async def get_favicon():
    favicon_path = STATIC_DIR / "favicon.svg"
    if favicon_path.exists():
        return FileResponse(favicon_path)
    return Response(status_code=204)

@app.get("/", response_class=HTMLResponse)
async def get_index():
    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found. Please compile the React code with 'pnpm --dir frontend build'.")
    return FileResponse(index_path)

@app.get("/api/status")
async def get_status():
    """Retrieve system status and hardware detection metrics."""
    try:
        status = whisper_service.get_status()
        status["ollama_model"] = settings.llm_model
        status["has_hf_token"] = bool(settings.hf_token and settings.hf_token.strip())
        return status
    except Exception as e:
        logger.error(f"Error checking status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

import hashlib

def calculate_file_hash(filepath: Path) -> str:
    """Calculate SHA-256 hash of a file to detect duplicates."""
    sha256 = hashlib.sha256()
    try:
        with open(filepath, "rb") as f:
            while chunk := f.read(8192):
                sha256.update(chunk)
        return sha256.hexdigest()
    except Exception as e:
        logger.error(f"Failed to calculate file hash for {filepath}: {e}")
        return ""

@app.post("/api/transcribe")
async def transcribe(
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(None),
    filePath: Optional[str] = Form(None), # Allow transcribing directly from local filesystem paths (useful for large files!)
    backend: str = Form("whisperx"),
    model_name: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    align: bool = Form(True),
    diarize: bool = Form(False),
    hf_token: Optional[str] = Form(None)
):
    """
    Transcribe audio/video file.
    Can accept either a file upload, or a direct filePath on local disk.
    Saves metadata to SQLite, then launches background RAG indexing and summarization.
    """
    logger.info("Transcribe request received. Requesting Ollama to unload model and clearing VRAM...")
    try:
        rag_service.unload_model()
    except Exception as e:
        logger.warning(f"Failed to unload Ollama model: {str(e)}")
        
    try:
        whisper_service._clear_memory()
    except Exception as e:
        logger.warning(f"Failed to clear whisper service VRAM: {str(e)}")
        
    try:
        rag_service.unload_embedding_model()
    except Exception as e:
        logger.warning(f"Failed to unload embedding model: {str(e)}")
        
    start_request_time = time.time()
    
    # 1. Determine local file path
    temp_filepath = None
    original_filename = ""
    is_video = False
    media_filepath_for_db = ""
    
    if filePath:
        # User passed a local filesystem path
        local_path = Path(filePath).resolve()
        if not local_path.exists():
            raise HTTPException(status_code=400, detail=f"El archivo local especificado no existe: {filePath}")
        temp_filepath = local_path
        original_filename = local_path.name
        media_filepath_for_db = str(local_path)
        logger.info(f"Using local filesystem path: {temp_filepath}")
    elif file:
        # User uploaded a file
        original_filename = file.filename
        temp_dir = Path(settings.upload_dir)
        temp_filepath = temp_dir / f"upload_{os.urandom(8).hex()}_{file.filename}"
        
        try:
            with temp_filepath.open("wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            logger.info(f"Saved uploaded file to: {temp_filepath}")
            # Keep the uploaded file permanently for playback
            media_filepath_for_db = str(temp_filepath)
        except Exception as e:
            logger.error(f"Failed to save uploaded file: {str(e)}")
            raise HTTPException(status_code=500, detail="Failed to save uploaded file on server")
        finally:
            file.file.close()
    else:
        raise HTTPException(status_code=400, detail="Debes subir un archivo o especificar una ruta de archivo local.")

    # 1.5. Check for duplicates via file hash (Deduplication)
    file_hash = calculate_file_hash(temp_filepath)
    existing_filepath = None
    if file_hash:
        with get_db() as conn:
            row = conn.execute("SELECT filepath FROM transcriptions WHERE file_hash = ? AND filepath IS NOT NULL AND filepath != '' LIMIT 1", (file_hash,)).fetchone()
            if row:
                existing_filepath = row["filepath"]
                
    if existing_filepath:
        # Check if the file physically exists on disk (relative or absolute)
        test_path = Path(existing_filepath)
        if not test_path.is_absolute():
            test_path = (BASE_DIR / test_path).resolve()
        else:
            test_path = test_path.resolve()
            
        if test_path.exists():
            logger.info(f"Duplicate file detected (hash: {file_hash}). Reusing existing file on disk: {test_path}")
            # If it was an upload, delete the newly uploaded temporary file immediately to free space
            if not filePath:
                try:
                    temp_filepath.unlink()
                    logger.info(f"Deleted duplicate upload file: {temp_filepath}")
                except Exception as e:
                    logger.warning(f"Failed to delete duplicate upload file: {str(e)}")
            temp_filepath = test_path
            media_filepath_for_db = existing_filepath
        else:
            logger.warning(f"File hash {file_hash} exists in DB pointing to {existing_filepath}, but the file was deleted from disk. Proceeding with new ingestion.")
            existing_filepath = None

    # 2. Extract/Convert audio if video file or if we want to compress it to MP3
    conversion_time = 0.0
    is_video = temp_filepath.suffix.lower() in [".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv", ".m4v", ".3gp"]
    is_mp3 = temp_filepath.suffix.lower() == ".mp3"
    
    needs_conversion = False
    if not existing_filepath:
        if is_video:
            needs_conversion = True
        elif not filePath and not is_mp3:
            needs_conversion = True
            
    if needs_conversion:
        ext = ".mp3"
        codec_args = ["-acodec", "libmp3lame", "-ab", "128k"]
        logger.info(f"Audio/Video conversion needed for: {original_filename}. Extracting/converting to MP3...")
        
        if filePath:
            # For local files, create target audio file in the upload directory
            audio_filepath = Path(settings.upload_dir) / f"audio_{temp_filepath.stem}_{os.urandom(4).hex()}{ext}"
        else:
            audio_filepath = temp_filepath.with_suffix(ext)
            # Avoid collision if the uploaded file is already an MP3 of the target format
            if audio_filepath.resolve() == temp_filepath.resolve():
                audio_filepath = temp_filepath.parent / f"processed_{temp_filepath.stem}_{os.urandom(4).hex()}{ext}"
                
        scripts_dir = Path(sys.executable).parent
        ffmpeg_exe = scripts_dir / "ffmpeg"
        ffmpeg_cmd_base = str(ffmpeg_exe) if ffmpeg_exe.exists() else "ffmpeg"
        
        ffmpeg_cmd = [
            ffmpeg_cmd_base,
            "-y",
            "-i", str(temp_filepath),
            "-vn",
            *codec_args,
            "-ar", "16000",
            "-ac", "1",
            str(audio_filepath)
        ]
        
        start_conv = time.time()
        try:
            logger.info(f"Running command: {' '.join(ffmpeg_cmd)}")
            subprocess.run(ffmpeg_cmd, capture_output=True, text=True, check=True)
            conversion_time = time.time() - start_conv
            logger.info(f"Successfully converted/extracted audio in {conversion_time:.2f}s to: {audio_filepath}")
            
            if not filePath:
                # Delete the original uploaded file (video or non-ogg audio) synchronously to save space
                try:
                    temp_filepath.unlink()
                    logger.info(f"Synchronously deleted original uploaded file: {temp_filepath}")
                except Exception as e:
                    logger.warning(f"Failed to delete original uploaded file: {str(e)}")
                # Keep the converted audio file permanently in uploads for playback
                media_filepath_for_db = str(audio_filepath)
            else:
                # For local video files, delete the extracted audio since we can play directly from original video path
                background_tasks.add_task(cleanup_temp_file, audio_filepath)
                
            temp_filepath = audio_filepath
        except Exception as err:
            logger.error(f"FFmpeg conversion/extraction failed: {str(err)}")
            if not filePath and temp_filepath:
                try:
                    p = Path(temp_filepath)
                    if p.exists() and p.resolve().is_relative_to(Path(settings.upload_dir).resolve()):
                        p.unlink()
                        logger.info(f"Cleaned up original upload file {p} on FFmpeg conversion failure.")
                except Exception as cleanup_err:
                    logger.warning(f"Failed to clean up original upload file on FFmpeg failure: {str(cleanup_err)}")
            stderr_msg = err.stderr if isinstance(err, subprocess.CalledProcessError) else str(err)
            raise HTTPException(status_code=500, detail=f"Failed to convert audio/video: {stderr_msg}")
            
    # 3. Transcribe audio
    try:
        model_name = model_name or settings.whisper_model
        logger.info(f"Transcribing audio file {temp_filepath} using backend {backend} and model {model_name}...")
        
        result = await run_in_threadpool(
            whisper_service.transcribe,
            audio_path=str(temp_filepath),
            backend=backend,
            model_name=model_name,
            language=language,
            align=align,
            diarize=diarize,
            hf_token_override=hf_token
        )
        
        total_words = result["metrics"]["total_words"]
        text_content = ""
        for seg in result["segments"]:
            text_content += seg.get("text", "") + " "
        text_content = text_content.strip()
        
        segments_json = json.dumps(result["segments"])
        
        # Convert media filepath to a relative path if it resides in the uploads directory
        try:
            db_path = Path(media_filepath_for_db)
            uploads_dir = Path(settings.upload_dir).resolve()
            if db_path.is_absolute() and db_path.resolve().is_relative_to(uploads_dir):
                media_filepath_for_db = str(db_path.resolve().relative_to(BASE_DIR.resolve()))
            elif not db_path.is_absolute() and (BASE_DIR / db_path).resolve().is_relative_to(uploads_dir):
                media_filepath_for_db = str((BASE_DIR / db_path).resolve().relative_to(BASE_DIR.resolve()))
        except Exception as e:
            logger.warning(f"Failed to convert filepath to relative format: {e}")
            
        # 4. Save to SQLite database
        logger.info("Saving transcription record to SQLite...")
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO transcriptions (filename, filepath, file_hash, text, segments_json) VALUES (?, ?, ?, ?, ?)",
                (original_filename, media_filepath_for_db, file_hash, text_content, segments_json)
            )
            transcription_id = cursor.lastrowid
            conn.commit()
            
        logger.info(f"Saved transcription with ID: {transcription_id}")
        
        # 5. Synchronously chunk and index vector embeddings into SQLite
        try:
            whisper_service.current_stage = "Generando embeddings y fragmentos RAG"
            whisper_service.current_progress = "Almacenando fragmentos vectoriales en base de datos SQLite..."
            await run_in_threadpool(rag_service.store_chunks, transcription_id, text_content)
        except Exception as e:
            logger.error(f"Error in embedding generation for transcription ID {transcription_id}: {str(e)}")
        finally:
            whisper_service.current_stage = "Listo / En espera"
            whisper_service.current_progress = ""
        
        total_elapsed = time.time() - start_request_time
        run_id = None
        metrics = {}
        if "metrics" in result:
            result["metrics"]["conversion_time_seconds"] = round(conversion_time, 2)
            result["metrics"]["total_processing_time_seconds"] = round(total_elapsed, 2)
            
            duration = result["metrics"].get("audio_duration_seconds", 0.0)
            result["metrics"]["speedup_ratio"] = round(duration / total_elapsed, 2) if total_elapsed > 0 else 0.0
            
            metrics = result["metrics"]
            run_id = f"run_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
            log_payload = {
                "run_id": run_id,
                "timestamp": datetime.datetime.now().isoformat(),
                "filename": original_filename,
                "backend": backend,
                "model_name": model_name,
                "language": language or "auto",
                "align": align,
                "diarize": diarize,
                "metrics": metrics
            }
            
            log_path = LOGS_DIR / f"{run_id}.json"
            try:
                with log_path.open("w", encoding="utf-8") as lf:
                    json.dump(log_payload, lf, indent=2)
                logger.info(f"Saved performance log payload to: {log_path}")
            except Exception as log_err:
                logger.error(f"Failed to write performance log JSON: {log_err}")
                
        return {
            "id": transcription_id,
            "filename": original_filename,
            "total_words": total_words,
            "text": text_content[:500] + "..." if len(text_content) > 500 else text_content,
            "elapsed_seconds": round(total_elapsed, 2),
            "run_id": run_id,
            "metrics": metrics,
            "status": "Transcribed. Embedding generation running in background."
        }
        
    except Exception as e:
        logger.error(f"Error during transcription: {str(e)}")
        if not filePath and temp_filepath:
            try:
                p = Path(temp_filepath)
                if p.exists() and p.resolve().is_relative_to(Path(settings.upload_dir).resolve()):
                    p.unlink()
                    logger.info(f"Cleaned up temporary upload file {p} on transcription failure.")
            except Exception as cleanup_err:
                logger.warning(f"Failed to clean up file {temp_filepath} on failure: {str(cleanup_err)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/media")
async def get_media_file(path: str):
    """
    Serve a local media file (audio or video) for playback.
    Enables streaming of local media to avoid browser CORS/sandbox restrictions.
    """
    media_path = Path(path)
    if not media_path.is_absolute():
        media_path = (BASE_DIR / media_path).resolve()
    else:
        media_path = media_path.resolve()
        
    # Security: Path Traversal Prevention
    # Verify that this file is registered in the database for a valid transcription record
    with get_db() as conn:
        exists = conn.execute(
            "SELECT 1 FROM transcriptions WHERE filepath = ? OR filepath = ? LIMIT 1",
            (path, str(media_path))
        ).fetchone()
        
    if not exists:
        logger.warning(f"Security Block: Attempted access to unregistered media path: {path}")
        raise HTTPException(status_code=403, detail="Acceso denegado a este archivo multimedia")
        
    if not media_path.exists() or not media_path.is_file():
        raise HTTPException(status_code=404, detail="Archivo multimedia no encontrado")
        
    return FileResponse(str(media_path))

def prune_orphaned_media_sync():
    """Prune any media files in the uploads directory that are not referenced in the database."""
    uploads_dir = Path(settings.upload_dir).resolve()
    if not uploads_dir.exists():
        return []
        
    referenced_paths = set()
    try:
        with get_db() as conn:
            rows = conn.execute("SELECT filepath FROM transcriptions WHERE filepath IS NOT NULL").fetchall()
            for row in rows:
                referenced_paths.add(Path(row["filepath"]).resolve())
    except Exception as db_err:
        logger.error(f"Failed to query database for pruning: {db_err}")
        return []
        
    deleted_files = []
    for file in uploads_dir.iterdir():
        if file.is_file() and file.name != ".gitkeep":
            resolved_file = file.resolve()
            if resolved_file not in referenced_paths:
                try:
                    resolved_file.unlink()
                    deleted_files.append(file.name)
                    logger.info(f"Startup Pruning: Deleted orphaned media file {resolved_file}")
                except Exception as e:
                    logger.error(f"Startup Pruning: Failed to delete orphaned file {file.name}: {str(e)}")
    return deleted_files

def ensure_ollama_started():
    import socket
    import subprocess
    import os
    import time
    
    # 1. Check if port 11434 is listening
    is_running = False
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1.0)
            s.connect(("127.0.0.1", 11434))
            is_running = True
    except Exception:
        pass
        
    if is_running:
        logger.info("Ollama ya se encuentra activo en el puerto 11434.")
        return
        
    # 2. Start local or global system Ollama binary in background
    ollama_local = BASE_DIR / "bin" / "ollama"
    import shutil
    ollama_cmd = str(ollama_local) if ollama_local.exists() else shutil.which("ollama")

    if ollama_cmd:
        logger.info(f"Ollama no responde en puerto 11434. Iniciando servicio en segundo plano ({ollama_cmd})...")
        log_dir = BASE_DIR / "logs"
        log_dir.mkdir(exist_ok=True)
        log_file = log_dir / "ollama.log"
        try:
            with open(log_file, "a") as f:
                subprocess.Popen(
                    [ollama_cmd, "serve"],
                    stdout=f,
                    stderr=f,
                    start_new_session=True
                )
            
            # Wait up to 5 seconds for port to open
            for _ in range(5):
                time.sleep(1.0)
                try:
                    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                        s.settimeout(0.5)
                        s.connect(("127.0.0.1", 11434))
                        logger.info("¡Servicio Ollama iniciado con éxito en segundo plano!")
                        return
                except Exception:
                    pass
            logger.warning("Se lanzó el proceso Ollama, pero el puerto 11434 no respondió en 5 segundos.")
        except Exception as e:
            logger.error(f"Error al intentar arrancar el proceso Ollama: {str(e)}")
    else:
        logger.warning("Ollama no se encuentra activo y no se halló instalación local o global en el sistema.")

@app.on_event("startup")
def startup_checks():
    logger.info("Initializing system startup checks...")
    ensure_ollama_started()
    deleted = prune_orphaned_media_sync()
    if deleted:
        logger.info(f"Startup Pruning: Cleaned up {len(deleted)} orphaned media files from uploads folder: {deleted}")
    else:
        logger.info("Startup Pruning: No orphaned files found in uploads folder.")

@app.post("/api/media/prune")
async def prune_orphaned_media():
    """Prune any media files in the uploads directory that are not referenced in the database."""
    deleted_files = await run_in_threadpool(prune_orphaned_media_sync)
    return {
        "status": "success",
        "message": f"Successfully deleted {len(deleted_files)} orphaned files.",
        "deleted_files": deleted_files
    }

@app.post("/api/media/concat")
async def concat_media_files(
    files: List[UploadFile] = File(...),
):
    """
    Concatenate multiple uploaded audio/video files into a single MP3 file.
    """
    if len(files) < 2:
        raise HTTPException(status_code=400, detail="Debes subir al menos 2 archivos para concatenar.")
        
    temp_dir = Path(settings.upload_dir)
    temp_dir.mkdir(exist_ok=True)
    
    saved_paths = []
    try:
        # Save all uploaded parts to temporary files
        for idx, file in enumerate(files):
            # Safe filename
            safe_name = f"part_{idx}_{os.urandom(4).hex()}_{file.filename}"
            part_path = temp_dir / safe_name
            with part_path.open("wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            saved_paths.append(part_path)
            
        # Create the ffmpeg concat file list
        # FFmpeg concat demuxer format requires: file 'path'
        concat_list_path = temp_dir / f"concat_list_{os.urandom(8).hex()}.txt"
        with concat_list_path.open("w", encoding="utf-8") as f:
            for path in saved_paths:
                # Use absolute resolved path to avoid FFmpeg safe path errors
                f.write(f"file '{path.resolve()}'\n")
                
        # Define output path
        import re
        first_file_stem = Path(files[0].filename).stem
        safe_stem = re.sub(r'[^\w\s-]', '', first_file_stem).strip()
        safe_stem = re.sub(r'[-\s]+', '_', safe_stem)
        if not safe_stem:
            safe_stem = f"unified_{os.urandom(4).hex()}"
        output_filename = f"concat_{safe_stem}.mp3"
        output_filepath = temp_dir / output_filename
        
        # FFmpeg command using concat demuxer
        scripts_dir = Path(sys.executable).parent
        ffmpeg_exe = scripts_dir / "ffmpeg"
        ffmpeg_cmd_base = str(ffmpeg_exe) if ffmpeg_exe.exists() else "ffmpeg"
        
        # We use -c copy to instantly concatenate without transcoding
        ffmpeg_cmd = [
            ffmpeg_cmd_base,
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_list_path),
            "-c", "copy",
            str(output_filepath)
        ]
        
        logger.info(f"Running FFmpeg concat command: {' '.join(ffmpeg_cmd)}")
        result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            # Fallback: if codec copy fails (e.g. codecs/sample rates mismatch), we transcode to MP3
            logger.warning("FFmpeg stream copy concatenation failed. Retrying with transcoding...")
            ffmpeg_cmd_transcode = [
                ffmpeg_cmd_base,
                "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_list_path),
                "-acodec", "libmp3lame",
                "-ab", "128k",
                "-ar", "16000",
                "-ac", "1",
                str(output_filepath)
            ]
            logger.info(f"Running FFmpeg transcode concat command: {' '.join(ffmpeg_cmd_transcode)}")
            trans_result = subprocess.run(ffmpeg_cmd_transcode, capture_output=True, text=True)
            if trans_result.returncode != 0:
                raise Exception(f"FFmpeg concat failed: {trans_result.stderr}")
                
        # Clean up temporary parts and the list file
        concat_list_path.unlink(missing_ok=True)
        for part_path in saved_paths:
            part_path.unlink(missing_ok=True)
            
        # Store as relative path
        rel_output_path = str(output_filepath.resolve().relative_to(BASE_DIR.resolve()))
        
        return {
            "status": "success",
            "filename": f"Concatenado ({len(files)} partes)",
            "filepath": rel_output_path
        }
        
    except Exception as e:
        logger.error(f"Error during audio concatenation: {str(e)}")
        # Clean up in case of failure
        for part_path in saved_paths:
            part_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Error al concatenar audios: {str(e)}")

# ── YouTube Audio Extraction Endpoints ─────────────────────────────────────

class YouTubeRequest(BaseModel):
    url: str

def format_seconds(seconds: Optional[float]) -> str:
    if not seconds:
        return "00:00"
    sec = int(seconds)
    hours = sec // 3600
    minutes = (sec % 3600) // 60
    secs = sec % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"

def get_youtube_info_sync(url: str) -> dict:
    import yt_dlp
    ydl_opts = {
        'format': 'bestaudio/best',
        'quiet': True,
        'no_warnings': True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        thumbnails = info.get("thumbnails", [])
        thumb_url = info.get("thumbnail")
        if not thumb_url and thumbnails:
            thumb_url = thumbnails[-1].get("url", "")
            
        return {
            "title": info.get("title", "Video de YouTube"),
            "uploader": info.get("uploader") or info.get("channel") or "Canal Desconocido",
            "duration": info.get("duration", 0),
            "duration_string": format_seconds(info.get("duration", 0)),
            "thumbnail": thumb_url or "",
            "video_id": info.get("id", ""),
            "url": url
        }

def sanitize_filename(name: str) -> str:
    import unicodedata, re
    # Normalize unicode characters (accents -> ascii equivalents)
    name = unicodedata.normalize('NFKD', name)
    name = name.encode('ascii', 'ignore').decode('ascii')
    # Remove non-alphanumeric, non-space, non-dash characters
    name = re.sub(r'[^\w\s-]', '', name)
    # Replace spaces and underscores with single hyphen
    name = re.sub(r'[\s_]+', '-', name)
    # Collapse multiple consecutive hyphens
    name = re.sub(r'-+', '-', name).strip('-')
    return name or "video_youtube"

def download_youtube_audio_sync(url: str) -> dict:
    import yt_dlp
    whisper_service.current_stage = "Descargando audio de YouTube"
    whisper_service.current_progress = f"Extrayendo flujo de audio MP3 desde YouTube..."
    try:
        out_dir = Path(settings.upload_dir) / "youtube"
        out_dir.mkdir(parents=True, exist_ok=True)
        
        scripts_dir = Path(sys.executable).parent
        ffmpeg_exe = scripts_dir / "ffmpeg"
        
        # Extract metadata first
        ydl_opts_info = {
            'quiet': True,
            'no_warnings': True,
        }
        with yt_dlp.YoutubeDL(ydl_opts_info) as ydl:
            info = ydl.extract_info(url, download=False)
            
        video_id = info.get("id", "audio")
        title = info.get("title", f"YouTube_{video_id}")
        uploader = info.get("uploader") or info.get("channel") or "Canal Desconocido"
        duration = info.get("duration", 0)
        thumbnails = info.get("thumbnails", [])
        thumb_url = info.get("thumbnail")
        if not thumb_url and thumbnails:
            thumb_url = thumbnails[-1].get("url", "")

        # Sanitize title for compatibility (spaces to dashes, no emojis or special chars)
        safe_title = sanitize_filename(title)
        filename_stem = f"{safe_title}_{video_id}" if safe_title else f"youtube_{video_id}"
        
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': str(out_dir / f"{filename_stem}.%(ext)s"),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'quiet': True,
            'no_warnings': True,
        }
        if ffmpeg_exe.exists():
            ydl_opts['ffmpeg_location'] = str(scripts_dir)

        whisper_service.current_progress = f"Descargando '{title}'..."
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        mp3_path = out_dir / f"{filename_stem}.mp3"
        if not mp3_path.exists():
            for p in out_dir.glob(f"{filename_stem}.*"):
                if p.suffix in ['.mp3', '.m4a', '.wav', '.opus', '.webm']:
                    mp3_path = p
                    break
                    
        if not mp3_path.exists():
            raise RuntimeError("No se pudo generar el archivo de audio MP3 para el video de YouTube.")
            
        file_size = mp3_path.stat().st_size
        rel_path = str(mp3_path.resolve().relative_to(BASE_DIR.resolve()))
        
        return {
            "title": title,
            "uploader": uploader,
            "duration": duration,
            "duration_string": format_seconds(duration),
            "thumbnail": thumb_url or "",
            "video_id": video_id,
            "filepath": str(mp3_path.resolve()),
            "relative_path": rel_path,
            "filename": mp3_path.name,
            "file_size": file_size
        }
    finally:
        whisper_service.current_stage = "Listo / En espera"
        whisper_service.current_progress = ""

@app.post("/api/youtube/info")
async def get_youtube_info(payload: YouTubeRequest):
    """Fetch video title, duration, uploader and thumbnail without downloading."""
    if not payload.url or not payload.url.strip():
        raise HTTPException(status_code=400, detail="Por favor proporciona una URL válida de YouTube.")
    try:
        data = await run_in_threadpool(get_youtube_info_sync, payload.url.strip())
        return data
    except Exception as e:
        logger.error(f"Error al obtener info de YouTube ({payload.url}): {str(e)}")
        raise HTTPException(status_code=400, detail=f"No se pudo extraer información del enlace de YouTube: {str(e)}")

@app.post("/api/youtube/download")
async def download_youtube_audio(payload: YouTubeRequest):
    """Download audio stream from YouTube video into uploads/youtube/ as an MP3 file."""
    if not payload.url or not payload.url.strip():
        raise HTTPException(status_code=400, detail="Por favor proporciona una URL válida de YouTube.")
    try:
        data = await run_in_threadpool(download_youtube_audio_sync, payload.url.strip())
        return data
    except Exception as e:
        logger.error(f"Error al descargar audio de YouTube ({payload.url}): {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error al descargar audio de YouTube: {str(e)}")


@app.get("/api/transcriptions")
async def list_transcriptions():
    """Retrieve all transcription records in the system with metadata metrics, project_id and folder_id."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT t.id, t.filename, t.created_at, t.text, t.project_id, t.folder_id, COUNT(c.id) as chunk_count
            FROM transcriptions t
            LEFT JOIN chunks c ON t.id = c.transcription_id
            GROUP BY t.id
            ORDER BY t.id DESC
        """).fetchall()
    return [
        {
            "id": row["id"],
            "filename": row["filename"],
            "created_at": row["created_at"],
            "char_count": len(row["text"]),
            "word_count": len(row["text"].split()),
            "token_estimate": int(len(row["text"].split()) * 1.4),
            "chunk_count": row["chunk_count"],
            "project_id": row["project_id"],
            "folder_id": row["folder_id"]
        }
        for row in rows
    ]

# --- Projects & Folders Management Endpoints ---

class CreateProjectPayload(BaseModel):
    name: str
    description: Optional[str] = ""

class CreateFolderPayload(BaseModel):
    project_id: int
    parent_id: Optional[int] = None
    name: str

class UpdateSourceLocationPayload(BaseModel):
    project_id: Optional[int] = None
    folder_id: Optional[int] = None

@app.get("/api/projects")
async def get_projects():
    """Retrieve all projects and folders."""
    with get_db() as conn:
        projects = conn.execute("SELECT id, name, description, created_at FROM projects ORDER BY id ASC").fetchall()
        folders = conn.execute("SELECT id, project_id, parent_id, name, created_at FROM folders ORDER BY id ASC").fetchall()
        
    return {
        "projects": [dict(p) for p in projects],
        "folders": [dict(f) for f in folders]
    }

@app.post("/api/projects")
async def create_project(payload: CreateProjectPayload):
    """Create a new project."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre del proyecto es obligatorio.")
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO projects (name, description) VALUES (?, ?)",
            (name, payload.description or "")
        )
        conn.commit()
        project_id = cursor.lastrowid
    return {"id": project_id, "name": name, "description": payload.description or ""}

@app.delete("/api/projects/{id}")
async def delete_project(id: int):
    """Delete a project and unassign its transcriptions."""
    with get_db() as conn:
        conn.execute("UPDATE transcriptions SET project_id = NULL, folder_id = NULL WHERE project_id = ?", (id,))
        conn.execute("DELETE FROM projects WHERE id = ?", (id,))
        conn.commit()
    return {"status": "deleted", "id": id}

@app.post("/api/folders")
async def create_folder(payload: CreateFolderPayload):
    """Create a folder or subfolder within a project."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre de la carpeta es obligatorio.")
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO folders (project_id, parent_id, name) VALUES (?, ?, ?)",
            (payload.project_id, payload.parent_id, name)
        )
        conn.commit()
        folder_id = cursor.lastrowid
    return {"id": folder_id, "project_id": payload.project_id, "parent_id": payload.parent_id, "name": name}

@app.delete("/api/folders/{id}")
async def delete_folder(id: int):
    """Delete a folder and unassign its transcriptions."""
    with get_db() as conn:
        conn.execute("UPDATE transcriptions SET folder_id = NULL WHERE folder_id = ?", (id,))
        conn.execute("DELETE FROM folders WHERE id = ?", (id,))
        conn.commit()
    return {"status": "deleted", "id": id}

@app.patch("/api/transcriptions/{id}/location")
async def update_source_location(id: int, payload: UpdateSourceLocationPayload):
    """Move a source/transcription into a project and/or folder."""
    with get_db() as conn:
        conn.execute(
            "UPDATE transcriptions SET project_id = ?, folder_id = ? WHERE id = ?",
            (payload.project_id, payload.folder_id, id)
        )
        conn.commit()
    return {"status": "updated", "id": id, "project_id": payload.project_id, "folder_id": payload.folder_id}

@app.get("/api/semantic_search")
async def semantic_search(
    query: str,
    transcription_id: Optional[int] = None,
    top_k: int = 4
):
    """
    Perform semantic search on vector chunks of transcriptions using RAG model.
    """
    if not query or not query.strip():
        return []
        
    try:
        # Generate embedding for query using our RAG service
        rag_service._load_model()
        query_vector = rag_service.model.encode(query, convert_to_numpy=True)
        rag_service.unload_embedding_model()
        
        # Build SQL query to fetch chunks
        query_sql = """
            SELECT c.id, c.transcription_id, c.text, c.embedding, t.filename
            FROM chunks c
            JOIN transcriptions t ON c.transcription_id = t.id
        """
        params = []
        if transcription_id is not None:
            query_sql += " WHERE c.transcription_id = ?"
            params.append(transcription_id)
            
        with get_db() as conn:
            rows = conn.execute(query_sql, params).fetchall()
            
        if not rows:
            return []
            
        import pickle
        import numpy as np
        similarities = []
        
        for row in rows:
            emb = pickle.loads(row["embedding"])
            dot_product = np.dot(query_vector, emb)
            norm_q = np.linalg.norm(query_vector)
            norm_emb = np.linalg.norm(emb)
            similarity = dot_product / (norm_q * norm_emb) if norm_q > 0 and norm_emb > 0 else 0.0
            
            similarities.append({
                "chunk_id": row["id"],
                "transcription_id": row["transcription_id"],
                "filename": row["filename"],
                "text": row["text"],
                "similarity": round(float(similarity), 4)
            })
            
        # Sort descending by similarity
        similarities.sort(key=lambda x: x["similarity"], reverse=True)
        return similarities[:top_k]
        
    except Exception as e:
        logger.error(f"Error in semantic search: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error al realizar búsqueda semántica: {str(e)}")

@app.post("/api/ingest_file")
async def ingest_file(file: UploadFile = File(...)):
    """
    Ingest any document, image, or text file into the system.
    Saves the original file to uploads/documents/, parses structure with Docling & Gemma 4,
    creates a transcription database record, and indexes vector chunks in the RAG.
    """
    from document_parser import parse_document

    filename = file.filename or "archivo_desconocido.txt"
    docs_dir = BASE_DIR / "uploads" / "documents"
    docs_dir.mkdir(parents=True, exist_ok=True)
    
    saved_filepath = docs_dir / filename
    
    # Read and save uploaded file to disk
    raw_content = await file.read()
    if not raw_content:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
        
    with open(saved_filepath, "wb") as f:
        f.write(raw_content)

    rel_filepath = f"uploads/documents/{filename}"

    # Parse document with Docling + Gemma 4 Multimodal
    try:
        parsed = await run_in_threadpool(parse_document, str(saved_filepath))
        extracted_text = parsed.get("markdown", "")
    except Exception as e:
        logger.error(f"Error parsing document '{filename}': {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error al procesar el archivo '{filename}': {str(e)}")

    if not extracted_text.strip():
        extracted_text = f"Contenido del archivo {filename}"

    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO transcriptions (filename, filepath, text, segments_json) VALUES (?, ?, ?, ?)",
            (filename, rel_filepath, extracted_text, "[]")
        )
        new_id = cursor.lastrowid
        conn.commit()

    # Index chunks for RAG
    try:
        await run_in_threadpool(rag_service.store_chunks, new_id, extracted_text)
    except Exception as e:
        logger.error(f"RAG indexing failed for file '{filename}': {str(e)}")

    logger.info(f"File '{filename}' ingested successfully as transcription id={new_id}")
    return {
        "status": "ok",
        "id": new_id,
        "filename": filename,
        "char_count": len(extracted_text),
        "file_type": parsed.get("file_type", "unknown") if 'parsed' in locals() else "unknown"
    }

@app.post("/api/ingest_text_file")
async def ingest_text_file(file: UploadFile = File(...)):
    """Alias for backwards compatibility."""
    return await ingest_file(file)

# --- Web Page Ingestion Endpoint ---

class IngestWebUrlPayload(BaseModel):
    url: Optional[str] = None
    urls: Optional[str] = None
    project_id: Optional[int] = None
    folder_id: Optional[int] = None

@app.post("/api/ingest_web_url")
async def ingest_web_url(payload: IngestWebUrlPayload):
    """
    Ingests and parses web page content from single or multiple URLs using Docling,
    applying anti-prompt-injection security guardrails before chunking and embedding.
    """
    target_urls = []
    if payload.urls:
        lines = [line.strip() for line in payload.urls.replace(",", "\n").split("\n")]
        target_urls = [u for u in lines if u]
    elif payload.url and payload.url.strip():
        target_urls = [payload.url.strip()]

    if not target_urls:
        raise HTTPException(status_code=400, detail="Debes proporcionar al menos una URL de página web válida.")

    import web_ingester

    ingested_results = []
    errors = []

    for url in target_urls:
        try:
            parsed_data = await run_in_threadpool(web_ingester.extract_web_page, url)
            
            # Save extracted markdown to file in uploads directory
            upload_dir = Path(settings.upload_dir)
            upload_dir.mkdir(parents=True, exist_ok=True)
            saved_file_path = upload_dir / parsed_data["filename"]
            
            with open(saved_file_path, "w", encoding="utf-8") as f:
                f.write(parsed_data["text"])

            rel_filepath = str(saved_file_path.relative_to(BASE_DIR)) if saved_file_path.is_relative_to(BASE_DIR) else str(saved_file_path)

            segments = [
                {
                    "start": 0.0,
                    "end": 0.0,
                    "text": parsed_data["text"]
                }
            ]

            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT INTO transcriptions (filename, filepath, text, segments_json, project_id, folder_id) VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        parsed_data["filename"],
                        rel_filepath,
                        parsed_data["text"],
                        json.dumps(segments),
                        payload.project_id,
                        payload.folder_id
                    )
                )
                transcription_id = cursor.lastrowid
                conn.commit()

            # Create RAG vector chunks
            await run_in_threadpool(rag_service.store_chunks, transcription_id, parsed_data["text"])

            ingested_results.append({
                "id": transcription_id,
                "filename": parsed_data["filename"],
                "url": url,
                "title": parsed_data["title"],
                "char_count": parsed_data["char_count"],
                "word_count": parsed_data["word_count"]
            })
        except Exception as e:
            logger.error(f"Error ingesting web URL '{url}': {e}")
            errors.append({"url": url, "error": str(e)})

    if not ingested_results and errors:
        raise HTTPException(status_code=500, detail=f"Fallo la ingestión web: {errors[0]['error']}")

    return {
        "status": "success",
        "ingested_count": len(ingested_results),
        "results": ingested_results,
        "errors": errors
    }

@app.get("/api/transcriptions/{id}/chunks")
async def get_transcription_chunks(id: int):
    """Retrieve all vector chunks for a specific transcription/source."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, text FROM chunks WHERE transcription_id = ? ORDER BY id ASC",
            (id,)
        ).fetchall()
        
    return [
        {
            "id": row["id"],
            "chunk_index": idx + 1,
            "text": row["text"],
            "char_count": len(row["text"])
        }
        for idx, row in enumerate(rows)
    ]

@app.get("/api/files/view/{id}")
async def view_original_file(id: int):
    """Serve the original raw binary file for inline browser viewing or download."""
    from fastapi.responses import FileResponse
    import mimetypes

    with get_db() as conn:
        row = conn.execute("SELECT filename, filepath FROM transcriptions WHERE id = ?", (id,)).fetchone()

    if not row or not row["filepath"]:
        raise HTTPException(status_code=404, detail="Archivo original no encontrado en el servidor.")

    filepath_str = row["filepath"]
    file_path = Path(filepath_str)
    if not file_path.is_absolute():
        file_path = BASE_DIR / file_path

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"El archivo físico '{row['filename']}' no existe en disco.")

    mime_type, _ = mimetypes.guess_type(str(file_path))
    if not mime_type:
        mime_type = "application/octet-stream"

    return FileResponse(
        path=file_path,
        filename=row["filename"],
        media_type=mime_type,
        content_disposition_type="inline"
    )

@app.get("/api/transcriptions/{id}")
async def get_transcription_details(id: int):
    """Retrieve full details of a specific transcription."""
    with get_db() as conn:
        row = conn.execute("SELECT id, filename, filepath, text, segments_json, created_at FROM transcriptions WHERE id = ?", (id,)).fetchone()
        
    if not row:
        raise HTTPException(status_code=404, detail="Transcripción no encontrada")
        
    # Check if summary exists in DB
    with get_db() as conn:
        summary_row = conn.execute("SELECT text, mode FROM summaries WHERE transcription_id = ?", (id,)).fetchone()
        
    summary = summary_row["text"] if summary_row else None
    summary_mode = summary_row["mode"] if (summary_row and "mode" in summary_row.keys() and summary_row["mode"]) else "meeting"
    
    return {
        "id": row["id"],
        "filename": row["filename"],
        "filepath": row["filepath"] if "filepath" in row.keys() else None,
        "text": row["text"],
        "segments": json.loads(row["segments_json"]),
        "created_at": row["created_at"],
        "summary": summary,
        "summary_mode": summary_mode,
        "is_generating": id in generating_summaries,
        "is_indexing_done": summary is not None
    }

@app.post("/api/transcriptions/{id}/summarize")
async def trigger_summarization(id: int, background_tasks: BackgroundTasks, force: bool = False, mode: str = "meeting"):
    """Trigger background LLM summary generation for a specific transcription."""
    with get_db() as conn:
        row = conn.execute("SELECT id, filename, text FROM transcriptions WHERE id = ?", (id,)).fetchone()
        
    if not row:
        raise HTTPException(status_code=404, detail="Transcripción no encontrada")
        
    if id in generating_summaries:
        return {"status": "generating", "message": "El resumen ya se está generando en segundo plano."}
        
    if force:
        with get_db() as conn:
            conn.execute("DELETE FROM summaries WHERE transcription_id = ?", (id,))
            conn.commit()
            logger.info(f"Existing summary deleted for transcription ID {id} due to force regeneration request.")
    else:
        # Check if already generated
        with get_db() as conn:
            summary_row = conn.execute("SELECT text, mode FROM summaries WHERE transcription_id = ?", (id,)).fetchone()
            
        if summary_row and "mode" in summary_row.keys() and summary_row["mode"] == mode:
            return {"status": "completed", "message": "El resumen ya existe.", "summary": summary_row["text"], "mode": summary_row["mode"]}
        
    # Mark as generating and launch background task
    generating_summaries.add(id)
    background_tasks.add_task(
        process_summary_background,
        transcription_id=id,
        filename=row["filename"],
        text=row["text"],
        mode=mode
    )
    
    return {"status": "started", "message": f"Generación de resumen (modo '{mode}') iniciada en segundo plano."}

@app.get("/api/transcriptions/{id}/summary")
async def get_transcription_summary(id: int):
    """Retrieve LLM executive summary for a transcription."""
    with get_db() as conn:
        row = conn.execute("SELECT text, mode FROM summaries WHERE transcription_id = ?", (id,)).fetchone()
    if not row:
        return {"summary": None, "mode": None, "status": "Resumen no disponible o aún generándose en segundo plano."}
    
    summary_mode = row["mode"] if "mode" in row.keys() else "meeting"
    return {"summary": row["text"], "mode": summary_mode, "status": "completed"}

# --- Chat Sessions Endpoints ---

class CreateChatSessionPayload(BaseModel):
    title: Optional[str] = ""
    context_sources: Optional[str] = ""

@app.get("/api/chat/sessions")
async def list_chat_sessions():
    """Retrieve all saved chat sessions ordered by created_at DESC."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT s.id, s.title, s.context_sources, s.created_at, COUNT(h.id) as message_count
            FROM chat_sessions s
            LEFT JOIN chat_history h ON s.id = h.session_id
            GROUP BY s.id
            ORDER BY s.created_at DESC
        """).fetchall()
    return [
        {
            "id": row["id"],
            "title": row["title"],
            "context_sources": row["context_sources"],
            "created_at": row["created_at"],
            "message_count": row["message_count"]
        }
        for row in rows
    ]

@app.post("/api/chat/sessions")
async def create_chat_session(payload: CreateChatSessionPayload):
    """Create a new chat session."""
    session_id = f"session_{uuid.uuid4().hex[:12]}"
    title = payload.title.strip() if payload.title and payload.title.strip() else f"Conversación {datetime.datetime.now().strftime('%d/%m %H:%M')}"
    sources = payload.context_sources or ""
    
    with get_db() as conn:
        conn.execute(
            "INSERT INTO chat_sessions (id, title, context_sources) VALUES (?, ?, ?)",
            (session_id, title, sources)
        )
        conn.commit()
        
    return {"id": session_id, "title": title, "context_sources": sources}

@app.delete("/api/chat/sessions/{session_id}")
async def delete_chat_session(session_id: str):
    """Delete a chat session and all its message history."""
    with get_db() as conn:
        conn.execute("DELETE FROM chat_history WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))
        conn.commit()
    return {"status": "deleted", "id": session_id}

class ImportChatSessionPayload(BaseModel):
    version: Optional[str] = "1.0"
    title: Optional[str] = ""
    context_sources: Optional[str] = ""
    created_at: Optional[str] = None
    messages: List[Dict[str, Any]]

@app.get("/api/chat/sessions/{session_id}/export")
async def export_chat_session(session_id: str):
    """Export full chat session payload including metadata and all messages."""
    with get_db() as conn:
        session_row = conn.execute(
            "SELECT id, title, context_sources, created_at FROM chat_sessions WHERE id = ?",
            (session_id,)
        ).fetchone()
        
        if not session_row:
            raise HTTPException(status_code=404, detail="Sesión de chat no encontrada.")

        history_rows = conn.execute(
            "SELECT role, text FROM chat_history WHERE session_id = ? ORDER BY id ASC",
            (session_id,)
        ).fetchall()

    messages = [{"role": r["role"], "content": r["text"]} for r in history_rows]

    return {
        "version": "1.0",
        "title": session_row["title"],
        "context_sources": session_row["context_sources"] or "",
        "created_at": session_row["created_at"],
        "messages": messages
    }

@app.post("/api/chat/sessions/import")
async def import_chat_session(payload: ImportChatSessionPayload):
    """Import a chat session payload from JSON and register it as a native conversation session."""
    if not payload.messages:
        raise HTTPException(status_code=400, detail="El payload importado no contiene mensajes.")

    new_session_id = f"session_{uuid.uuid4().hex[:12]}"
    title = payload.title.strip() if payload.title and payload.title.strip() else f"Importado {datetime.datetime.now().strftime('%d/%m %H:%M')}"
    sources = payload.context_sources or ""

    first_target_id = 0
    if sources and sources != "no_sources" and sources != "web_only":
        try:
            first_target_id = int(sources.split(",")[0].strip())
        except Exception:
            first_target_id = 0

    with get_db() as conn:
        conn.execute(
            "INSERT INTO chat_sessions (id, title, context_sources) VALUES (?, ?, ?)",
            (new_session_id, title, sources)
        )
        for msg in payload.messages:
            role = msg.get("role", "user")
            content = msg.get("content") or msg.get("text") or ""
            if content:
                conn.execute(
                    "INSERT INTO chat_history (transcription_id, role, text, context_sources, session_id) VALUES (?, ?, ?, ?, ?)",
                    (first_target_id, role, content, sources, new_session_id)
                )
        conn.commit()

    return {
        "status": "success",
        "session_id": new_session_id,
        "title": title,
        "message_count": len(payload.messages)
    }

# --- Web Search RAG & Promotion Endpoints ---

class PromoteWebSourcePayload(BaseModel):
    url: str
    project_id: Optional[int] = None
    folder_id: Optional[int] = None

@app.post("/api/web/promote_to_source")
async def promote_web_source(payload: PromoteWebSourcePayload):
    """
    Permanently saves a web page as an ingested source in SQLite,
    extracting full clean Markdown with Docling and creating vector chunks.
    """
    if not payload.url or not payload.url.strip():
        raise HTTPException(status_code=400, detail="Se requiere una URL válida.")

    import web_ingester

    parsed_data = await run_in_threadpool(web_ingester.extract_web_page, payload.url.strip())
    
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    saved_file_path = upload_dir / parsed_data["filename"]
    
    with open(saved_file_path, "w", encoding="utf-8") as f:
        f.write(parsed_data["text"])

    rel_filepath = str(saved_file_path.relative_to(BASE_DIR)) if saved_file_path.is_relative_to(BASE_DIR) else str(saved_file_path)

    segments = [{"start": 0.0, "end": 0.0, "text": parsed_data["text"]}]

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO transcriptions (filename, filepath, text, segments_json, project_id, folder_id) VALUES (?, ?, ?, ?, ?, ?)",
            (
                parsed_data["filename"],
                rel_filepath,
                parsed_data["text"],
                json.dumps(segments),
                payload.project_id,
                payload.folder_id
            )
        )
        transcription_id = cursor.lastrowid
        conn.commit()

    await run_in_threadpool(rag_service.store_chunks, transcription_id, parsed_data["text"])

    return {
        "status": "success",
        "id": transcription_id,
        "filename": parsed_data["filename"],
        "title": parsed_data["title"],
        "message": f"Fuente web '{parsed_data['title']}' guardada permanentemente en el proyecto."
    }

@app.post("/api/chat")
async def chat_interaction(
    session_id: Optional[str] = Form(None),
    transcription_id: Optional[int] = Form(None),
    transcription_ids: Optional[str] = Form(None),
    message: str = Form(...),
    search_mode: Optional[str] = Form("local"),
    search_depth: Optional[str] = Form("quick"),
    time_filter: Optional[str] = Form(None),
    domain_filter: Optional[str] = Form(None),
    similarity_threshold: Optional[float] = Form(0.50)
):
    """
    RAG-powered multi-source & agentic web search chat endpoint.
    Combines local SQLite document RAG with real-time ephemeral Web Search RAG (Docling + Guardrails),
    enforces strict anti-hallucination grounding, and registers session chat history.
    """
    target_ids = []
    if transcription_ids:
        target_ids = [int(x.strip()) for x in transcription_ids.split(",") if x.strip().isdigit()]
    elif transcription_id is not None:
        target_ids = [transcription_id]

    mode = search_mode or "local"
    sources_key = ",".join(map(str, sorted(target_ids))) if target_ids else "no_sources"

    # Ensure active session_id exists or create one automatically
    active_session_id = session_id
    with get_db() as conn:
        if active_session_id:
            existing = conn.execute("SELECT id FROM chat_sessions WHERE id = ?", (active_session_id,)).fetchone()
            if not existing:
                active_session_id = None

        if not active_session_id:
            active_session_id = f"session_{uuid.uuid4().hex[:12]}"
            clean_msg = message.strip()
            title = f"{clean_msg[:35]}..." if len(clean_msg) > 35 else clean_msg
            if not title:
                title = f"Conversación {datetime.datetime.now().strftime('%d/%m %H:%M')}"
            conn.execute(
                "INSERT INTO chat_sessions (id, title, context_sources) VALUES (?, ?, ?)",
                (active_session_id, title, sources_key)
            )
            conn.commit()
        else:
            conn.execute("UPDATE chat_sessions SET context_sources = ? WHERE id = ?", (sources_key, active_session_id))
            conn.commit()

    logger.info(f"Chat interaction [{mode}] for session [{active_session_id}]: '{message}'")

    local_context = ""
    if mode in ["local", "hybrid"] and target_ids:
        local_context = rag_service.get_context(message, target_ids, top_k=6)

    web_context = ""
    web_sources = []
    search_logs = []

    if mode in ["web", "hybrid"]:
        import web_search_service
        web_res = await run_in_threadpool(
            web_search_service.process_web_search_rag,
            query=message,
            search_depth=search_depth or "quick",
            time_filter=time_filter,
            domain_filter=domain_filter,
            similarity_threshold=similarity_threshold or 0.50
        )
        web_context = web_res.get("context_text", "")
        web_sources = web_res.get("web_sources", [])
        search_logs = web_res.get("logs", [])

    # Combine contexts
    combined_context_parts = []
    if local_context:
        combined_context_parts.append(f"### [DOCUMENTOS Y FUENTES LOCALES]\n\n{local_context}")
    if web_context:
        combined_context_parts.append(f"### [INVESTIGACIÓN WEB EN TIEMPO REAL]\n\n{web_context}")

    full_context = "\n\n---\n\n".join(combined_context_parts)
    if not full_context:
        full_context = "No hay contexto de documentos locales ni búsquedas web. Responde utilizando únicamente tu conocimiento general preentrenado."

    # Fetch recent chat history for active session
    with get_db() as conn:
        rows = conn.execute(
            "SELECT role, text FROM chat_history WHERE session_id = ? ORDER BY id ASC",
            (active_session_id,)
        ).fetchall()
        
    history = [{"role": r["role"], "content": r["text"]} for r in rows]

    # Query LLM via Ollama
    logger.info(f"Querying local model {settings.llm_model}...")
    llm_response = await run_in_threadpool(
        rag_service.query_llm,
        query=message,
        context=full_context,
        history=history
    )

    # Save message pair to history SQLite table
    first_target_id = target_ids[0] if target_ids else 0
    with get_db() as conn:
        conn.execute(
            "INSERT INTO chat_history (transcription_id, role, text, context_sources, session_id) VALUES (?, ?, ?, ?, ?)",
            (first_target_id, "user", message, sources_key, active_session_id)
        )
        conn.execute(
            "INSERT INTO chat_history (transcription_id, role, text, context_sources, session_id) VALUES (?, ?, ?, ?, ?)",
            (first_target_id, "assistant", llm_response, sources_key, active_session_id)
        )
        conn.commit()

    return {
        "session_id": active_session_id,
        "response": llm_response,
        "context_sources": local_context.split("\n\n---\n\n") if local_context else [],
        "web_sources": web_sources,
        "search_logs": search_logs
    }

@app.get("/api/chat/history")
async def get_multi_chat_history(
    session_id: Optional[str] = Query(None),
    transcription_ids: Optional[str] = Query(None),
    transcription_id: Optional[int] = Query(None)
):
    """Retrieve chat history logs for a session or for selected sources."""
    with get_db() as conn:
        if session_id:
            rows = conn.execute(
                "SELECT role, text, created_at, context_sources FROM chat_history WHERE session_id = ? ORDER BY id ASC",
                (session_id,)
            ).fetchall()
        else:
            target_ids = []
            if transcription_ids:
                target_ids = [int(x.strip()) for x in transcription_ids.split(",") if x.strip().isdigit()]
            elif transcription_id is not None:
                target_ids = [transcription_id]

            if not target_ids:
                return []

            sources_key = ",".join(map(str, sorted(target_ids)))
            rows = conn.execute(
                "SELECT role, text, created_at, context_sources FROM chat_history WHERE context_sources = ? OR (transcription_id = ? AND context_sources IS NULL) ORDER BY id ASC",
                (sources_key, target_ids[0])
            ).fetchall()

    return [
        {
            "role": row["role"],
            "text": row["text"],
            "created_at": row["created_at"],
            "context_sources": row["context_sources"]
        }
        for row in rows
    ]

@app.get("/api/chat/history/{transcription_id}")
async def get_chat_history_legacy(transcription_id: int):
    """Legacy route for retrieving chat history for a single transcription."""
    return await get_multi_chat_history(transcription_id=transcription_id)

@app.post("/api/transcriptions/{id}/delete")
async def delete_transcription(id: int):
    """Delete a transcription, its vector chunks, summaries, chat logs, and local media if uploaded."""
    filepath = None
    with get_db() as conn:
        row = conn.execute("SELECT filepath FROM transcriptions WHERE id = ?", (id,)).fetchone()
        if row and "filepath" in row.keys():
            filepath = row["filepath"]
            
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA foreign_keys = ON;")
        cursor.execute("DELETE FROM chunks WHERE transcription_id = ?", (id,))
        cursor.execute("DELETE FROM summaries WHERE transcription_id = ?", (id,))
        cursor.execute("DELETE FROM chat_history WHERE transcription_id = ?", (id,))
        cursor.execute("DELETE FROM transcriptions WHERE id = ?", (id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Transcripción no encontrada")
        conn.commit()
        
    # If the file exists in the uploads directory, delete it to free space (only if not referenced by others)
    if filepath:
        file_to_del = Path(filepath)
        if not file_to_del.is_absolute():
            file_to_del = BASE_DIR / file_to_del
            
        uploads_dir = Path(settings.upload_dir).resolve()
        try:
            resolved_file = file_to_del.resolve()
            if resolved_file.exists() and resolved_file.is_relative_to(uploads_dir):
                other_ref = False
                with get_db() as conn:
                    # Check if any other database row references this same filepath (either exact relative or absolute)
                    row = conn.execute(
                        "SELECT count(*) as cnt FROM transcriptions WHERE (filepath = ? OR filepath = ?) AND id != ?",
                        (filepath, str(resolved_file), id)
                    ).fetchone()
                    if row and row["cnt"] > 0:
                        other_ref = True
                
                if not other_ref:
                    resolved_file.unlink()
                    logger.info(f"Deleted uploaded media file from disk: {resolved_file}")
                else:
                    logger.info(f"Preserved shared media file on disk: {resolved_file} (still referenced by other transcriptions)")
        except Exception as e:
            logger.error(f"Failed to delete file {filepath} from disk: {str(e)}")
            
    logger.info(f"Successfully deleted transcription record ID {id}.")
    return {"status": "success", "message": f"Deleted transcription ID {id} and all related chunks/history/files."}

@app.get("/api/logs")
async def list_logs():
    """List all performance logs recorded in the system."""
    try:
        logs = []
        for file_path in LOGS_DIR.glob("*.json"):
            try:
                with file_path.open("r", encoding="utf-8") as f:
                    log_data = json.load(f)
                    logs.append({
                        "run_id": log_data.get("run_id"),
                        "timestamp": log_data.get("timestamp"),
                        "filename": log_data.get("filename"),
                        "backend": log_data.get("backend"),
                        "model_name": log_data.get("model_name"),
                        "total_processing_time_seconds": log_data.get("metrics", {}).get("total_processing_time_seconds"),
                        "total_words": log_data.get("metrics", {}).get("total_words")
                    })
            except Exception:
                pass
        # Sort by timestamp descending
        logs.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return logs
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list logs: {str(e)}")

@app.get("/api/logs/{run_id}")
async def get_log_details(run_id: str):
    """Retrieve full details of a specific performance log."""
    log_path = LOGS_DIR / f"{run_id}.json"
    if not log_path.exists():
        raise HTTPException(status_code=404, detail="Performance log not found")
    try:
        with log_path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read log file: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    # Make sure DB is initialized
    init_db()
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True)
