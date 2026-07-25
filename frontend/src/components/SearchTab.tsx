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
    <section id="search-tab" className={`tab-panel ${active ? 'active' : ''}`}>
      <div className="panel-header">
        <h2>Búsqueda Semántica RAG</h2>
        <p>Busca fragmentos de transcripciones utilizando similitud semántica. El sistema encontrará los fragmentos conceptualmente más cercanos a tu consulta.</p>
      </div>

      <form className="card glass-card" onSubmit={handleSearch}>
        <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="form-group">
            <label htmlFor="search-context-select"><i className="fa-solid fa-file-audio"></i> Documento / Foco:</label>
            <select
              id="search-context-select"
              className="form-control"
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
          
          <div className="form-group">
            <label htmlFor="search-top-k"><i className="fa-solid fa-list-ol"></i> Cantidad de Fragmentos:</label>
            <input
              type="number"
              id="search-top-k"
              className="form-control"
              min="1"
              max="20"
              value={topK}
              onChange={(e) => setTopK(parseInt(e.target.value) || 4)}
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="search-query-input"><i className="fa-solid fa-magnifying-glass"></i> Consulta de búsqueda:</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              id="search-query-input"
              className="form-control"
              placeholder="Escribe tu búsqueda aquí (ej: compromisos acordados, fechas de entrega)..."
              required
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flexGrow: 1 }}
            />
            <button type="submit" id="btn-execute-search" className="btn btn-secondary" disabled={isLoading} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}>
              {isLoading ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin"></i> Buscando...
                </>
              ) : (
                <>
                  <i className="fa-solid fa-magnifying-glass"></i> Buscar
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      <div id="search-results-container" style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {isLoading && (
          <div className="card glass-card empty-state">
            <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2rem', marginBottom: '1rem', color: 'hsl(var(--primary))' }}></i>
            <p>Calculando similitudes coseno en el RAG...</p>
          </div>
        )}

        {!isLoading && results.length > 0 && results.map((result, idx) => {
          const scorePercent = Math.max(0, Math.min(100, Math.round(result.similarity * 100)));
          return (
            <div key={idx} className="search-result-card">
              <div className="search-result-header">
                <span className="search-result-title">
                  <i className="fa-solid fa-file-lines"></i> {result.filename}
                </span>
                <span className="search-result-score">
                  <i className="fa-solid fa-circle-check"></i> {scorePercent}% de Similitud
                </span>
              </div>
              <div className="search-result-text">
                "{result.text}"
              </div>
              <div className="search-result-actions">
                {result.transcription_id && (
                  <>
                    <button
                      type="button"
                      className="search-action-link"
                      onClick={() => onNavigateToTab('transcription-tab', result.transcription_id!)}
                    >
                      <i className="fa-solid fa-microphone"></i> Consultar fragmento en transcripción original
                    </button>
                    <button
                      type="button"
                      className="search-action-link"
                      onClick={() => onNavigateToTab('summary-tab', result.transcription_id!)}
                    >
                      <i className="fa-solid fa-file-invoice"></i> Consultar resumen asociado a este fragmento
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {!isLoading && hasSearched && results.length === 0 && (
          <div className="card glass-card empty-state">
            <i className="fa-solid fa-face-frown" style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.3 }}></i>
            <p>No se encontraron fragmentos similares a tu búsqueda.</p>
          </div>
        )}

        {!hasSearched && !isLoading && (
          <div className="card glass-card empty-state" id="search-empty-state">
            <i className="fa-solid fa-magnifying-glass" style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.3 }}></i>
            <p>Ingresa una consulta de búsqueda y presiona buscar para ver los fragmentos más relevantes.</p>
          </div>
        )}
      </div>
    </section>
  );
}
