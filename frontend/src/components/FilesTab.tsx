import React, { useState, useRef, DragEvent, ChangeEvent } from 'react';

export interface QueueItem {
  id: string;
  file: File;
  compatible: boolean;
  compatibilityReason: string;
  typeLabel: string;
  icon: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  ingestMsg?: string;
  charCount?: number;
  chunkCount?: number;
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'csv', 'json', 'jsonl', 'ndjson',
  'py', 'js', 'ts', 'jsx', 'tsx',
  'html', 'htm', 'xml', 'yaml', 'yml',
  'toml', 'ini', 'cfg', 'env',
  'md', 'markdown', 'rst',
  'log', 'sh', 'bash', 'zsh', 'fish',
  'sql', 'r', 'rb', 'go', 'rs', 'java', 'cpp', 'c', 'h', 'cs',
  'php', 'swift', 'kt', 'scala', 'lua', 'pl', 'ex', 'exs',
  'pdf', 'docx', 'pptx',
  'png', 'jpg', 'jpeg', 'webp', 'bmp'
]);

const AUDIO_VIDEO_EXTENSIONS = new Set([
  'mp3', 'mp4', 'wav', 'm4a', 'mkv', 'avi', 'mov', 'flac', 'ogg', 'webm', 'wma', 'aac'
]);

