import React, { useState, useRef, ChangeEvent, FormEvent, DragEvent } from 'react';
import { StatusData, Transcription } from '../types';
import TranscriptionViewer from './TranscriptionViewer';

export interface TranscribeQueueItem {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'success' | 'error';
  transcriptionId?: number;
  errorMsg?: string;
}

interface TranscribeTabProps {
  onTranscriptionSuccess: (id: number) => void;
  statusData: StatusData | null;
  isPolling: boolean;
  startPollingStatus: () => void;
  stopPollingStatus: () => void;
  transcriptionList?: Transcription[];
  activeTranscriptionId?: number | null;
  onLoadTranscription?: (id: number) => void;
  onDeleteTranscription?: (id: number, filename: string) => void;
  hasHfToken?: boolean;
  onViewerDeleted?: (id: number) => void;
  active: boolean;
  pendingFile?: File | null;
  pendingPath?: string | null;
}

export default function TranscribeTab({ 
  onTranscriptionSuccess, 
  statusData, 
  isPolling, 
  startPollingStatus, 
  stopPollingStatus,
  transcriptionList = [],
  activeTranscriptionId = null,
  onLoadTranscription,
  onDeleteTranscription,
  hasHfToken = false,
  onViewerDeleted,
  active,
  pendingFile = null,
  pendingPath = null
}: TranscribeTabProps) {
  const [inputMethod, setInputMethod] = useState<'upload' | 'batch' | 'path' | 'concat'>('upload');
  
  // Single file state
  const [file, setFile] = useState<File | null>(pendingFile);

  // Batch Queue for batch upload mode
  const [batchQueue, setBatchQueue] = useState<TranscribeQueueItem[]>([]);
  const [localPath, setLocalPath] = useState<string>(pendingPath || '');
  const [concatFilesList, setConcatFilesList] = useState<File[]>([]);

  React.useEffect(() => {
    if (pendingFile) {
      setFile(pendingFile);
      setInputMethod('upload');
    }
  }, [pendingFile]);

  React.useEffect(() => {
    if (pendingPath) {
      setLocalPath(pendingPath);
      setInputMethod('path');
    }
  }, [pendingPath]);
  
  // Settings states
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
  
  // Operation states
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isConcatenating, setIsConcatenating] = useState<boolean>(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchFileInputRef = useRef<HTMLInputElement>(null);
  const concatInputRef = useRef<HTMLInputElement>(null);

  // Single File Upload Handler
  const handleSingleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  // Batch File Upload Handler
  const handleBatchFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      const newItems: TranscribeQueueItem[] = selectedFiles.map(f => ({
        id: `${f.name}-${f.size}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        file: f,
        status: 'pending'
      }));
      setBatchQueue(prev => [...prev, ...newItems]);
      e.target.value = '';
    }
  };

  const removeBatchQueueItem = (id: string) => {
    if (isProcessing) return;
    setBatchQueue(prev => prev.filter(item => item.id !== id));
  };

  const clearBatchQueue = () => {
    if (isProcessing) return;
    setBatchQueue([]);
  };

  // Concat File Selection Handler
  const handleConcatFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selected = Array.from(e.target.files);
      setConcatFilesList((prev) => [...prev, ...selected]);
      e.target.value = '';
    }
  };

  const removeConcatItem = (index: number) => {
    setConcatFilesList((prev) => prev.filter((_, i) => i !== index));
  };

  // Drag and Drop reordering handlers
  const handleDragStart = (e: DragEvent<HTMLDivElement>, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    
    const updatedList = [...concatFilesList];
    const [movedItem] = updatedList.splice(draggedIndex, 1);
    updatedList.splice(index, 0, movedItem);
    
    setConcatFilesList(updatedList);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Execute Concatenation
  const handleExecuteConcat = async () => {
    if (concatFilesList.length < 2) {
      alert('Por favor agrega al menos 2 archivos para concatenar.');
      return;
    }

    setIsConcatenating(true);
    const formData = new FormData();
    concatFilesList.forEach((f) => {
      formData.append('files', f);
    });

    try {
      const res = await fetch('/api/media/concat', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Fallo en la concatenación en el servidor.');
      }

      const data = await res.json();
      alert(`Archivos concatenados con éxito como: ${data.filepath}`);
      
      setLocalPath(data.filepath);
      setInputMethod('path');
      setConcatFilesList([]);
    } catch (err: any) {
      console.error(err);
      alert(`Error al concatenar audios: ${err.message}`);
    } finally {
      setIsConcatenating(false);
    }
  };

  // Submit Form Handler
  const handleFormSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (inputMethod === 'upload') {
      if (!file) {
        alert('Por favor selecciona un archivo para subir.');
        return;
      }
      await processSingleTranscription(file, undefined);
    } else if (inputMethod === 'path') {
      if (!localPath.trim()) {
        alert('Por favor escribe una ruta de archivo local.');
        return;
      }
      await processSingleTranscription(null, localPath.trim());
    } else if (inputMethod === 'batch') {
      const pendingItems = batchQueue.filter(item => item.status === 'pending');
      if (pendingItems.length === 0) {
        alert('Por favor agrega al menos un archivo a la cola de procesamiento en lote.');
        return;
      }

      setIsProcessing(true);
      startPollingStatus();

      for (const item of pendingItems) {
        setBatchQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'processing' } : q));

        try {
          const formData = new FormData();
          formData.append('backend', backend);
          formData.append('model_name', model);
          formData.append('language', language);
          formData.append('align', align ? 'true' : 'false');
          formData.append('diarize', diarize ? 'true' : 'false');
          if (diarize && hfToken.trim()) {
            formData.append('hf_token', hfToken);
          }
          formData.append('file', item.file);

          const res = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData
          });

          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Fallo en la transcripción.');
          }

          const data = await res.json();
          setBatchQueue(prev => prev.map(q => q.id === item.id ? {
            ...q,
            status: 'success',
            transcriptionId: data.id
          } : q));

          if (onTranscriptionSuccess) {
            onTranscriptionSuccess(data.id);
          }
        } catch (err: any) {
          console.error(err);
          setBatchQueue(prev => prev.map(q => q.id === item.id ? {
            ...q,
            status: 'error',
            errorMsg: err.message || 'Error durante la transcripción.'
          } : q));
        }
      }

      setIsProcessing(false);
      stopPollingStatus();
    }
  };

  const processSingleTranscription = async (fileObj: File | null, pathStr?: string) => {
    setIsProcessing(true);
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

    if (fileObj) {
      formData.append('file', fileObj);
    } else if (pathStr) {
      formData.append('filePath', pathStr);
    }

    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Fallo en la transcripción.');
      }

      const data = await res.json();
      if (onTranscriptionSuccess) {
        onTranscriptionSuccess(data.id);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Error durante la transcripción: ${err.message}`);
    } finally {
      setIsProcessing(false);
      stopPollingStatus();
    }
  };

  const handleAbort = async () => {
    if (!confirm('¿Estás seguro de que deseas abortar el procesamiento actual?')) return;
    try {
      await fetch('/api/abort', { method: 'POST' });
      alert('Aborto solicitado al servidor.');
    } catch (err) {
      console.error(err);
    }
  };

  const pendingBatchCount = batchQueue.filter(q => q.status === 'pending').length;

  return (
    <section id="transcription-tab" className={`tab-panel ${active ? 'active' : ''}`}>
      <div className="panel-header">
        <h2>Nueva Transcripción</h2>
        <p>Sube un archivo multimedia, procesa en lote o escribe una ruta local para transcribirlo con aceleración GPU NVIDIA CUDA.</p>
      </div>

      <div className="grid-layout">
        {/* Left Side: Parameters and inputs */}
        <form className="card glass-card" onSubmit={handleFormSubmit}>
          {/* Method Selector with 4 Tab Buttons */}
          <div className="form-group">
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.875rem' }}>Método de Entrada</label>
            <div className="tab-toggle" style={{ marginBottom: '1.25rem' }}>
              <button
                type="button"
                className={`toggle-btn ${inputMethod === 'upload' ? 'active' : ''}`}
                onClick={() => setInputMethod('upload')}
              >
                <i className="fa-solid fa-cloud-arrow-up" style={{ color: 'hsl(var(--primary))' }}></i> Subir Archivo
              </button>
              <button
                type="button"
                className={`toggle-btn ${inputMethod === 'batch' ? 'active' : ''}`}
                onClick={() => setInputMethod('batch')}
              >
                <i className="fa-solid fa-layer-group" style={{ color: 'var(--accent-light)' }}></i> Procesar Lote
              </button>
              <button
                type="button"
                className={`toggle-btn ${inputMethod === 'path' ? 'active' : ''}`}
                onClick={() => setInputMethod('path')}
              >
                <i className="fa-solid fa-folder-open" style={{ color: '#a855f7' }}></i> Ruta Local
              </button>
              <button
                type="button"
                className={`toggle-btn ${inputMethod === 'concat' ? 'active' : ''}`}
                onClick={() => setInputMethod('concat')}
              >
                <i className="fa-solid fa-object-group" style={{ color: '#10b981' }}></i> Concatenar
              </button>
            </div>
          </div>

          {/* Single File Upload Input */}
          {inputMethod === 'upload' && (
            <div className="form-group">
              <div className="drop-zone" onClick={() => fileInputRef.current?.click()} style={{ cursor: 'pointer' }}>
                <i className="fa-solid fa-cloud-arrow-up drop-icon"></i>
                <span className="drop-text">Arrastra tu archivo de audio/video o haz clic para buscar</span>
                <span className="file-name-label">{file ? file.name : 'Ningún archivo seleccionado'}</span>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleSingleFileChange}
                  accept="audio/*,video/*"
                  style={{ display: 'none' }}
                />
              </div>
            </div>
          )}

          {/* Batch File Queue Upload Input */}
          {inputMethod === 'batch' && (
            <div className="form-group">
              <div className="drop-zone" onClick={() => batchFileInputRef.current?.click()} style={{ cursor: 'pointer' }}>
                <i className="fa-solid fa-layer-group drop-icon"></i>
                <span className="drop-text">Arrastra múltiples archivos de audio/video para crear un lote</span>
                <span className="file-name-label">
                  {batchQueue.length > 0 
                    ? `${batchQueue.length} archivo(s) agregados` 
                    : 'Ningún archivo seleccionado'}
                </span>
                <input
                  type="file"
                  ref={batchFileInputRef}
                  onChange={handleBatchFileChange}
                  accept="audio/*,video/*"
                  multiple
                  style={{ display: 'none' }}
                />
              </div>

              {batchQueue.length > 0 && (
                <div className="concat-list" style={{ marginTop: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h4 style={{ margin: 0 }}>Archivos en la cola de transcripción ({batchQueue.length}):</h4>
                    {!isProcessing && (
                      <button
                        type="button"
                        onClick={clearBatchQueue}
                        style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer' }}
                      >
                        <i className="fa-solid fa-trash-can"></i> Limpiar todo
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                    {batchQueue.map((item, idx) => (
                      <div key={item.id} className="concat-item" style={{ marginBottom: 0 }}>
                        <span className="concat-item-text">
                          <strong>{idx + 1}.</strong> {item.file.name}
                        </span>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          {item.status === 'pending' && <span style={{ fontSize: '0.75rem', color: '#fde047' }}><i className="fa-solid fa-clock"></i> Pendiente</span>}
                          {item.status === 'processing' && <span style={{ fontSize: '0.75rem', color: '#818cf8' }}><i className="fa-solid fa-spinner fa-spin"></i> Transcribiendo...</span>}
                          {item.status === 'success' && <span style={{ fontSize: '0.75rem', color: '#4ade80' }}><i className="fa-solid fa-check"></i> Transcrito</span>}
                          {item.status === 'error' && <span style={{ fontSize: '0.75rem', color: '#f87171' }}><i className="fa-solid fa-xmark"></i> Error</span>}
                          
                          {!isProcessing && (
                            <button
                              type="button"
                              className="btn-remove-concat-item"
                              onClick={() => removeBatchQueueItem(item.id)}
                            >
                              <i className="fa-solid fa-xmark"></i>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Local File Path Input */}
          {inputMethod === 'path' && (
            <div className="form-group">
              <label htmlFor="file-path-input"><i className="fa-solid fa-folder-open"></i> Ruta absoluta o relativa al proyecto:</label>
              <input
                type="text"
                id="file-path-input"
                className="form-control"
                placeholder="/home/usuario/Grabaciones/reunion.mp3 o uploads/concat_xxxx.mp3"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
              />
            </div>
          )}

          {/* Concatenation Standalone View */}
          {inputMethod === 'concat' && (
            <div className="form-group">
              <div className="drop-zone" onClick={() => concatInputRef.current?.click()} style={{ cursor: 'pointer' }}>
                <i className="fa-solid fa-layer-group drop-icon"></i>
                <span className="drop-text">Haz clic aquí para agregar partes de audio/video una por una</span>
                <span className="file-name-label">
                  {concatFilesList.length > 0 
                    ? `${concatFilesList.length} partes agregadas` 
                    : 'Ningún archivo seleccionado'}
                </span>
                <input
                  type="file"
                  ref={concatInputRef}
                  onChange={handleConcatFileChange}
                  accept="audio/*,video/*"
                  style={{ display: 'none' }}
                />
              </div>

              {concatFilesList.length > 0 && (
                <div className="concat-list" style={{ marginTop: '1rem' }}>
                  <h4>Archivos a concatenar (se unirán en este orden):</h4>
                  <div style={{ marginBottom: '1rem' }}>
                    {concatFilesList.map((item, idx) => (
                      <div
                        key={idx}
                        className={`concat-item ${draggedIndex === idx ? 'dragging' : ''} ${dragOverIndex === idx ? 'drag-over' : ''}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDrop={(e) => handleDrop(e, idx)}
                      >
                        <span className="concat-drag-handle"><i className="fa-solid fa-grip-vertical"></i></span>
                        <span className="concat-item-text">
                          <strong>{idx + 1}.</strong> {item.name}
                        </span>
                        <button
                          type="button"
                          className="btn-remove-concat-item"
                          onClick={() => removeConcatItem(idx)}
                        >
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-full"
                    disabled={isConcatenating}
                    onClick={handleExecuteConcat}
                  >
                    {isConcatenating ? (
                      <><i className="fa-solid fa-spinner fa-spin"></i> Concatenando Audios con FFmpeg...</>
                    ) : (
                      <><i className="fa-solid fa-object-group"></i> Concatenar y Usar Resultado</>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Model selection & Transcription Form Options (Hidden when Concatenating) */}
          {inputMethod !== 'concat' && (
            <>
              <div className="form-row">
                <div className="form-group col">
                  <label htmlFor="backend">Motor / Pipeline</label>
                  <select id="backend" className="form-control" value={backend} onChange={handleBackendChange}>
                    <option value="whisperx">WhisperX (Recomendado - Acelerado CUDA + PyAnnote)</option>
                    <option value="nemo">NVIDIA NeMo Parakeet TDT (Soporte Español nativo)</option>
                  </select>
                </div>

                <div className="form-group col">
                  <label htmlFor="model">Modelo Whisper</label>
                  <select id="model" className="form-control" value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="large-v3">large-v3 (Máxima Precisión)</option>
                    <option value="large-v2">large-v2</option>

                    <option value="medium">medium</option>
                    <option value="small">small</option>
                    <option value="base">base</option>
                    <option value="tiny">tiny</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group col">
                  <label htmlFor="language">Idioma (opcional)</label>
                  <input
                    type="text"
                    id="language"
                    className="form-control"
                    placeholder="es, en, fr... (auto-detectar si está vacío)"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  />
                </div>
              </div>

              {/* Checkboxes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '1rem 0' }}>
                <label className="checkbox-container">
                  <input
                    type="checkbox"
                    checked={align}
                    disabled={backend !== 'whisperx'}
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

              {/* HF Token Input for Diarization */}
              {diarize && (
                <div className="form-group" style={{ marginTop: '0.5rem', padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <label htmlFor="hf-token-input" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <i className="fa-solid fa-key" style={{ color: '#f59e0b' }}></i> Token de HuggingFace (Requerido para PyAnnote):
                  </label>
                  <input
                    type="password"
                    id="hf-token-input"
                    className="form-control"
                    placeholder={hasHfToken ? "hf_... (Configurado en .env - Dejar vacío para usar default)" : "hf_... (Pega tu token hf_api_...)"}
                    value={hfToken}
                    onChange={(e) => setHfToken(e.target.value)}
                    style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}
                  />
                  {hasHfToken && !hfToken && (
                    <span style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '0.25rem', display: 'block' }}>
                      <i className="fa-solid fa-check-circle"></i> Token detectado en variables de entorno (.env)
                    </span>
                  )}
                </div>
              )}

              {/* Buttons */}
              <div className="form-actions" style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                <button
                  type="submit"
                  id="btn-start-transcribe"
                  className="submit-btn btn-full"
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <><i className="fa-solid fa-spinner fa-spin"></i> Transcribiendo...</>
                  ) : inputMethod === 'batch' ? (
                    <><i className="fa-solid fa-play"></i> Iniciar Transcripción en Lote ({pendingBatchCount})</>
                  ) : (
                    <><i className="fa-solid fa-play"></i> Iniciar Transcripción</>
                  )}
                </button>

                {isProcessing && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={handleAbort}
                    style={{ backgroundColor: '#ef4444', color: '#fff' }}
                  >
                    <i className="fa-solid fa-stop"></i> Abortar
                  </button>
                )}
              </div>
            </>
          )}
        </form>

        {/* Right Side: Status output and Viewer */}
        <div className="status-panel-container">
          <div className="card glass-card status-card">
            <h3>Estado del Servidor CUDA & Whisper</h3>
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

          {/* Historial de Grabaciones */}
          <div className="card glass-card">
            <h3>Historial de Grabaciones</h3>
            <p className="card-desc" style={{ fontSize: '12px', color: 'hsl(var(--text-muted))', marginTop: '-10px', marginBottom: '1rem' }}>
              Carga o elimina grabaciones previamente procesadas.
            </p>
            <div className="history-items-container" style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
              {transcriptionList.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'hsl(var(--text-muted))', textAlign: 'center', padding: '16px' }}>
                  Ninguna grabación guardada.
                </div>
              ) : (
                transcriptionList.map((item) => (
                  <div key={item.id} className={`history-item ${activeTranscriptionId === item.id ? 'active' : ''}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.02)', padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid var(--border-glass)' }}>
                    <div className="history-item-info" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flexGrow: 1, paddingRight: '0.5rem' }}>
                      <span className="history-item-title" title={item.filename} style={{ fontSize: '0.8125rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--accent-light)' }}>
                        {item.filename}
                      </span>
                      <span className="history-item-meta" style={{ fontSize: '0.6875rem', color: 'hsl(var(--text-muted))' }}>
                        {item.created_at?.substring(0, 16).replace('T', ' ')} ({item.word_count} palabras)
                      </span>
                    </div>
                    <div className="history-item-actions" style={{ display: 'flex', gap: '0.25rem' }}>
                      <button
                        type="button"
                        className="history-action-btn load-btn"
                        onClick={() => onLoadTranscription && onLoadTranscription(item.id)}
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)', color: '#fff', padding: '0.25rem 0.5rem', fontSize: '0.75rem', borderRadius: '0.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                      >
                        <i className="fa-solid fa-folder-open"></i> Cargar
                      </button>
                      <button
                        type="button"
                        className="history-action-btn delete-btn"
                        onClick={() => onDeleteTranscription && onDeleteTranscription(item.id, item.filename)}
                        style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#ef4444', padding: '0.25rem 0.5rem', fontSize: '0.75rem', borderRadius: '0.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                      >
                        <i className="fa-solid fa-trash"></i> Borrar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Inline Transcription Viewer */}
          <TranscriptionViewer
            transcriptionId={activeTranscriptionId ?? null}
            onDeleted={onViewerDeleted}
          />
        </div>
      </div>
    </section>
  );
}
