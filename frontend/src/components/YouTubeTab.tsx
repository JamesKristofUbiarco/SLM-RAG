import React, { useState, ChangeEvent, FormEvent } from 'react';
import { StatusData } from '../types';

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
}

export default function YouTubeTab({
  active,
  onTranscriptionSuccess,
  statusData,
  startPollingStatus,
  stopPollingStatus,
  hasHfToken = false,
  onRedirectToTranscriptionPath
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

  // Single Video Transcription
  const handleDownloadAndTranscribe = async (e: FormEvent) => {
    e.preventDefault();
    if (!youtubeUrl.trim()) {
      alert('Por favor ingresa un enlace de YouTube.');
      return;
    }

    setIsProcessing(true);
    setDownloadStepMsg('Descargando y extrayendo audio en calidad MP3 con yt-dlp...');

    try {
      const dlRes = await fetch('/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl.trim() })
      });

      if (!dlRes.ok) {
        const err = await dlRes.json().catch(() => ({ detail: 'Error al descargar audio' }));
        throw new Error(err.detail || 'Fallo al descargar el audio de YouTube.');
      }

      const dlData = await dlRes.json();
      const relativePath = dlData.relative_path || dlData.filepath;

      setDownloadStepMsg('Audio descargado con éxito. Iniciando transcripción GPU CUDA...');
      startPollingStatus();

      const formData = new FormData();
      formData.append('backend', backend);
      formData.append('model_name', model);
      formData.append('language', language);
      formData.append('align', align ? 'true' : 'false');
      formData.append('diarize', diarize ? 'true' : 'false');
      if (diarize && hfToken.trim()) {
        formData.append('hf_token', hfToken);
      }
      formData.append('filePath', relativePath);

      const transcribeRes = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData
      });

      if (!transcribeRes.ok) {
        const err = await transcribeRes.json().catch(() => ({ detail: 'Fallo en transcripción' }));
        throw new Error(err.detail || 'Fallo durante la transcripción GPU.');
      }

      const transcribeData = await transcribeRes.json();
      onTranscriptionSuccess(transcribeData.id);
    } catch (err: any) {
      console.error(err);
      alert(`Error en el proceso de YouTube: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setDownloadStepMsg('');
      stopPollingStatus();
    }
  };

  // Batch Queue Video Processing
  const handleBatchProcess = async (e: FormEvent) => {
    e.preventDefault();
    const urls = batchUrlsText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && (line.includes('youtube.com') || line.includes('youtu.be')));

    if (urls.length === 0) {
      alert('Por favor ingresa al menos un enlace de YouTube válido en el cuadro de texto (un enlace por línea).');
      return;
    }

    setIsProcessing(true);
    startPollingStatus();

    const initialQueue = urls.map(url => ({ url, status: 'pending' as const }));
    setBatchProgressList(initialQueue);

    try {
      for (let i = 0; i < urls.length; i++) {
        const currentUrl = urls[i];

        setBatchProgressList(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'processing', message: 'Descargando audio de YouTube...' } : item));

        try {
          // 1. Download
          const dlRes = await fetch('/api/youtube/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: currentUrl })
          });

          if (!dlRes.ok) {
            const err = await dlRes.json().catch(() => ({ detail: 'Error de descarga' }));
            throw new Error(err.detail || 'Descarga fallida');
          }

          const dlData = await dlRes.json();
          const relativePath = dlData.relative_path || dlData.filepath;

          // 2. Transcribe
          setBatchProgressList(prev => prev.map((item, idx) => idx === i ? { ...item, message: 'Transcribiendo en GPU CUDA...' } : item));

          const formData = new FormData();
          formData.append('backend', backend);
          formData.append('model_name', model);
          formData.append('language', language);
          formData.append('align', align ? 'true' : 'false');
          formData.append('diarize', diarize ? 'true' : 'false');
          if (diarize && hfToken.trim()) {
            formData.append('hf_token', hfToken);
          }
          formData.append('filePath', relativePath);

          const transcribeRes = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData
          });

          if (!transcribeRes.ok) {
            const err = await transcribeRes.json().catch(() => ({ detail: 'Error en transcripción' }));
            throw new Error(err.detail || 'Transcripción fallida');
          }

          const transcribeData = await transcribeRes.json();
          onTranscriptionSuccess(transcribeData.id);

          setBatchProgressList(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'done', message: `¡Completado! (${dlData.filename})` } : item));
        } catch (err: any) {
          console.error(`Error en elemento del lote ${currentUrl}:`, err);
          setBatchProgressList(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'error', message: err.message } : item));
        }
      }
    } finally {
      setIsProcessing(false);
      stopPollingStatus();
    }
  };

  const handleDownloadAndRedirect = async () => {
    if (!youtubeUrl.trim()) {
      alert('Por favor ingresa un enlace de YouTube.');
      return;
    }

    setIsProcessing(true);
    setDownloadStepMsg('Descargando audio de YouTube para redirigir...');

    try {
      const dlRes = await fetch('/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: youtubeUrl.trim() })
      });

      if (!dlRes.ok) {
        const err = await dlRes.json().catch(() => ({ detail: 'Error al descargar audio' }));
        throw new Error(err.detail || 'Fallo al descargar el audio de YouTube.');
      }

      const dlData = await dlRes.json();
      const relativePath = dlData.relative_path || dlData.filepath;

      onRedirectToTranscriptionPath(relativePath);
    } catch (err: any) {
      console.error(err);
      alert(`Error al descargar audio: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setDownloadStepMsg('');
    }
  };

  return (
    <section id="youtube-tab" className={`tab-panel ${active ? 'active' : ''}`}>
      <div className="panel-header">
        <h2>
          <i className="fa-brands fa-youtube" style={{ color: '#ef4444', marginRight: '0.5rem' }}></i>
          Ingestión de Videos de YouTube
        </h2>
        <p>
          Extrae el audio en alta fidelidad de videos individuales o de un lote de enlaces de YouTube y transcríbelos automáticamente con aceleración GPU NVIDIA CUDA.
        </p>
      </div>

      <div className="grid-layout">
        {/* Left Form Panel */}
        <div className="card glass-card">
          {/* Method Selection Tabs */}
          <div className="tab-toggle" style={{ marginBottom: '1.25rem' }}>
            <button
              type="button"
              className={`toggle-btn ${inputMode === 'single' ? 'active' : ''}`}
              onClick={() => setInputMode('single')}
            >
              <i className="fa-solid fa-link" style={{ color: '#ef4444' }}></i> Video Individual
            </button>
            <button
              type="button"
              className={`toggle-btn ${inputMode === 'batch' ? 'active' : ''}`}
              onClick={() => setInputMode('batch')}
            >
              <i className="fa-solid fa-layer-group" style={{ color: 'var(--accent-light)' }}></i> Procesar Lote de URLs
            </button>
          </div>

          {inputMode === 'single' ? (
            /* ── Single Video Form ── */
            <form onSubmit={handleDownloadAndTranscribe}>
              <div className="form-group">
                <label htmlFor="youtube-url-input">
                  <i className="fa-solid fa-link" style={{ color: '#ef4444' }}></i> Enlace del Video de YouTube
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="url"
                    id="youtube-url-input"
                    className="form-control"
                    placeholder="https://www.youtube.com/watch?v=... o https://youtu.be/..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    required
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handlePasteClipboard}
                    title="Pegar del portapapeles"
                    style={{ padding: '0.625rem 0.875rem' }}
                  >
                    <i className="fa-solid fa-paste"></i>
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleFetchInfo}
                    disabled={isLoadingInfo || !youtubeUrl.trim()}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
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
                <div style={{ margin: '1rem 0', padding: '0.875rem', borderRadius: '0.5rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  {videoInfo.thumbnail && (
                    <img
                      src={videoInfo.thumbnail}
                      alt={videoInfo.title}
                      style={{ width: '110px', height: '62px', objectFit: 'cover', borderRadius: '0.375rem', flexShrink: 0 }}
                    />
                  )}
                  <div style={{ overflow: 'hidden' }}>
                    <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {videoInfo.title}
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                      <i className="fa-solid fa-user" style={{ marginRight: '0.35rem' }}></i> {videoInfo.uploader}
                      <span style={{ margin: '0 0.5rem' }}>•</span>
                      <i className="fa-solid fa-clock" style={{ marginRight: '0.35rem' }}></i> {videoInfo.duration_string}
                    </p>
                  </div>
                </div>
              )}

              {/* Pipeline Selection */}
              <div className="form-group" style={{ marginTop: '1.25rem' }}>
                <label><i className="fa-solid fa-sliders"></i> Configuración de Transcripción</label>
                <div className="grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>Motor / Pipeline</label>
                    <select className="form-control" value={backend} onChange={handleBackendChange}>
                      <option value="whisperx">WhisperX (Acelerado CUDA + PyAnnote)</option>
                      <option value="openai_whisper">OpenAI Whisper (PyTorch CUDA)</option>
                      <option value="faster_whisper">Faster-Whisper (CTranslate2)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>Modelo Whisper</label>
                    <select className="form-control" value={model} onChange={(e) => setModel(e.target.value)}>
                      <option value="large-v3">large-v3 (Máxima Precisión)</option>
                      <option value="medium">medium (Equilibrado)</option>
                      <option value="small">small (Rápido)</option>
                      <option value="base">base (Ultra rápido)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Language */}
              <div className="form-group">
                <label style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>Idioma (opcional)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="es, en, fr... (auto-detectar si está vacío)"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                />
              </div>

              {/* Checkboxes */}
              {backend === 'whisperx' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '1rem 0' }}>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={align}
                      onChange={(e) => setAlign(e.target.checked)}
                    />
                    <span className="checkmark"></span>
                    Alineación de Palabras (Wav2Vec2)
                  </label>
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={diarize}
                      onChange={(e) => setDiarize(e.target.checked)}
                    />
                    <span className="checkmark"></span>
                    Diarización de Hablantes (PyAnnote Audio)
                  </label>
                </div>
              )}

              {/* Status or Action Buttons */}
              {downloadStepMsg && (
                <div style={{ padding: '0.75rem 1rem', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '0.375rem', fontSize: '0.8125rem', color: '#818cf8', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <i className="fa-solid fa-spinner fa-spin"></i> {downloadStepMsg}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="submit"
                  className="submit-btn"
                  disabled={isProcessing || !youtubeUrl.trim()}
                  style={{ flex: 1 }}
                >
                  {isProcessing ? (
                    <><i className="fa-solid fa-spinner fa-spin"></i> Procesando YouTube...</>
                  ) : (
                    <><i className="fa-brands fa-youtube"></i> Descargar y Transcribir Audio</>
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleDownloadAndRedirect}
                  disabled={isProcessing || !youtubeUrl.trim()}
                  title="Solo descargar audio y abrirlo en la pestaña Transcripción"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <i className="fa-solid fa-right-to-bracket"></i> Redirigir
                </button>
              </div>
            </form>
          ) : (
            /* ── Batch Queue Form ── */
            <form onSubmit={handleBatchProcess}>
              <div className="form-group">
                <label htmlFor="youtube-batch-textarea">
                  <i className="fa-solid fa-list-ol" style={{ color: 'var(--accent-light)' }}></i> Lista de Enlaces de YouTube (un enlace por línea)
                </label>
                <textarea
                  id="youtube-batch-textarea"
                  className="form-control"
                  rows={6}
                  placeholder={`https://www.youtube.com/watch?v=abc12345\nhttps://youtu.be/xyz67890\nhttps://www.youtube.com/watch?v=example3\n\nPega múltiples enlaces de YouTube aquí (uno por cada línea). Se procesarán secuencialmente sin saturar la VRAM de la GPU.`}
                  value={batchUrlsText}
                  onChange={(e) => setBatchUrlsText(e.target.value)}
                  disabled={isProcessing}
                  required
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem', lineHeight: '1.5' }}
                />
              </div>

              {/* Pipeline Selection */}
              <div className="form-group">
                <label style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>Motor y Modelo para el Lote</label>
                <div className="grid-2-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.35rem' }}>
                  <div>
                    <select className="form-control" value={backend} onChange={handleBackendChange}>
                      <option value="whisperx">WhisperX (Acelerado CUDA + PyAnnote)</option>
                      <option value="openai_whisper">OpenAI Whisper (PyTorch CUDA)</option>
                      <option value="faster_whisper">Faster-Whisper (CTranslate2)</option>
                    </select>
                  </div>
                  <div>
                    <select className="form-control" value={model} onChange={(e) => setModel(e.target.value)}>
                      <option value="large-v3">large-v3 (Máxima Precisión)</option>
                      <option value="medium">medium (Equilibrado)</option>
                      <option value="small">small (Rápido)</option>
                      <option value="base">base (Ultra rápido)</option>
                    </select>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="submit-btn"
                disabled={isProcessing || !batchUrlsText.trim()}
                style={{ width: '100%', marginTop: '1rem' }}
              >
                {isProcessing ? (
                  <><i className="fa-solid fa-spinner fa-spin"></i> Procesando Lote de YouTube en Cola...</>
                ) : (
                  <><i className="fa-solid fa-layer-group"></i> Descargar y Transcribir Lote de Audios</>
                )}
              </button>

              {/* Batch Itemized Progress List */}
              {batchProgressList.length > 0 && (
                <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <h4 style={{ margin: 0, fontSize: '0.85rem', color: 'var(--accent-light)' }}>
                    Progreso del Lote ({batchProgressList.filter(i => i.status === 'done').length} / {batchProgressList.length} completados)
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '200px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                    {batchProgressList.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: '0.5rem 0.75rem',
                          borderRadius: '0.375rem',
                          background: item.status === 'processing' ? 'rgba(99, 102, 241, 0.15)' : item.status === 'done' ? 'rgba(16, 185, 129, 0.1)' : item.status === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${item.status === 'processing' ? '#6366f1' : item.status === 'done' ? '#10b981' : item.status === 'error' ? '#ef4444' : 'var(--border-glass)'}`,
                          fontSize: '0.78125rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.5rem'
                        }}
                      >
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, color: '#e2e8f0' }}>
                          <span style={{ fontWeight: 600, marginRight: '0.35rem' }}>#{idx + 1}</span> {item.url}
                        </div>
                        <div style={{ fontSize: '0.725rem', fontWeight: 600, flexShrink: 0 }}>
                          {item.status === 'pending' && <span style={{ color: 'hsl(var(--text-muted))' }}><i className="fa-solid fa-hourglass-start"></i> En espera</span>}
                          {item.status === 'processing' && <span style={{ color: '#818cf8' }}><i className="fa-solid fa-spinner fa-spin"></i> {item.message || 'Procesando...'}</span>}
                          {item.status === 'done' && <span style={{ color: '#10b981' }}><i className="fa-solid fa-circle-check"></i> {item.message || 'Listo'}</span>}
                          {item.status === 'error' && <span style={{ color: '#ef4444' }}><i className="fa-solid fa-triangle-exclamation"></i> {item.message || 'Error'}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Right Status Panel */}
        <div className="card glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3>Estado del Servidor CUDA & YouTube</h3>
          {statusData ? (
            <div className="status-details">
              <div className="status-badge-container" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <span className={`badge ${statusData.is_running ? 'processing' : 'ready'}`}>
                  {String(statusData.status || (statusData.is_running ? 'PROCESANDO' : 'LISTO')).toUpperCase()}
                </span>
                <span className="badge badge-backend">
                  {String(statusData.backend || statusData.transcribe_device || 'CUDA GPU').toUpperCase()}
                </span>
              </div>

              {/* Stage indicator */}
              {statusData.is_running && statusData.current_stage && statusData.current_stage !== 'Idle' ? (
                <div style={{ fontSize: '0.85rem', color: '#818cf8', fontWeight: 600, marginBottom: '0.5rem' }}>
                  <i className="fa-solid fa-microchip"></i> Etapa: {statusData.current_stage}
                </div>
              ) : (
                <div style={{ fontSize: '0.8125rem', color: '#10b981', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <i className="fa-solid fa-circle-check"></i> Servidor listo (Sin tareas en ejecución)
                </div>
              )}

              {/* Live Progress Bar */}
              {statusData.is_running && (
                <div className="progress-bar-container" style={{ margin: '0.75rem 0' }}>
                  <div className="progress-label" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                    <span>Progreso del Audio Actual</span>
                    <span>{statusData.current_progress || (statusData.progress ? `${statusData.progress}%` : 'En curso...')}</span>
                  </div>
                  <div className="progress-track" style={{ width: '100%', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                    <div className="progress-fill" style={{ width: `${statusData.progress || 100}%`, backgroundColor: '#6366f1', height: '100%', transition: 'width 0.3s ease' }}></div>
                  </div>
                </div>
              )}

              <div className="log-box" style={{ marginTop: '0.5rem' }}>
                {statusData.logs && statusData.logs.length > 0 ? (
                  statusData.logs.map((log, i) => <div key={i} className="log-line">{log}</div>)
                ) : statusData.is_running && statusData.current_progress ? (
                  <div className="log-line text-muted">{statusData.current_progress}</div>
                ) : (
                  <div className="log-line text-muted">No hay procesos activos en segundo plano.</div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-muted">No hay tarea en ejecución en este momento.</p>
          )}
        </div>
      </div>
    </section>
  );
}