function getExtension(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('es-MX', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function getTypeLabel(ext: string, mime: string): string {
  const map: Record<string, string> = {
    txt: 'Texto Plano', csv: 'CSV (Datos tabulares)', json: 'JSON',
    jsonl: 'JSON Lines', ndjson: 'NDJSON', py: 'Python', js: 'JavaScript',
    ts: 'TypeScript', jsx: 'React JSX', tsx: 'React TSX',
    html: 'HTML', htm: 'HTML', xml: 'XML', yaml: 'YAML', yml: 'YAML',
    toml: 'TOML', ini: 'INI Config', cfg: 'Config', env: 'Variables de Entorno',
    md: 'Markdown', markdown: 'Markdown', rst: 'reStructuredText',
    log: 'Registro de Log', sh: 'Shell Script', bash: 'Bash Script',
    sql: 'SQL', r: 'R Script', rb: 'Ruby', go: 'Go', rs: 'Rust',
    java: 'Java', cpp: 'C++', c: 'C', h: 'Header C/C++', cs: 'C#',
    php: 'PHP', swift: 'Swift', kt: 'Kotlin', scala: 'Scala',
    lua: 'Lua', pl: 'Perl',
    pdf: 'Documento PDF (Docling)', docx: 'Documento Word (Docling)', pptx: 'Presentación PowerPoint (Docling)',
    png: 'Imagen PNG (Gemma 4 Multimodal)', jpg: 'Imagen JPG (Gemma 4 Multimodal)', jpeg: 'Imagen JPEG (Gemma 4 Multimodal)', webp: 'Imagen WebP (Gemma 4 Multimodal)'
  };
  return map[ext] || (mime ? mime : `Archivo .${ext || 'desconocido'}`);
}

function getFileIcon(ext: string): string {
  if (['pdf'].includes(ext)) return 'fa-file-pdf';
  if (['docx'].includes(ext)) return 'fa-file-word';
  if (['pptx'].includes(ext)) return 'fa-file-powerpoint';
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) return 'fa-file-image';
  const codeExts = ['py','js','ts','jsx','tsx','html','htm','xml','yaml','yml','toml','ini','cfg','sh','bash','sql','r','rb','go','rs','java','cpp','c','h','cs','php','swift','kt','scala','lua','pl'];
  if (codeExts.includes(ext)) return 'fa-code';
  if (ext === 'csv') return 'fa-table';
  if (['json','jsonl','ndjson'].includes(ext)) return 'fa-brackets-curly';
  if (['md','markdown','rst'].includes(ext)) return 'fa-file-alt';
  if (ext === 'log') return 'fa-scroll';
  return 'fa-file-lines';
}

function analyzeQueueItem(file: File): QueueItem {
  const ext = getExtension(file.name);
  const compatible = TEXT_EXTENSIONS.has(ext) || file.type.startsWith('text/') || file.type.startsWith('image/') || file.type.includes('pdf') || file.type.includes('word') || file.type.includes('presentation');
  const typeLabel = getTypeLabel(ext, file.type);
  const icon = getFileIcon(ext);
  const compatibilityReason = compatible
    ? 'Este tipo de archivo puede ser analizado con Docling / Gemma 4 Multimodal e indexado en el RAG.'
    : `Tipo de archivo no compatible (.${ext || file.type || '?'}).`;

  return {
    id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    file,
    compatible,
    compatibilityReason,
    typeLabel,
    icon,
    status: 'pending'
  };
}

interface FilesTabProps {
  active: boolean;
  onIngested?: () => void;
  onRedirectToTranscription?: (file: File) => void;
}

export default function FilesTab({ active, onIngested, onRedirectToTranscription }: FilesTabProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [isProcessingBatch, setIsProcessingBatch] = useState<boolean>(false);
  const [mediaRedirectFile, setMediaRedirectFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFilesToQueue = (files: File[]) => {
    setMediaRedirectFile(null);
    const audioOrVideo = files.find(f => AUDIO_VIDEO_EXTENSIONS.has(getExtension(f.name)) || f.type.startsWith('audio/') || f.type.startsWith('video/'));
    if (audioOrVideo && onRedirectToTranscription) {
      setMediaRedirectFile(audioOrVideo);
    }

    const analyzed = files.map(analyzeQueueItem);
    setQueue(prev => {
      const existingNames = new Set(prev.map(i => i.file.name));
      const filteredNew = analyzed.filter(i => !existingNames.has(i.file.name));
      return [...prev, ...filteredNew];
    });
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFilesToQueue(Array.from(e.target.files));
    }
  };

  const removeItem = (id: string) => {
    setQueue(prev => prev.filter(i => i.id !== id));
  };

  const clearAll = () => {
    setQueue([]);
    setMediaRedirectFile(null);
  };

  const clearCompleted = () => {
    setQueue(prev => prev.filter(i => i.status !== 'success'));
  };

  const processBatch = async () => {
    const pendingItems = queue.filter(i => i.compatible && i.status === 'pending');
    if (pendingItems.length === 0) return;

    setIsProcessingBatch(true);

    for (const item of pendingItems) {
      setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'processing', ingestMsg: 'Analizando...' } : i));

      try {
        const formData = new FormData();
        formData.append('file', item.file);

        const res = await fetch('/api/ingest/file', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Fallo al procesar el archivo');

        setQueue(prev => prev.map(i => i.id === item.id ? {
          ...i,
          status: 'success',
          ingestMsg: `Indexado (${data.char_count || 0} chars, ${data.chunk_count || 0} chunks)`,
          charCount: data.char_count,
          chunkCount: data.chunk_count
        } : i));
      } catch (err: any) {
        setQueue(prev => prev.map(i => i.id === item.id ? {
          ...i,
          status: 'error',
          ingestMsg: err.message || 'Error de indexación'
        } : i));
      }
    }

    setIsProcessingBatch(false);
    if (onIngested) onIngested();
  };

  const singleItem = queue.length === 1 ? queue[0] : null;
  const pendingCount = queue.filter(i => i.compatible && i.status === 'pending').length;
  const completedCount = queue.filter(i => i.status === 'success').length;
  const totalCount = queue.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <section id="files-tab" className={`flex-col gap-6 w-full ${active ? 'flex' : 'hidden'}`}>
      <div className="mb-1">
        <h2 className="text-2xl font-semibold text-white tracking-tight mb-1">Ingestión de Archivos de Texto y Documentos</h2>
        <p className="text-sm text-zinc-400">Analiza e indexa archivos PDF, Word, imágenes y código fuente en la base de datos RAG usando Docling y Vision AI.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start w-full min-w-0">
        {/* Upload Drop Zone Card */}
        <div className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-4 w-full">
          <div 
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer flex flex-col items-center gap-3 transition-colors ${
              isDragOver ? 'border-amber-500 bg-amber-500/10' : 'border-white/15 bg-white/[0.01] hover:bg-white/[0.03] hover:border-amber-500'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <i className="fa-solid fa-cloud-arrow-up text-4xl text-zinc-500 mb-1"></i>
            <span className="text-sm font-medium text-white">Arrastra archivos de texto/documentos aquí</span>
            <span className="text-xs text-zinc-400">o haz clic para explorar en tu equipo (soporta múltiples archivos)</span>
            <span className="text-[11px] text-amber-400 mt-2 font-mono">
              Soporta: PDF, DOCX, PPTX, TXT, CSV, JSON, Markdown, Código e Imágenes (PNG, JPG, WebP)
            </span>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              multiple
              className="hidden"
            />
          </div>

          {/* Media File Detected Redirect Banner */}
          {mediaRedirectFile && (
            <div className="p-3.5 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-amber-400 font-medium">
                <i className="fa-solid fa-compact-disc text-base"></i>
                <span>Detectado audio/video: <strong>{mediaRedirectFile.name}</strong></span>
              </div>
              <button
                type="button"
                className="px-3 py-1.5 rounded-md bg-amber-500 text-zinc-950 font-semibold cursor-pointer hover:bg-amber-400 transition-colors shrink-0"
                onClick={() => onRedirectToTranscription && onRedirectToTranscription(mediaRedirectFile)}
              >
                Ir a Transcripción
              </button>
            </div>
          )}
        </div>

        {/* Single File Details Card */}
        {singleItem && (
          <div className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-4 w-full">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <i className={`fa-solid ${singleItem.icon} text-amber-500`}></i>
                {singleItem.typeLabel}
              </h3>
              <button 
                type="button" 
                className="text-xs text-zinc-400 hover:text-red-400 cursor-pointer"
                onClick={() => removeItem(singleItem.id)}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/10 flex flex-col gap-0.5">
                <span className="text-zinc-500 font-medium"><i className="fa-solid fa-file mr-1"></i> Nombre</span>
                <span className="text-white font-semibold truncate" title={singleItem.file.name}>{singleItem.file.name}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/10 flex flex-col gap-0.5">
                <span className="text-zinc-500 font-medium"><i className="fa-solid fa-tag mr-1"></i> Tipo MIME</span>
                <span className="text-white font-semibold truncate">{singleItem.file.type || 'desconocido'}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/10 flex flex-col gap-0.5">
                <span className="text-zinc-500 font-medium"><i className="fa-solid fa-weight-hanging mr-1"></i> Tamaño</span>
                <span className="text-white font-semibold">{formatBytes(singleItem.file.size)}</span>
              </div>
              <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/10 flex flex-col gap-0.5">
                <span className="text-zinc-500 font-medium"><i className="fa-solid fa-calendar mr-1"></i> Modificado</span>
                <span className="text-white font-semibold">{formatDate(singleItem.file.lastModified)}</span>
              </div>
            </div>

            <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
              singleItem.compatible ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}>
              <i className={`fa-solid ${singleItem.compatible ? 'fa-lightbulb' : 'fa-triangle-exclamation'}`}></i>
              {singleItem.compatibilityReason}
            </div>

            {singleItem.compatible && (
              <button
                type="button"
                id="btn-ingest-file"
                className="w-full py-3 px-5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50 mt-1"
                onClick={processBatch}
                disabled={isProcessingBatch || singleItem.status === 'success'}
              >
                {isProcessingBatch ? (
                  <><i className="fa-solid fa-brain fa-spin"></i> Procesando con Visión AI & RAG...</>
                ) : singleItem.status === 'success' ? (
                  <><i className="fa-solid fa-circle-check"></i> Indexado Correctamente</>
                ) : (
                  <><i className="fa-solid fa-database"></i> Agregar al RAG</>  
                )}
              </button>
            )}
          </div>
        )}

        {/* Multi-File Batch Queue View */}
        {queue.length > 1 && (
          <div className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-4 w-full">
            <div className="flex items-center justify-between flex-wrap gap-3 pb-2 border-b border-white/10">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <i className="fa-solid fa-list-check text-indigo-400"></i>
                  Cola de Procesamiento en Lote ({queue.length} archivos)
                </h3>
                {isProcessingBatch && (
                  <span className="text-xs text-indigo-400 mt-1 inline-block">
                    <i className="fa-solid fa-spinner fa-spin"></i> Procesando {completedCount + 1} de {totalCount} ({progressPercent}%)...
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {successCount > 0 && !isProcessingBatch && (
                  <button className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium cursor-pointer" onClick={clearCompleted}>
                    <i className="fa-solid fa-broom"></i> Limpiar Completados
                  </button>
                )}
                {!isProcessingBatch && (
                  <button className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium cursor-pointer" onClick={clearAll}>
                    <i className="fa-solid fa-trash-can"></i> Vaciar Cola
                  </button>
                )}
                <button
                  className="py-1.5 px-4 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  onClick={processBatch}
                  disabled={isProcessingBatch || pendingCount === 0}
                >
                  {isProcessingBatch ? (
                    <><i className="fa-solid fa-brain fa-spin"></i> Procesando Lote...</>
                  ) : (
                    <><i className="fa-solid fa-play"></i> Procesar Lote ({pendingCount})</>
                  )}
                </button>
              </div>
            </div>

            {/* Batch Progress Bar */}
            {isProcessingBatch && (
              <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                <div className="bg-amber-500 h-full transition-all duration-300" style={{ width: `${progressPercent}%` }}></div>
              </div>
            )}

            {/* Queue List */}
            <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
              {queue.map(item => (
                <div
                  key={item.id}
                  className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-3 transition-colors ${
                    item.status === 'processing'
                      ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                      : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <i className={`fa-solid ${item.icon} text-lg text-indigo-400 w-6 text-center`}></i>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white truncate" title={item.file.name}>
                          {item.file.name}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-white/10 text-zinc-400 text-[10px]">
                          {formatBytes(item.file.size)}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {item.ingestMsg || item.typeLabel}
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === 'pending' && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">
                        <i className="fa-solid fa-clock"></i> Pendiente
                      </span>
                    )}

                    {item.status === 'processing' && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                        <i className="fa-solid fa-spinner fa-spin"></i> Procesando...
                      </span>
                    )}

                    {item.status === 'success' && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        <i className="fa-solid fa-check"></i> Indexado
                      </span>
                    )}

                    {item.status === 'error' && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
                        <i className="fa-solid fa-xmark"></i> Error
                      </span>
                    )}

                    {!isProcessingBatch && (
                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-zinc-500 hover:text-red-400 cursor-pointer p-1"
                        title="Quitar de la cola"
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
    </section>
  );
}
