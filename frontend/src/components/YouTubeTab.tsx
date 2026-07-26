import React, { useState, ChangeEvent, FormEvent } from 'react';
import { StatusData, Transcription } from '../types';
import TranscriptionHistoryBox from './TranscriptionHistoryBox';

export interface YouTubeVideoInfo {
  title: string;
  uploader: string;
  duration: number;
  duration_string: string;
  thumbnail: string;
  video_id: string;
  url: string;
}

interface YouTubeTabProps {
  active: boolean;
  onTranscriptionSuccess: (id: number) => void;
  statusData: StatusData | null;
  startPollingStatus: () => void;
  stopPollingStatus: () => void;
  hasHfToken?: boolean;
  onRedirectToTranscriptionPath: (path: string) => void;
  transcriptionList?: Transcription[];
  activeTranscriptionId?: number | null;
  onLoadTranscription?: (id: number) => void;
  onDeleteTranscription?: (id: number, filename: string) => void;
}

export default function YouTubeTab({
  active,
  onTranscriptionSuccess,
  statusData,
  startPollingStatus,
  stopPollingStatus,
  hasHfToken = false,
  onRedirectToTranscriptionPath,
  transcriptionList = [],
  activeTranscriptionId,
  onLoadTranscription,
  onDeleteTranscription
}: YouTubeTabProps) {
  const [inputMode, setInputMode] = useState<'single' | 'batch'>('single');
  const [youtubeUrl, setYoutubeUrl] = useState<string>('');
  const [batchUrlsText, setBatchUrlsText] = useState<string>('');
  const [isLoadingInfo, setIsLoadingInfo] = useState<boolean>(false);
  const [videoInfo, setVideoInfo] = useState<YouTubeVideoInfo | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [downloadStepMsg, setDownloadStepMsg] = useState<string>('');

  // Batch queue state
  const [batchProgressList, setBatchProgressList] = useState<Array<{ url: string; status: 'pending' | 'processing' | 'done' | 'error'; message?: string }>>([]);

  // Model & Pipeline Settings
  const [backend, setBackend] = useState<string>('whisperx');
  const [model, setModel] = useState<string>('large-v3');
  const [language, setLanguage] = useState<string>('');
  const [diarize, setDiarize] = useState<boolean>(true);
  const [hfToken, setHfToken] = useState<string>('');
  const [align, setAlign] = useState<boolean>(true);

  const handleBackendChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setBackend(val);
    if (val === 'whisperx') {
      setAlign(true);
      setDiarize(true);
    }
  };

  const handleFetchInfo = async () => {
    if (!youtubeUrl.trim()) {
      alert('Por favor ingresa un enlace de YouTube válido.');
      return;
    }

    setIsLoadingInfo(true);
    setVideoInfo(null);

    try {
      const res = await fetch('/api/youtube/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl.trim() })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Error al obtener información' }));
        throw new Error(err.detail || 'Fallo en la comunicación con el servidor');
      }

      const data: YouTubeVideoInfo = await res.json();
      setVideoInfo(data);
    } catch (err: any) {
      console.error(err);
      alert(`Error al analizar enlace de YouTube: ${err.message}`);
    } finally {
      setIsLoadingInfo(false);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setYoutubeUrl(text.trim());
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
    }
  };

  const handleDownloadAndTranscribe = async (e: FormEvent) => {
    e.preventDefault();
    if (!youtubeUrl.trim()) return;

    setIsProcessing(true);
    setDownloadStepMsg('Descargando audio de YouTube en alta fidelidad...');
    startPollingStatus();

    try {
      const res = await fetch('/api/youtube/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: youtubeUrl.trim(),
          backend,
          model,
          language: language || null,
          diarize,
          align,
          hf_token: hfToken || null
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Fallo el proceso de YouTube');

      if (data.id) {
        onTranscriptionSuccess(data.id);
      }
    } catch (err: any) {
      alert(`Error procesando video de YouTube: ${err.message}`);
      setIsProcessing(false);
      stopPollingStatus();
    } finally {
      setDownloadStepMsg('');
    }
  };

  const handleDownloadAndRedirect = async () => {
    if (!youtubeUrl.trim()) return;

    setIsProcessing(true);
    setDownloadStepMsg('Descargando audio únicamente...');

    try {
      const res = await fetch('/api/youtube/download-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl.trim() })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Error al descargar audio');

      onRedirectToTranscriptionPath(data.audio_path);
    } catch (err: any) {
      alert(`Error al descargar: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setDownloadStepMsg('');
    }
  };

  const handleBatchProcess = async (e: FormEvent) => {
    e.preventDefault();
    const urls = batchUrlsText.split('\n').map(u => u.trim()).filter(Boolean);
    if (urls.length === 0) return;

    setIsProcessing(true);
    const initialList = urls.map(url => ({ url, status: 'pending' as const }));
    setBatchProgressList(initialList);
    startPollingStatus();

    for (let i = 0; i < urls.length; i++) {
      const currentUrl = urls[i];
      setBatchProgressList(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'processing', message: 'Descargando y transcribiendo...' } : item));

      try {
        const res = await fetch('/api/youtube/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: currentUrl,
            backend,
            model,
            language: language || null,
            diarize,
            align,
            hf_token: hfToken || null
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Fallo procesamiento');

        setBatchProgressList(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'done', message: 'Completado' } : item));
      } catch (err: any) {
        setBatchProgressList(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'error', message: err.message || 'Error' } : item));
      }
    }

    setIsProcessing(false);
  };

  return (
    <section id="youtube-tab" className={`flex-col gap-6 w-full ${active ? 'flex' : 'hidden'}`}>
      <div className="mb-1">
        <h2 className="text-2xl font-semibold text-white tracking-tight mb-1 flex items-center gap-2">
          <i className="fa-brands fa-youtube text-red-500"></i>
          Ingestión de Videos de YouTube
        </h2>
        <p className="text-sm text-zinc-400">
          Extrae el audio en alta fidelidad de videos individuales o de un lote de enlaces de YouTube y transcríbelos automáticamente con aceleración GPU NVIDIA CUDA.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start w-full min-w-0">
        {/* Left Form Panel */}
        <div className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-5 w-full min-w-0">
          {/* Method Selection Tabs */}
          <div className="grid grid-cols-2 gap-1.5 p-1.5 bg-black/40 border border-white/10 rounded-xl w-full">
            <button
              type="button"
              className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                inputMode === 'single'
                  ? 'bg-amber-500/15 border border-amber-500/35 text-amber-400 font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
              onClick={() => setInputMode('single')}
            >
              <i className="fa-solid fa-link text-red-500"></i> Video Individual
            </button>

            <button
              type="button"
              className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                inputMode === 'batch'
                  ? 'bg-amber-500/15 border border-amber-500/35 text-amber-400 font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
              onClick={() => setInputMode('batch')}
            >
              <i className="fa-solid fa-layer-group text-orange-400"></i> Procesar Lote de URLs
            </button>
          </div>

          {inputMode === 'single' ? (
            /* Single Video Form */
            <form onSubmit={handleDownloadAndTranscribe} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="youtube-url-input" className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <i className="fa-solid fa-link text-red-500"></i> Enlace del Video de YouTube
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    id="youtube-url-input"
                    className="flex-1 bg-white/[0.03] border border-white/10 rounded-lg text-white px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500 transition-colors"
                    placeholder="https://www.youtube.com/watch?v=... o https://youtu.be/..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="px-3 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-white text-xs font-semibold cursor-pointer transition-colors"
                    onClick={handlePasteClipboard}
                    title="Pegar del portapapeles"
                  >
                    <i className="fa-solid fa-paste"></i>
                  </button>
                  <button
                    type="button"
                    className="px-3.5 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                    onClick={handleFetchInfo}
                    disabled={isLoadingInfo || !youtubeUrl.trim()}
                  >
                    {isLoadingInfo ? (
                      <><i className="fa-solid fa-spinner fa-spin"></i> Analizando...</>
                    ) : (
                      <><i className="fa-solid fa-magnifying-glass"></i> Previsualizar</>
                    )}
                  </button>
                </div>
              </div>

              {/* Video Info Preview Card */}
              {videoInfo && (
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10 flex items-center gap-3">
                  {videoInfo.thumbnail && (
                    <img
                      src={videoInfo.thumbnail}
                      alt={videoInfo.title}
                      className="w-24 h-14 object-cover rounded-md shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-semibold text-white truncate mb-1">
                      {videoInfo.title}
                    </h4>
                    <p className="text-[11px] text-zinc-400 flex items-center gap-2">
                      <span><i className="fa-solid fa-user mr-1"></i> {videoInfo.uploader}</span>
                      <span>•</span>
                      <span><i className="fa-solid fa-clock mr-1"></i> {videoInfo.duration_string}</span>
                    </p>
                  </div>
                </div>
              )}

              {/* Pipeline Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-zinc-300">Motor / Pipeline</label>
                  <select 
                    className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white px-3 py-2 text-xs focus:outline-none focus:border-amber-500 transition-colors" 
                    value={backend} 
                    onChange={handleBackendChange}
                  >
                    <option value="whisperx">WhisperX (Acelerado CUDA + PyAnnote)</option>
                    <option value="openai_whisper">OpenAI Whisper (PyTorch CUDA)</option>
                    <option value="faster_whisper">Faster-Whisper (CTranslate2)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-zinc-300">Modelo Whisper</label>
                  <select 
                    className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white px-3 py-2 text-xs focus:outline-none focus:border-amber-500 transition-colors" 
                    value={model} 
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="large-v3">large-v3 (Máxima Precisión)</option>
                    <option value="medium">medium (Equilibrado)</option>
                    <option value="small">small (Rápido)</option>
                    <option value="base">base (Ultra rápido)</option>
                  </select>
                </div>
              </div>

              {/* Language */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-zinc-300">Idioma (opcional)</label>
                <input
                  type="text"
                  className="w-full bg-white/[0.03] border border-white/10 rounded-lg text-white px-3.5 py-2 text-xs focus:outline-none focus:border-amber-500 transition-colors"
                  placeholder="es, en, fr... (auto-detectar si está vacío)"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                />
              </div>

              {/* Checkboxes */}
              {backend === 'whisperx' && (
                <div className="flex flex-col gap-2 my-1">
                  <label className="flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-amber-500 rounded border-white/10 bg-white/5 cursor-pointer"
                      checked={align}
                      onChange={(e) => setAlign(e.target.checked)}
                    />
                    <span>Alineación de Palabras (Wav2Vec2)</span>
                  </label>
                  <label className="flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-amber-500 rounded border-white/10 bg-white/5 cursor-pointer"
                      checked={diarize}
                      onChange={(e) => setDiarize(e.target.checked)}
                    />
                    <span>Diarización de Hablantes (PyAnnote Audio)</span>
                  </label>
                </div>
              )}

              {/* Status Step Msg */}
              {downloadStepMsg && (
                <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-xs text-indigo-400 flex items-center gap-2">
                  <i className="fa-solid fa-spinner fa-spin"></i> {downloadStepMsg}
                </div>
              )}

              <div className="flex items-center gap-3 mt-2">
                <button
                  type="submit"
                  className="flex-1 py-3 px-5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50"
                  disabled={isProcessing || !youtubeUrl.trim()}
                >
                  {isProcessing ? (
                    <><i className="fa-solid fa-spinner fa-spin"></i> Procesando YouTube...</>
                  ) : (
                    <><i className="fa-brands fa-youtube"></i> Descargar y Transcribir Audio</>
                  )}
                </button>
                <button
                  type="button"
                  className="px-3.5 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                  onClick={handleDownloadAndRedirect}
                  disabled={isProcessing || !youtubeUrl.trim()}
                  title="Solo descargar audio y abrirlo en la pestaña Transcripción"
                >
                  <i className="fa-solid fa-right-to-bracket text-amber-400"></i> Redirigir
                </button>
              </div>
            </form>
          ) : (
            /* Batch Queue Form */
            <form onSubmit={handleBatchProcess} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="youtube-batch-textarea" className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <i className="fa-solid fa-list-ol text-orange-400"></i> Lista de Enlaces de YouTube (un enlace por línea)
                </label>
                <textarea
                  id="youtube-batch-textarea"
                  className="w-full bg-white/[0.03] border border-white/10 rounded-lg text-white font-mono p-3 text-xs focus:outline-none focus:border-amber-500 transition-colors leading-relaxed"
                  rows={6}
                  placeholder={`https://www.youtube.com/watch?v=abc12345\nhttps://youtu.be/xyz67890\n\nPega múltiples enlaces de YouTube aquí (uno por cada línea).`}
                  value={batchUrlsText}
                  onChange={(e) => setBatchUrlsText(e.target.value)}
                  disabled={isProcessing}
                  required
                />
              </div>

              {/* Pipeline Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-zinc-300">Motor para el Lote</label>
                  <select 
                    className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white px-3 py-2 text-xs focus:outline-none focus:border-amber-500" 
                    value={backend} 
                    onChange={handleBackendChange}
                  >
                    <option value="whisperx">WhisperX (CUDA + PyAnnote)</option>
                    <option value="openai_whisper">OpenAI Whisper (PyTorch CUDA)</option>
                    <option value="faster_whisper">Faster-Whisper (CTranslate2)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-zinc-300">Modelo Whisper</label>
                  <select 
                    className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white px-3 py-2 text-xs focus:outline-none focus:border-amber-500" 
                    value={model} 
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="large-v3">large-v3 (Máxima Precisión)</option>
                    <option value="medium">medium (Equilibrado)</option>
                    <option value="small">small (Rápido)</option>
                    <option value="base">base (Ultra rápido)</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 px-5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50 mt-2"
                disabled={isProcessing || !batchUrlsText.trim()}
              >
                {isProcessing ? (
                  <><i className="fa-solid fa-spinner fa-spin"></i> Procesando Lote en Cola...</>
                ) : (
                  <><i className="fa-solid fa-layer-group"></i> Descargar y Transcribir Lote</>
                )}
              </button>

              {/* Batch Itemized Progress List */}
              {batchProgressList.length > 0 && (
                <div className="flex flex-col gap-2 mt-2">
                  <h4 className="text-xs font-semibold text-amber-400">
                    Progreso del Lote ({batchProgressList.filter(i => i.status === 'done').length} / {batchProgressList.length} completados)
                  </h4>
                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {batchProgressList.map((item, idx) => (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                          item.status === 'processing' 
                            ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300' 
                            : item.status === 'done' 
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                            : item.status === 'error' 
                            ? 'bg-red-500/10 border-red-500/30 text-red-300' 
                            : 'bg-white/[0.02] border-white/10 text-zinc-300'
                        }`}
                      >
                        <span className="truncate flex-1 font-mono text-[11px]">
                          <strong className="mr-1">#{idx + 1}</strong> {item.url}
                        </span>
                        <span className="text-[11px] font-semibold shrink-0">
                          {item.status === 'pending' && <span className="text-zinc-400"><i className="fa-solid fa-hourglass-start mr-1"></i> En espera</span>}
                          {item.status === 'processing' && <span className="text-indigo-400"><i className="fa-solid fa-spinner fa-spin mr-1"></i> {item.message || 'Procesando...'}</span>}
                          {item.status === 'done' && <span className="text-emerald-400"><i className="fa-solid fa-circle-check mr-1"></i> {item.message || 'Listo'}</span>}
                          {item.status === 'error' && <span className="text-red-400"><i className="fa-solid fa-triangle-exclamation mr-1"></i> {item.message || 'Error'}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Right Status Panel & History Box */}
        <div className="flex flex-col gap-6 w-full min-w-0">
          <div className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-4 w-full min-w-0">
            <h3 className="text-lg font-semibold text-white">Estado del Servidor CUDA & YouTube</h3>
            {statusData ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider ${
                    statusData.is_running ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  }`}>
                    {String(statusData.status || (statusData.is_running ? 'PROCESANDO' : 'LISTO')).toUpperCase()}
                  </span>
                  <span className="px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30">
                    {String(statusData.backend || statusData.transcribe_device || 'CUDA GPU').toUpperCase()}
                  </span>
                </div>

                {/* Stage indicator */}
                {statusData.is_running && statusData.current_stage && statusData.current_stage !== 'Idle' ? (
                  <div className="text-xs text-indigo-400 font-semibold flex items-center gap-1.5">
                    <i className="fa-solid fa-microchip"></i> Etapa: {statusData.current_stage}
                  </div>
                ) : (
                  <div className="text-xs text-emerald-400 font-medium flex items-center gap-1.5">
                    <i className="fa-solid fa-circle-check"></i> Servidor listo (Sin tareas en ejecución)
                  </div>
                )}

                {/* Live Progress Bar */}
                {statusData.is_running && (
                  <div className="flex flex-col gap-1.5 my-1">
                    <div className="flex justify-between text-xs text-zinc-300">
                      <span>Progreso del Audio Actual</span>
                      <span className="font-semibold text-amber-400">{statusData.current_progress || (statusData.progress ? `${statusData.progress}%` : 'En curso...')}</span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                      <div className="bg-amber-500 h-full transition-all duration-300" style={{ width: `${statusData.progress || 100}%` }}></div>
                    </div>
                  </div>
                )}

                <div className="p-3 rounded-lg bg-black/40 border border-white/10 text-xs font-mono max-h-36 overflow-y-auto space-y-1">
                  {statusData.logs && statusData.logs.length > 0 ? (
                    statusData.logs.map((log, i) => <div key={i} className="text-zinc-300 leading-relaxed">{log}</div>)
                  ) : statusData.is_running && statusData.current_progress ? (
                    <div className="text-zinc-400">{statusData.current_progress}</div>
                  ) : (
                    <div className="text-zinc-500">No hay procesos activos en segundo plano.</div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-400">No hay tarea en ejecución en este momento.</p>
            )}
          </div>

          {/* Historial de Grabaciones */}
          <TranscriptionHistoryBox
            transcriptionList={transcriptionList}
            activeTranscriptionId={activeTranscriptionId}
            onLoadTranscription={onLoadTranscription}
            onDeleteTranscription={onDeleteTranscription}
          />
        </div>
      </div>
    </section>
  );
}
