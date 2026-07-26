import React, { useState, useEffect, FormEvent } from 'react';
import { Project, Folder } from '../types';

interface WebTabProps {
  active: boolean;
  onIngestionComplete?: () => void;
}

export default function WebTab({ active, onIngestionComplete }: WebTabProps) {
  const [inputMode, setInputMode] = useState<'single' | 'batch'>('single');
  const [singleUrl, setSingleUrl] = useState<string>('');
  const [batchUrls, setBatchUrls] = useState<string>('');
  
  // Projects & Folders Destination
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');
  const [selectedFolderId, setSelectedFolderId] = useState<number | ''>('');

  // Processing state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [resultSummary, setResultSummary] = useState<{ count: number; titles: string[] } | null>(null);

  // Fetch Projects and Folders
  useEffect(() => {
    if (active) {
      fetch('/api/projects')
        .then(res => res.ok ? res.json() : { projects: [], folders: [] })
        .then(data => {
          setProjects(data.projects || []);
          setFolders(data.folders || []);
        })
        .catch(err => console.error('Error fetching projects in WebTab:', err));
    }
  }, [active]);

  const handleIngestWeb = async (e: FormEvent) => {
    e.preventDefault();
    setStatusLog([]);
    setResultSummary(null);

    const urlsToProcess = inputMode === 'single'
      ? [singleUrl.trim()]
      : batchUrls.split('\n').map(u => u.trim()).filter(Boolean);

    if (urlsToProcess.length === 0 || !urlsToProcess[0]) {
      alert('Por favor ingresa al menos una URL de página web válida.');
      return;
    }

    setIsProcessing(true);
    setStatusLog([`Iniciando extracción con Docling y Guardrails de Seguridad para ${urlsToProcess.length} sitio(s) web...`]);

    try {
      const payload = {
        urls: inputMode === 'batch' ? batchUrls : undefined,
        url: inputMode === 'single' ? singleUrl : undefined,
        project_id: selectedProjectId !== '' ? Number(selectedProjectId) : null,
        folder_id: selectedFolderId !== '' ? Number(selectedFolderId) : null
      };

      const res = await fetch('/api/ingest_web_url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: 'Error al procesar la página web' }));
        throw new Error(errData.detail || 'Fallo en la comunicación con el servidor');
      }

      const data = await res.json();
      const results = data.results || [];
      const titles = results.map((r: any) => r.title || r.filename);

      setStatusLog(prev => [
        ...prev,
        `✓ Docling extrajo exitosamente ${results.length} página(s) web.`,
        `✓ Guardrails anti-Prompt Injection verificados en todas las fuentes.`,
        `✓ Fragmentos vectoriales creados e indexados en la base de datos RAG.`
      ]);

      setResultSummary({
        count: results.length,
        titles
      });

      if (inputMode === 'single') setSingleUrl('');
      else setBatchUrls('');

      if (onIngestionComplete) {
        onIngestionComplete();
      }
    } catch (err: any) {
      console.error(err);
      setStatusLog(prev => [
        ...prev,
        `❌ Error: ${err.message}`
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <section id="web-tab" className={`tab-panel ${active ? 'active' : ''}`}>
      <div className="panel-header">
        <h2>Ingestión de Páginas Web</h2>
        <p>Extrae artículos y sitios web usando Docling con filtro de Guardrails anti-Prompt Injection para tu sistema RAG.</p>
      </div>

      <div className="card glass-card">
        {/* Guardrails Shield Banner */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '0.5rem', marginBottom: '1.25rem' }}>
          <i className="fa-solid fa-shield-halved" style={{ color: '#10b981', fontSize: '1.4rem' }}></i>
          <div>
            <span style={{ fontWeight: 600, color: '#34d399', fontSize: '0.875rem', display: 'block' }}>
              Guardrails Anti-Prompt Injection Activo
            </span>
            <span style={{ fontSize: '0.78125rem', color: '#a7f3d0', lineHeight: 1.4 }}>
              Las webs ingeridas son sanitizadas automáticamente: eliminamos etiquetas invisibles y neutralizamos instrucciones de jailbreak (*system prompt, ignore instructions*) antes de vectorizarse.
            </span>
          </div>
        </div>

        {/* Input Mode Selector */}
        <div className="tab-toggle" style={{ marginBottom: '1.25rem' }}>
          <button
            type="button"
            className={`toggle-btn ${inputMode === 'single' ? 'active' : ''}`}
            onClick={() => setInputMode('single')}
          >
            <i className="fa-solid fa-globe" style={{ color: '#38bdf8' }}></i> URL Individual
          </button>
          <button
            type="button"
            className={`toggle-btn ${inputMode === 'batch' ? 'active' : ''}`}
            onClick={() => setInputMode('batch')}
          >
            <i className="fa-solid fa-layer-group" style={{ color: 'var(--accent-light)' }}></i> Procesar Lote de URLs
          </button>
        </div>

        <form onSubmit={handleIngestWeb} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {/* Destination Project & Folder Selection */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem' }}>Proyecto Destino (Opcional)</label>
              <select
                className="form-control"
                value={selectedProjectId}
                onChange={e => {
                  setSelectedProjectId(e.target.value ? Number(e.target.value) : '');
                  setSelectedFolderId('');
                }}
                style={{ width: '100%', padding: '0.625rem 0.75rem', background: 'rgba(20,24,38,0.95)', border: '1px solid var(--border-glass)', borderRadius: '0.375rem', color: '#fff' }}
              >
                <option value="">-- Sin Proyecto (Fuentes Generales) --</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {selectedProjectId !== '' && (
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem' }}>Carpeta Destino (Opcional)</label>
                <select
                  className="form-control"
                  value={selectedFolderId}
                  onChange={e => setSelectedFolderId(e.target.value ? Number(e.target.value) : '')}
                  style={{ width: '100%', padding: '0.625rem 0.75rem', background: 'rgba(20,24,38,0.95)', border: '1px solid var(--border-glass)', borderRadius: '0.375rem', color: '#fff' }}
                >
                  <option value="">-- Raíz del Proyecto --</option>
                  {folders
                    .filter(f => f.project_id === Number(selectedProjectId))
                    .map(f => (
                      <option key={f.id} value={f.id}>{f.parent_id ? '  ↳ ' : ''}{f.name}</option>
                    ))}
                </select>
              </div>
            )}
          </div>

          {/* URL Input */}
          {inputMode === 'single' ? (
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem' }}>
                Enlace de la Página Web *
              </label>
              <input
                type="url"
                className="form-control"
                placeholder="https://ejemplo.com/articulo-o-noticia"
                value={singleUrl}
                onChange={e => setSingleUrl(e.target.value)}
                required
                style={{ width: '100%', padding: '0.625rem 0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', borderRadius: '0.375rem', color: '#fff' }}
              />
            </div>
          ) : (
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem' }}>
                Lista de URLs (Una por línea) *
              </label>
              <textarea
                className="form-control"
                rows={5}
                placeholder={"https://sitio1.com/articulo\nhttps://sitio2.org/investigacion"}
                value={batchUrls}
                onChange={e => setBatchUrls(e.target.value)}
                required
                style={{ width: '100%', padding: '0.625rem 0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', borderRadius: '0.375rem', color: '#fff', fontFamily: 'monospace', fontSize: '0.8125rem' }}
              />
            </div>
          )}

          {/* Submit Action Button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button
              type="submit"
              className="submit-btn btn-full"
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin"></i> Extrayendo con Docling...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-cloud-arrow-down"></i> Extraer e Ingerir Páginas Web
                </>
              )}
            </button>
          </div>
        </form>

        {/* Live Processing Log */}
        {statusLog.length > 0 && (
          <div style={{ marginTop: '1.5rem', background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--border-glass)' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem', color: '#cbd5e1' }}>
              <i className="fa-solid fa-terminal" style={{ marginRight: '0.4rem', color: 'hsl(var(--primary))' }}></i> Log de Procesamiento
            </h4>
            <div style={{ fontFamily: 'monospace', fontSize: '0.78125rem', lineHeight: 1.6, color: '#e2e8f0' }}>
              {statusLog.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          </div>
        )}

        {/* Success Card Summary */}
        {resultSummary && (
          <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '0.5rem' }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#818cf8', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <i className="fa-solid fa-circle-check"></i> Ingestión Finalizada con Éxito ({resultSummary.count} fuentes)
            </h4>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8125rem', color: '#cbd5e1' }}>
              {resultSummary.titles.map((t, idx) => (
                <li key={idx}><strong>{t}</strong> (Indexada en RAG)</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
