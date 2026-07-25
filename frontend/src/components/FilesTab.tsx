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
  const [isProcessingBatch, setIsProcessingBatch] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | Array<File> | null) => {
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);

    const mediaFiles: File[] = [];
    const docFiles: File[] = [];

    fileList.forEach(file => {
      const ext = getExtension(file.name);
      const isMedia = AUDIO_VIDEO_EXTENSIONS.has(ext) || file.type.startsWith('audio/') || file.type.startsWith('video/');
      if (isMedia) {
        mediaFiles.push(file);
      } else {
        docFiles.push(file);
      }
    });

    if (mediaFiles.length > 0 && onRedirectToTranscription) {
      onRedirectToTranscription(mediaFiles[0]);
    }

    if (docFiles.length > 0) {
      const newItems = docFiles.map(analyzeQueueItem);
      setQueue(prev => [...prev, ...newItems]);
    }
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
    handleFiles(e.dataTransfer.files);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeItem = (id: string) => {
    if (isProcessingBatch) return;
    setQueue(prev => prev.filter(item => item.id !== id));
  };

  const clearCompleted = () => {
    if (isProcessingBatch) return;
    setQueue(prev => prev.filter(item => item.status !== 'success'));
  };

  const clearAll = () => {
    if (isProcessingBatch) return;
    setQueue([]);
  };

  // Sequential batch processing loop
  const processBatch = async () => {
    const pendingItems = queue.filter(item => item.compatible && item.status === 'pending');
    if (pendingItems.length === 0 || isProcessingBatch) return;

    setIsProcessingBatch(true);

    for (const item of pendingItems) {
      setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'processing', ingestMsg: 'Analizando maquetación e indexando en RAG...' } : q));

      try {
        const formData = new FormData();
        formData.append('file', item.file);
        const res = await fetch('/api/ingest_file', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: 'Error del servidor' }));
          throw new Error(err.detail || 'Error desconocido');
        }

        const data = await res.json();
        const charCount = data.char_count || 0;
        const chunkCount = Math.ceil(charCount / 800);

        setQueue(prev => prev.map(q => q.id === item.id ? {
          ...q,
          status: 'success',
          charCount,
          chunkCount,
          ingestMsg: `Indexado correctamente — ${charCount.toLocaleString()} caracteres en ${chunkCount} fragmentos.`
        } : q));

        onIngested?.();
      } catch (e: any) {
        setQueue(prev => prev.map(q => q.id === item.id ? {
          ...q,
          status: 'error',
          ingestMsg: e.message || 'Error al indexar el archivo en RAG.'
        } : q));
      }
    }

    setIsProcessingBatch(false);
  };

  const singleItem = queue.length === 1 ? queue[0] : null;
  const pendingCount = queue.filter(item => item.compatible && item.status === 'pending').length;
  const successCount = queue.filter(item => item.status === 'success').length;
  const errorCount = queue.filter(item => item.status === 'error').length;
  const totalCount = queue.length;
  const completedCount = successCount + errorCount;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <section id="files-tab" className={`tab-panel ${active ? 'active' : ''}`}>
      <div className="section-header">
        <h2><i className="fa-solid fa-folder-open"></i> Ingestión de Archivos (RAG)</h2>
        <p className="section-description">
          Sube documentos (.pdf, .docx, .pptx, código e imágenes). Soporta procesamiento individual y en lote secuencial para acelerar RAG sin saturar la VRAM.
        </p>
      </div>

      <div className="files-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Dropzone with native .drop-zone CSS class */}
        <div
          className={`drop-zone ${isDragOver ? 'drag-active' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{ cursor: 'pointer' }}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
            multiple
          />
          <i
            className="fa-solid fa-file-arrow-up drop-icon"
            style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: '#818cf8' }}
          ></i>
          <span className="drop-text" style={{ fontSize: '1rem', fontWeight: 600 }}>
            Haz clic o arrastra uno o varios archivos aquí
          </span>
          <span className="drop-text" style={{ fontSize: '0.85rem', opacity: 0.7 }}>
            Soporta PDFs, Word, PowerPoint, imágenes (.png, .jpg), código fuente y texto plano.
          </span>
          {singleItem && (
            <span className="file-name-label" style={{ marginTop: '0.5rem' }}>
              <i className="fa-solid fa-paperclip"></i> {singleItem.file.name}
            </span>
          )}
        </div>

        {/* ── Single File View (Exact Original Metadata Card) ─────────────────────── */}
        {singleItem && (
          <div className="files-metadata-card">
            <div className="files-meta-header">
              <span className="files-meta-type-badge">
                <i className={`fa-solid ${singleItem.icon}`}></i>
                {singleItem.typeLabel}
              </span>
              <span
                className={`files-compat-badge ${singleItem.compatible ? 'compat-ok' : 'compat-no'}`}
              >
                <i className={`fa-solid ${singleItem.compatible ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i>
                {singleItem.compatible ? 'Compatible' : 'No compatible'}
              </span>
            </div>

            <div className="files-meta-grid">
              <div className="files-meta-item">
                <span className="files-meta-label">
                  <i className="fa-solid fa-file"></i> Nombre
                </span>
                <span className="files-meta-value" title={singleItem.file.name}>
                  {singleItem.file.name}
                </span>
              </div>
              <div className="files-meta-item">
                <span className="files-meta-label">
                  <i className="fa-solid fa-tag"></i> Tipo MIME
                </span>
                <span className="files-meta-value">
                  {singleItem.file.type || 'desconocido'}
                </span>
              </div>
              <div className="files-meta-item">
                <span className="files-meta-label">
                  <i className="fa-solid fa-weight-hanging"></i> Tamaño
                </span>
                <span className="files-meta-value">
                  {formatBytes(singleItem.file.size)}
                </span>
              </div>
              <div className="files-meta-item">
                <span className="files-meta-label">
                  <i className="fa-solid fa-calendar"></i> Última modificación
                </span>
                <span className="files-meta-value">
                  {formatDate(singleItem.file.lastModified)}
                </span>
              </div>
            </div>

            <div className={`files-compat-message ${singleItem.compatible ? 'compat-ok' : 'compat-no'}`}>
              <i className={`fa-solid ${singleItem.compatible ? 'fa-lightbulb' : 'fa-triangle-exclamation'}`}></i>
              {singleItem.compatibilityReason}
            </div>

            {/* Ingest button */}
            {singleItem.compatible && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <button
                  id="btn-ingest-file"
                  className="btn btn-primary"
                  onClick={processBatch}
                  disabled={isProcessingBatch || singleItem.status === 'success'}
                  style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  {isProcessingBatch ? (
                    <><i className="fa-solid fa-brain fa-spin"></i> Procesando con Visión AI & RAG...</>
                  ) : singleItem.status === 'success' ? (
                    <><i className="fa-solid fa-circle-check"></i> Indexado Correctamente</>
                  ) : (
                    <><i className="fa-solid fa-database"></i> Agregar al RAG</>  
                  )}
                </button>

                {isProcessingBatch && (
                  <div className="files-compat-message compat-ok" style={{ marginTop: 0, opacity: 0.85 }}>
                    <i className="fa-solid fa-eye fa-pulse"></i>
                    Analizando estructura y transcripción por visión multimodal con Gemma 4. Esto toma entre 15 y 30 segundos...
                  </div>
                )}

                {singleItem.status === 'success' && singleItem.ingestMsg && (
                  <div className="files-compat-message compat-ok" style={{ marginTop: 0 }}>
                    <i className="fa-solid fa-circle-check"></i>
                    {singleItem.ingestMsg}
                  </div>
                )}
                {singleItem.status === 'error' && singleItem.ingestMsg && (
                  <div className="files-compat-message compat-no" style={{ marginTop: 0 }}>
                    <i className="fa-solid fa-circle-xmark"></i>
                    {singleItem.ingestMsg}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Multi-File Batch Queue View ─────────────────────────────────── */}
        {queue.length > 1 && (
          <div className="files-metadata-card">
            <div className="queue-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f8fafc' }}>
                  <i className="fa-solid fa-list-check" style={{ color: '#818cf8' }}></i>
                  Cola de Procesamiento en Lote ({queue.length} archivos)
                </h3>
                {isProcessingBatch && (
                  <span style={{ fontSize: '0.85rem', color: '#818cf8', marginTop: '0.2rem', display: 'inline-block' }}>
                    <i className="fa-solid fa-spinner fa-spin"></i> Procesando {completedCount + 1} de {totalCount} ({progressPercent}%)...
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {successCount > 0 && !isProcessingBatch && (
                  <button className="btn btn-secondary" onClick={clearCompleted} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                    <i className="fa-solid fa-broom"></i> Limpiar Completados
                  </button>
                )}
                {!isProcessingBatch && (
                  <button className="btn btn-secondary" onClick={clearAll} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                    <i className="fa-solid fa-trash-can"></i> Vaciar Cola
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  onClick={processBatch}
                  disabled={isProcessingBatch || pendingCount === 0}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem' }}
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
              <div style={{ width: '100%', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '0.75rem' }}>
                <div style={{ width: `${progressPercent}%`, backgroundColor: '#6366f1', height: '100%', transition: 'width 0.3s ease' }}></div>
              </div>
            )}

            {/* Queue List Table */}
            <div className="queue-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {queue.map(item => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.75rem 1rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: item.status === 'processing' ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '6px',
                    gap: '1rem',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flex: 1, minWidth: 0 }}>
                    <i className={`fa-solid ${item.icon}`} style={{ fontSize: '1.3rem', color: '#818cf8', width: '24px', textAlign: 'center' }}></i>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.15rem' }}>
                        <span style={{ fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.file.name}>
                          {item.file.name}
                        </span>
                        <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.4rem', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.08)', color: '#94a3b8' }}>
                          {formatBytes(item.file.size)}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                        {item.ingestMsg || item.typeLabel}
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {item.status === 'pending' && (
                      <span className="status-badge status-pending" style={{ padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', backgroundColor: 'rgba(234, 179, 8, 0.15)', color: '#fde047', border: '1px solid rgba(234, 179, 8, 0.3)' }}>
                        <i className="fa-solid fa-clock"></i> Pendiente
                      </span>
                    )}

                    {item.status === 'processing' && (
                      <span className="status-badge status-processing" style={{ padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', backgroundColor: 'rgba(99, 102, 241, 0.2)', color: '#818cf8', border: '1px solid #6366f1' }}>
                        <i className="fa-solid fa-spinner fa-spin"></i> Procesando...
                      </span>
                    )}

                    {item.status === 'success' && (
                      <span className="status-badge status-success" style={{ padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                        <i className="fa-solid fa-check"></i> Indexado
                      </span>
                    )}

                    {item.status === 'error' && (
                      <span className="status-badge status-error" style={{ padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                        <i className="fa-solid fa-xmark"></i> Error
                      </span>
                    )}

                    {!isProcessingBatch && (
                      <button
                        onClick={() => removeItem(item.id)}
                        style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.9rem', padding: '0.3rem', borderRadius: '4px' }}
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
