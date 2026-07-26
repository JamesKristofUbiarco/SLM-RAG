import React, { useState, FormEvent } from 'react';
import { Transcription, SearchResult } from '../types';

interface SearchTabProps {
  transcriptionList: Transcription[];
  onNavigateToTab: (tab: string, transcriptionId: number) => void;
  active: boolean;
}

export default function SearchTab({ transcriptionList, onNavigateToTab, active }: SearchTabProps) {
  const [transcriptionId, setTranscriptionId] = useState<string>('');
  const [topK, setTopK] = useState<number>(4);
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasSearched, setHasSearched] = useState<boolean>(false);

  const handleSearch = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      alert('Por favor escribe una consulta para buscar.');
      return;
    }

    setIsLoading(true);
    setHasSearched(true);
    setResults([]);

    try {
      let url = `/api/semantic_search?query=${encodeURIComponent(cleanQuery)}&top_k=${topK}`;
      if (transcriptionId) {
        url += `&transcription_id=${transcriptionId}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error('Error en la petición al servidor.');
      const data: SearchResult[] = await res.json();
      setResults(data);
    } catch (err: any) {
      console.error(err);
      alert(`Ocurrió un error al realizar la búsqueda: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section id="search-tab" className={`flex-col gap-6 w-full ${active ? 'flex' : 'hidden'}`}>
      <div className="mb-1">
        <h2 className="text-2xl font-semibold text-white tracking-tight mb-1">Búsqueda Semántica RAG</h2>
        <p className="text-sm text-zinc-400">Busca fragmentos de transcripciones utilizando similitud semántica. El sistema encontrará los fragmentos conceptualmente más cercanos a tu consulta.</p>
      </div>

      <form className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-4 w-full" onSubmit={handleSearch}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="search-context-select" className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <i className="fa-solid fa-file-audio text-amber-500"></i> Documento / Foco:
            </label>
            <select
              id="search-context-select"
              className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white px-3.5 py-2.5 text-xs focus:outline-none focus:border-amber-500 transition-colors"
              value={transcriptionId}
              onChange={(e) => setTranscriptionId(e.target.value)}
            >
              <option value="">-- Todos los documentos --</option>
              {transcriptionList.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.filename} ({item.created_at?.substring(0, 10)})
                </option>
              ))}
            </select>
          </div>
          
          <div className="flex flex-col gap-1.5">
            <label htmlFor="search-top-k" className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <i className="fa-solid fa-list-ol text-amber-500"></i> Cantidad de Fragmentos:
            </label>
            <input
              type="number"
              id="search-top-k"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg text-white px-3.5 py-2 text-xs focus:outline-none focus:border-amber-500 transition-colors"
              min="1"
              max="20"
              value={topK}
              onChange={(e) => setTopK(parseInt(e.target.value) || 4)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 mt-1">
          <label htmlFor="search-query-input" className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <i className="fa-solid fa-magnifying-glass text-amber-500"></i> Consulta de búsqueda:
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              id="search-query-input"
              className="flex-1 bg-white/[0.03] border border-white/10 rounded-lg text-white px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500 transition-colors"
              placeholder="Escribe tu búsqueda aquí (ej: compromisos acordados, fechas de entrega)..."
              required
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="submit"
              id="btn-execute-search"
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors disabled:opacity-50"
              disabled={isLoading}
            >
              {isLoading ? (
                <><i className="fa-solid fa-spinner fa-spin"></i> Buscando...</>
              ) : (
                <><i className="fa-solid fa-magnifying-glass"></i> Buscar</>
              )}
            </button>
          </div>
        </div>
      </form>

      <div id="search-results-container" className="flex flex-col gap-4 mt-2">
        {isLoading && (
          <div className="p-12 text-center rounded-xl bg-[#17171c]/75 border border-white/10">
            <i className="fa-solid fa-spinner fa-spin text-3xl text-amber-500 mb-3 block"></i>
            <p className="text-xs text-zinc-400">Calculando similitudes coseno en el RAG...</p>
          </div>
        )}

        {!isLoading && results.length > 0 && results.map((result, idx) => {
          const scorePercent = Math.max(0, Math.min(100, Math.round(result.similarity * 100)));
          return (
            <div key={idx} className="p-5 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-white/10">
                <span className="text-sm font-semibold text-white flex items-center gap-2">
                  <i className="fa-solid fa-file-lines text-amber-500"></i> {result.filename}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <i className="fa-solid fa-circle-check mr-1"></i> {scorePercent}% de Similitud
                </span>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed italic bg-black/30 p-3 rounded-lg border border-white/5">
                "{result.text}"
              </p>

              <div className="flex items-center gap-4 flex-wrap pt-1 text-xs">
                {result.transcription_id && (
                  <>
                    <button
                      type="button"
                      className="text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1.5 cursor-pointer"
                      onClick={() => onNavigateToTab('transcription-tab', result.transcription_id!)}
                    >
                      <i className="fa-solid fa-microphone"></i> Consultar en transcripción original
                    </button>
                    <button
                      type="button"
                      className="text-amber-400 hover:text-amber-300 font-medium flex items-center gap-1.5 cursor-pointer"
                      onClick={() => onNavigateToTab('summary-tab', result.transcription_id!)}
                    >
                      <i className="fa-solid fa-file-invoice"></i> Consultar resumen asociado
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {!isLoading && hasSearched && results.length === 0 && (
          <div className="p-12 text-center rounded-xl bg-[#17171c]/75 border border-white/10">
            <i className="fa-solid fa-face-frown text-4xl text-zinc-600 mb-3 block"></i>
            <p className="text-xs text-zinc-400">No se encontraron fragmentos similares a tu búsqueda.</p>
          </div>
        )}

        {!hasSearched && !isLoading && (
          <div className="p-12 text-center rounded-xl bg-[#17171c]/75 border border-white/10" id="search-empty-state">
            <i className="fa-solid fa-magnifying-glass text-4xl text-zinc-600 mb-3 block"></i>
            <p className="text-xs text-zinc-400">Ingresa una consulta de búsqueda y presiona buscar para ver los fragmentos más relevantes.</p>
          </div>
        )}
      </div>
    </section>
  );
}
