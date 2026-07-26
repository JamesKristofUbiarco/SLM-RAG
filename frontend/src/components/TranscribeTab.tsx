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
    if (val === 'nemo') {
      setAlign(false);
    }
  };

  // UI state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // References to file inputs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchFileInputRef = useRef<HTMLInputElement>(null);
  const concatInputRef = useRef<HTMLInputElement>(null);

  // Drag and drop states for concat ordering
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isConcatenating, setIsConcatenating] = useState<boolean>(false);

  // Synchronize state when background task status changes
  React.useEffect(() => {
    if (statusData) {
      setIsProcessing(statusData.is_running);
    }
  }, [statusData]);

  const handleSingleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleBatchFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files).map(f => ({
        id: Math.random().toString(36).substring(2, 9),
        file: f,
        status: 'pending' as const
      }));
      setBatchQueue(prev => [...prev, ...newFiles]);
    }
  };

  const removeBatchQueueItem = (id: string) => {
    setBatchQueue(prev => prev.filter(item => item.id !== id));
  };

  const clearBatchQueue = () => {
    setBatchQueue([]);
  };

  const handleConcatFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const added = Array.from(e.target.files);
      setConcatFilesList(prev => [...prev, ...added]);
    }
  };

  const removeConcatItem = (index: number) => {
    setConcatFilesList(prev => prev.filter((_, i) => i !== index));
  };

  // Drag & drop handlers for concatenating list
  const handleDragStart = (e: DragEvent<HTMLDivElement>, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    setDragOverIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;
    
    const updatedList = [...concatFilesList];
    const [movedItem] = updatedList.splice(draggedIndex, 1);
    updatedList.splice(targetIndex, 0, movedItem);
    
    setConcatFilesList(updatedList);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleExecuteConcat = async () => {
    if (concatFilesList.length === 0) {
      alert("Por favor agrega al menos un archivo para concatenar.");
      return;
    }
    try {
      setIsConcatenating(true);
      const formData = new FormData();
      concatFilesList.forEach(f => formData.append('files', f));
      
      const res = await fetch('/api/transcribe/concat', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error al concatenar");
      
      setLocalPath(data.concat_path);
      setInputMethod('path');
      alert(`¡Audios concatenados con éxito! Ruta guardada:\n${data.concat_path}`);
    } catch (err: any) {
      alert(`Error de concatenación: ${err.message}`);
    } finally {
      setIsConcatenating(false);
    }
  };

  const handleFormSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (inputMethod === 'upload' && !file) {
      alert("Por favor selecciona un archivo de audio/video para transcribir.");
      return;
    }
    if (inputMethod === 'batch' && batchQueue.length === 0) {
      alert("Por favor selecciona al menos un archivo en la cola de procesamiento en lote.");
      return;
    }
    if (inputMethod === 'path' && !localPath.trim()) {
      alert("Por favor escribe una ruta válida de archivo.");
      return;
    }

    setIsProcessing(true);
    startPollingStatus();

    try {
      if (inputMethod === 'batch') {
        const formData = new FormData();
        batchQueue.forEach(item => formData.append('files', item.file));
        formData.append('backend', backend);
        formData.append('model', model);
        if (language) formData.append('language', language);
        formData.append('diarize', String(diarize));
        if (hfToken) formData.append('hf_token', hfToken);
        formData.append('align', String(align));

        const response = await fetch('/api/transcribe/batch', {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Falló el inicio del lote');

        alert(`Lote iniciado: ${data.total_queued} archivos en cola.`);
      } else {
        const formData = new FormData();
        if (inputMethod === 'upload' && file) {
          formData.append('file', file);
        } else if (inputMethod === 'path') {
          formData.append('file_path', localPath);
        }
        
        formData.append('backend', backend);
        formData.append('model', model);
        if (language) formData.append('language', language);
        formData.append('diarize', String(diarize));
        if (hfToken) formData.append('hf_token', hfToken);
        formData.append('align', String(align));

        const response = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Falló la transcripción');

        if (data.id) {
          onTranscriptionSuccess(data.id);
        }
      }
    } catch (err: any) {
      alert(`Error en el proceso: ${err.message}`);
      setIsProcessing(false);
      stopPollingStatus();
    }
  };

  const handleAbort = async () => {
    try {
      await fetch('/api/transcribe/abort', { method: 'POST' });
      setIsProcessing(false);
      stopPollingStatus();
    } catch (err) {
      console.error("Error al abortar:", err);
    }
  };

  const pendingBatchCount = batchQueue.filter(i => i.status === 'pending' || i.status === 'processing').length;

  return (
    <section id="transcription-tab" className={`flex-col gap-6 w-full ${active ? 'flex' : 'hidden'}`}>
      {/* Header */}
      <div className="mb-1">
        <h2 className="text-2xl font-semibold text-white tracking-tight mb-1">Nueva Transcripción</h2>
        <p className="text-sm text-zinc-400">Sube un archivo multimedia, procesa en lote o escribe una ruta local para transcribirlo con aceleración GPU NVIDIA CUDA.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start w-full min-w-0">
        {/* Left Side: Parameters and inputs form */}
        <form className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-5 w-full min-w-0" onSubmit={handleFormSubmit}>
          {/* Method Selector */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-zinc-200">Método de Entrada</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1.5 bg-black/40 border border-white/10 rounded-xl w-full">
              <button
                type="button"
                className={`flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  inputMethod === 'upload'
                    ? 'bg-amber-500/15 border border-amber-500/35 text-amber-400 font-semibold shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                onClick={() => setInputMethod('upload')}
              >
                <i className="fa-solid fa-cloud-arrow-up text-amber-500"></i> Subir Archivo
              </button>

              <button
                type="button"
                className={`flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  inputMethod === 'batch'
                    ? 'bg-amber-500/15 border border-amber-500/35 text-amber-400 font-semibold shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                onClick={() => setInputMethod('batch')}
              >
                <i className="fa-solid fa-layer-group text-orange-400"></i> Procesar Lote
              </button>

              <button
                type="button"
                className={`flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  inputMethod === 'path'
                    ? 'bg-amber-500/15 border border-amber-500/35 text-amber-400 font-semibold shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                onClick={() => setInputMethod('path')}
              >
                <i className="fa-solid fa-folder-open text-purple-400"></i> Ruta Local
              </button>

              <button
                type="button"
                className={`flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  inputMethod === 'concat'
                    ? 'bg-amber-500/15 border border-amber-500/35 text-amber-400 font-semibold shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                onClick={() => setInputMethod('concat')}
              >
                <i className="fa-solid fa-object-group text-emerald-400"></i> Concatenar
              </button>
            </div>
          </div>

          {/* Single File Upload Input */}
          {inputMethod === 'upload' && (
            <div className="flex flex-col gap-1.5">
              <div 
                className="border-2 border-dashed border-white/15 hover:border-amber-500 rounded-xl p-8 text-center cursor-pointer flex flex-col items-center gap-3 bg-white/[0.01] hover:bg-white/[0.03] transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <i className="fa-solid fa-cloud-arrow-up text-3xl text-zinc-500"></i>
                <span className="text-xs text-zinc-400">Arrastra tu archivo de audio/video o haz clic para buscar</span>
                <span className="text-xs font-semibold text-amber-400 break-all">{file ? file.name : 'Ningún archivo seleccionado'}</span>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleSingleFileChange}
                  accept="audio/*,video/*"
                  className="hidden"
                />
              </div>
            </div>
          )}

          {/* Batch File Queue Upload Input */}
          {inputMethod === 'batch' && (
            <div className="flex flex-col gap-3">
              <div 
                className="border-2 border-dashed border-white/15 hover:border-amber-500 rounded-xl p-8 text-center cursor-pointer flex flex-col items-center gap-3 bg-white/[0.01] hover:bg-white/[0.03] transition-colors"
                onClick={() => batchFileInputRef.current?.click()}
              >
                <i className="fa-solid fa-layer-group text-3xl text-zinc-500"></i>
                <span className="text-xs text-zinc-400">Arrastra múltiples archivos de audio/video para crear un lote</span>
                <span className="text-xs font-semibold text-amber-400 break-all">
                  {batchQueue.length > 0 ? `${batchQueue.length} archivo(s) agregados` : 'Ningún archivo seleccionado'}
                </span>
                <input
                  type="file"
                  ref={batchFileInputRef}
                  onChange={handleBatchFileChange}
                  accept="audio/*,video/*"
                  multiple
                  className="hidden"
                />
              </div>

              {batchQueue.length > 0 && (
                <div className="flex flex-col gap-2 mt-2">
                  <div className="flex justify-between items-center text-xs font-medium text-zinc-300">
                    <span>Archivos en la cola ({batchQueue.length}):</span>
                    {!isProcessing && (
                      <button
                        type="button"
                        onClick={clearBatchQueue}
                        className="text-zinc-400 hover:text-red-400 text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <i className="fa-solid fa-trash-can"></i> Limpiar todo
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {batchQueue.map((item, idx) => (
                      <div key={item.id} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/10 text-xs">
                        <span className="truncate max-w-[70%] text-zinc-300">
                          <strong className="text-amber-400 mr-1">{idx + 1}.</strong> {item.file.name}
                        </span>

                        <div className="flex items-center gap-2 shrink-0">
                          {item.status === 'pending' && <span className="text-yellow-300 text-[11px]"><i className="fa-solid fa-clock mr-1"></i> Pendiente</span>}
                          {item.status === 'processing' && <span className="text-indigo-400 text-[11px]"><i className="fa-solid fa-spinner fa-spin mr-1"></i> Transcribiendo...</span>}
                          {item.status === 'success' && <span className="text-emerald-400 text-[11px]"><i className="fa-solid fa-check mr-1"></i> Transcrito</span>}
                          {item.status === 'error' && <span className="text-red-400 text-[11px]"><i className="fa-solid fa-xmark mr-1"></i> Error</span>}
                          
                          {!isProcessing && (
                            <button
                              type="button"
                              className="text-zinc-500 hover:text-red-400 cursor-pointer"
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
            <div className="flex flex-col gap-1.5">
              <label htmlFor="file-path-input" className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                <i className="fa-solid fa-folder-open text-amber-500"></i> Ruta absoluta o relativa al proyecto:
              </label>
              <input
                type="text"
                id="file-path-input"
                className="w-full bg-white/[0.03] border border-white/10 rounded-lg text-white px-3.5 py-2 text-sm focus:outline-none focus:border-amber-500 focus:bg-white/[0.05] transition-colors"
                placeholder="/home/usuario/Grabaciones/reunion.mp3 o uploads/concat_xxxx.mp3"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
              />
            </div>
          )}

          {/* Concatenation Standalone View */}
          {inputMethod === 'concat' && (
            <div className="flex flex-col gap-3">
              <div 
                className="border-2 border-dashed border-white/15 hover:border-amber-500 rounded-xl p-8 text-center cursor-pointer flex flex-col items-center gap-3 bg-white/[0.01] hover:bg-white/[0.03] transition-colors"
                onClick={() => concatInputRef.current?.click()}
              >
                <i className="fa-solid fa-layer-group text-3xl text-zinc-500"></i>
                <span className="text-xs text-zinc-400">Haz clic aquí para agregar partes de audio/video una por una</span>
                <span className="text-xs font-semibold text-amber-400 break-all">
                  {concatFilesList.length > 0 ? `${concatFilesList.length} partes agregadas` : 'Ningún archivo seleccionado'}
                </span>
                <input
                  type="file"
                  ref={concatInputRef}
                  onChange={handleConcatFileChange}
                  accept="audio/*,video/*"
                  className="hidden"
                />
              </div>

              {concatFilesList.length > 0 && (
                <div className="flex flex-col gap-2 mt-2">
                  <span className="text-xs font-medium text-zinc-300">Archivos a concatenar (se unirán en este orden):</span>
                  <div className="flex flex-col gap-1.5">
                    {concatFilesList.map((item, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/10 text-xs ${
                          draggedIndex === idx ? 'opacity-50' : ''
                        } ${dragOverIndex === idx ? 'border-amber-500' : ''}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDrop={(e) => handleDrop(e, idx)}
                      >
                        <span className="cursor-grab text-zinc-500 mr-2"><i className="fa-solid fa-grip-vertical"></i></span>
                        <span className="truncate flex-1 text-zinc-300">
                          <strong className="text-amber-400 mr-1">{idx + 1}.</strong> {item.name}
                        </span>
                        <button
                          type="button"
                          className="text-zinc-500 hover:text-red-400 cursor-pointer ml-2"
                          onClick={() => removeConcatItem(idx)}
                        >
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="w-full py-2.5 px-4 bg-white/10 hover:bg-white/15 text-white font-medium text-xs rounded-lg transition-colors cursor-pointer disabled:opacity-50 mt-2 flex items-center justify-center gap-2"
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

          {/* Model selection & Form Options */}
          {inputMethod !== 'concat' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="backend" className="text-xs font-semibold text-zinc-300">Motor / Pipeline</label>
                  <select 
                    id="backend" 
                    className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white px-3 py-2 text-xs focus:outline-none focus:border-amber-500 transition-colors" 
                    value={backend} 
                    onChange={handleBackendChange}
                  >
                    <option value="whisperx">WhisperX (Recomendado - CUDA + PyAnnote)</option>
                    <option value="nemo">NVIDIA NeMo Parakeet TDT (Español Nativo)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="model" className="text-xs font-semibold text-zinc-300">Modelo Whisper</label>
                  <select 
                    id="model" 
                    className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white px-3 py-2 text-xs focus:outline-none focus:border-amber-500 transition-colors" 
                    value={model} 
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="large-v3">large-v3 (Máxima Precisión)</option>
                    <option value="large-v2">large-v2</option>
                    <option value="medium">medium</option>
                    <option value="small">small</option>
                    <option value="base">base</option>
                    <option value="tiny">tiny</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="language" className="text-xs font-semibold text-zinc-300">Idioma (opcional)</label>
                <input
                  type="text"
                  id="language"
                  className="w-full bg-white/[0.03] border border-white/10 rounded-lg text-white px-3.5 py-2 text-xs focus:outline-none focus:border-amber-500 transition-colors"
                  placeholder="es, en, fr... (auto-detectar si está vacío)"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                />
              </div>

              {/* Checkboxes */}
              <div className="flex flex-col gap-2 my-1">
                <label className="flex items-center gap-2.5 text-xs text-zinc-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-amber-500 rounded border-white/10 bg-white/5 cursor-pointer"
                    checked={align}
                    disabled={backend !== 'whisperx'}
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

              {/* HF Token Input for Diarization */}
              {diarize && (
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/10 flex flex-col gap-1.5">
                  <label htmlFor="hf-token-input" className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <i className="fa-solid fa-key text-amber-400"></i> Token de HuggingFace (PyAnnote):
                  </label>
                  <input
                    type="password"
                    id="hf-token-input"
                    className="w-full bg-white/[0.04] border border-white/10 rounded-lg text-white px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500"
                    placeholder={hasHfToken ? "hf_... (Configurado en .env - Dejar vacío para usar default)" : "hf_... (Pega tu token hf_api_...)"}
                    value={hfToken}
                    onChange={(e) => setHfToken(e.target.value)}
                  />
                  {hasHfToken && !hfToken && (
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                      <i className="fa-solid fa-check-circle"></i> Token detectado en variables de entorno (.env)
                    </span>
                  )}
                </div>
              )}

              {/* Buttons */}
              <div className="flex items-center gap-3 mt-2">
                <button
                  type="submit"
                  id="btn-start-transcribe"
                  className="flex-1 py-3 px-5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-semibold text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50"
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
                    className="py-3 px-4 bg-red-600 hover:bg-red-500 text-white font-semibold text-sm rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    onClick={handleAbort}
                  >
                    <i className="fa-solid fa-stop"></i> Abortar
                  </button>
                )}
              </div>
            </>
          )}
        </form>

        {/* Right Side: Status output and Viewer */}
        <div className="flex flex-col gap-6 w-full min-w-0">
          {/* CUDA & Whisper Status Card */}
          <div className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-4 w-full min-w-0">
            <h3 className="text-lg font-semibold text-white">Estado del Servidor CUDA & Whisper</h3>
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
          <div className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-3 w-full min-w-0">
            <div>
              <h3 className="text-lg font-semibold text-white">Historial de Grabaciones</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Carga o elimina grabaciones previamente procesadas.
              </p>
            </div>

            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
              {transcriptionList.length === 0 ? (
                <div className="text-xs text-zinc-500 text-center py-6">
                  Ninguna grabación guardada.
                </div>
              ) : (
                transcriptionList.map((item) => (
                  <div key={item.id} className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors min-w-0 ${
                    activeTranscriptionId === item.id 
                      ? 'bg-amber-500/10 border-amber-500/40' 
                      : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'
                  }`}>
                    <div className="flex flex-col min-w-0 flex-1 mr-3">
                      <span className="text-xs font-semibold text-amber-400 truncate" title={item.filename}>
                        {item.filename}
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        {item.created_at?.substring(0, 16).replace('T', ' ')} ({item.word_count} palabras)
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onLoadTranscription && onLoadTranscription(item.id)}
                        className="px-2.5 py-1 text-xs font-medium text-white bg-white/10 hover:bg-white/20 rounded-md border border-white/10 flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <i className="fa-solid fa-folder-open text-amber-400"></i> Cargar
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteTranscription && onDeleteTranscription(item.id, item.filename)}
                        className="px-2.5 py-1 text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-md border border-red-500/20 flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <i className="fa-solid fa-trash text-red-400"></i> Borrar
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
