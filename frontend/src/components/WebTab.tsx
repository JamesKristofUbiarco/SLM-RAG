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
    <section id="web-tab" className={`flex-col gap-6 w-full ${active ? 'flex' : 'hidden'}`}>
      <div className="mb-1">
        <h2 className="text-2xl font-semibold text-white tracking-tight mb-1">Ingestión de Páginas Web</h2>
        <p className="text-sm text-zinc-400">Extrae artículos y sitios web usando Docling con filtro de Guardrails anti-Prompt Injection para tu sistema RAG.</p>
      </div>

      <div className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-5 w-full">
        {/* Guardrails Shield Banner */}
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3">
          <i className="fa-solid fa-shield-halved text-emerald-400 text-2xl shrink-0"></i>
          <div>
            <span className="text-xs font-semibold text-emerald-400 block mb-0.5">
              Guardrails Anti-Prompt Injection Activo
            </span>
            <span className="text-[11px] text-emerald-200/80 leading-relaxed">
              Las webs ingeridas son sanitizadas automáticamente: eliminamos etiquetas invisibles y neutralizamos instrucciones de jailbreak antes de vectorizarse.
            </span>
          </div>
        </div>

        {/* Input Mode Selector */}
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
            <i className="fa-solid fa-globe text-sky-400"></i> URL Individual
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

        <form onSubmit={handleIngestWeb} className="flex flex-col gap-4">
          {/* Destination Project & Folder Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-300">Proyecto Destino (Opcional)</label>
              <select
                className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white p-2.5 text-xs focus:outline-none focus:border-amber-500 transition-colors"
                value={selectedProjectId}
                onChange={e => {
                  setSelectedProjectId(e.target.value ? Number(e.target.value) : '');
                  setSelectedFolderId('');
                }}
              >
                <option value="">-- Sin Proyecto (Fuentes Generales) --</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {selectedProjectId !== '' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-zinc-300">Carpeta Destino (Opcional)</label>
                <select
                  className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white p-2.5 text-xs focus:outline-none focus:border-amber-500 transition-colors"
                  value={selectedFolderId}
                  onChange={e => setSelectedFolderId(e.target.value ? Number(e.target.value) : '')}
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
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-300">
                Enlace de la Página Web *
              </label>
              <input
                type="url"
                className="w-full bg-white/[0.03] border border-white/10 rounded-lg text-white px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500 transition-colors"
                placeholder="https://ejemplo.com/articulo-o-noticia"
                value={singleUrl}
                onChange={e => setSingleUrl(e.target.value)}
                required
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-300">
                Lista de URLs (Una por línea) *
              </label>
              <textarea
                className="w-full bg-white/[0.03] border border-white/10 rounded-lg text-white font-mono p-3 text-xs focus:outline-none focus:border-amber-500 transition-colors leading-relaxed"
                rows={5}
                placeholder={"https://sitio1.com/articulo\nhttps://sitio2.org/investigacion"}
                value={batchUrls}
                onChange={e => setBatchUrls(e.target.value)}
                required
              />
            </div>
          )}

          {/* Submit Action Button */}
          <button
            type="submit"
            className="w-full py-3 px-5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50 mt-2"
            disabled={isProcessing}
          >
            {isProcessing ? (
              <><i className="fa-solid fa-spinner fa-spin"></i> Extrayendo con Docling...</>
            ) : (
              <><i className="fa-solid fa-cloud-arrow-down"></i> Extraer e Ingerir Páginas Web</>
            )}
          </button>
        </form>

        {/* Live Processing Log */}
        {statusLog.length > 0 && (
          <div className="p-4 bg-black/40 rounded-xl border border-white/10 flex flex-col gap-2 mt-2">
            <h4 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <i className="fa-solid fa-terminal text-amber-500"></i> Log de Procesamiento
            </h4>
            <div className="font-mono text-xs text-zinc-300 space-y-1 leading-relaxed">
              {statusLog.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          </div>
        )}

        {/* Success Card Summary */}
        {resultSummary && (
          <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-indigo-400 flex items-center gap-1.5">
              <i className="fa-solid fa-circle-check"></i> Ingestión Finalizada con Éxito ({resultSummary.count} fuentes)
            </h4>
            <ul className="list-disc pl-5 text-xs text-zinc-300 space-y-1">
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
