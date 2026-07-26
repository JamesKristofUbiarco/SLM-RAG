import React, { useState, useEffect, useRef } from 'react';
import { Marked } from 'marked';
import { Transcription } from '../types';

const marked = new Marked();

interface SummaryTabProps {
  transcriptionList: Transcription[];
  activeId: number | null;
  setActiveId?: (id: number) => void;
  active: boolean;
}

export default function SummaryTab({ transcriptionList, activeId, setActiveId, active }: SummaryTabProps) {
  const [selectedId, setSelectedId] = useState<number | ''>(activeId || '');
  const [summaryData, setSummaryData] = useState<Transcription | null>(null);
  const [summaryMode, setSummaryMode] = useState<'meeting' | 'essay'>('meeting');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sync selectedId with activeId from parent
  useEffect(() => {
    if (activeId) {
      setSelectedId(activeId);
    }
  }, [activeId]);

  // Load summary details when selectedId changes
  useEffect(() => {
    if (selectedId) {
      loadSummary(selectedId);
    } else {
      setSummaryData(null);
      setIsGenerating(false);
    }
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [selectedId]);

  const loadSummary = async (id: number) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/transcriptions/${id}`);
      if (!res.ok) throw new Error('Error al cargar la transcripción');
      const data: Transcription = await res.json();
      
      setSummaryData(data);
      if (data.summary_mode && (data.summary_mode === 'meeting' || data.summary_mode === 'essay')) {
        setSummaryMode(data.summary_mode as 'meeting' | 'essay');
      }
      setIsGenerating(data.is_generating || false);

      if (data.is_generating) {
        startPolling(id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const startPolling = (id: number) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/transcriptions/${id}/summary`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'completed' && data.summary) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setIsGenerating(false);
          loadSummary(id);
        }
      } catch (err) {
        console.error('Error in polling summary:', err);
      }
    }, 4000);
  };

  const handleGenerateSummary = async (force = false) => {
    if (!selectedId) return;
    setIsGenerating(true);
    try {
      const res = await fetch(`/api/transcriptions/${selectedId}/summarize?force=${force ? 'true' : 'false'}&mode=${summaryMode}`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Error al iniciar la generación de resumen');
      startPolling(selectedId);
    } catch (err) {
      console.error(err);
      alert('Fallo al iniciar el resumen LLM.');
      setIsGenerating(false);
    }
  };

  const parseTimestampToSeconds = (timeStr: string): number => {
    const parts = timeStr.trim().split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return 0;
  };

  const preprocessMarkdown = (text: string): string => {
    if (!text) return '';
    // Automatically convert lines starting with timestamps (with or without brackets/bullets) into bullet list items
    return text.replace(/^(\s*)(?:-\s*)?(?:\[)?(\d{1,2}:\d{2}(?::\d{2})?)(?:\])?\s+(.+)$/gm, '$1- [$2] $3');
  };

  const transformTimestampsToButtons = (html: string): string => {
    return html.replace(/(?:\[)?(\b\d{1,2}:\d{2}(?::\d{2})?\b)(?:\])?/g, (match, p1) => {
      return `<button class="timestamp-btn" data-time="${p1}"><i class="fa-solid fa-play" style="font-size: 0.7em;"></i> ${p1}</button>`;
    });
  };

  const renderMarkdown = (text?: string) => {
    if (!text) return { __html: '' };
    marked.use({ breaks: true, gfm: true });
    const preprocessed = preprocessMarkdown(text);
    const rawHtml = marked.parse(preprocessed) as string;
    const processedHtml = transformTimestampsToButtons(rawHtml);
    return { __html: processedHtml };
  };

  const handleSummaryContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('.timestamp-btn');
    if (target) {
      const timeAttr = target.getAttribute('data-time');
      if (timeAttr && audioRef.current) {
        const seconds = parseTimestampToSeconds(timeAttr);
        audioRef.current.currentTime = seconds;
        audioRef.current.play();
      }
    }
  };

  return (
    <section id="summary-tab" className={`tab-panel ${active ? 'active' : ''}`}>
      <div className="panel-header">
        <h2>Resúmenes Inteligentes</h2>
        <p>Genera resúmenes estructurados (Modo Reunión o Video Ensayo / Conferencia con marcas de tiempo) usando Gemma 4 local.</p>
      </div>

      <div className="card glass-card" style={{ marginBottom: '1.5rem' }}>
        <div className="form-group">
          <label htmlFor="history-summary-select"><i className="fa-solid fa-history"></i> Seleccionar Grabación:</label>
          <select
            id="history-summary-select"
            className="form-control"
            value={selectedId}
            onChange={(e) => {
              const val = e.target.value ? parseInt(e.target.value) : '';
              setSelectedId(val);
              if (setActiveId && typeof val === 'number') setActiveId(val);
            }}
          >
            <option value="">-- Elige un archivo del historial --</option>
            {transcriptionList.map((item) => (
              <option key={item.id} value={item.id}>
                {item.filename} ({item.created_at?.substring(0, 10)})
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="card glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2rem', marginBottom: '1rem', color: 'hsl(var(--primary))' }}></i>
          <p>Cargando información del resumen...</p>
        </div>
      ) : selectedId ? (
        <div className="card glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.125rem' }}>
              {summaryData?.filename || 'Archivo de Audio'}
            </h3>

            {/* Controls Bar: Mode Selector + Action Button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <select
                className="mode-select-dropdown"
                value={summaryMode}
                onChange={(e) => setSummaryMode(e.target.value as 'meeting' | 'essay')}
                disabled={isGenerating}
                title="Selecciona el modo de resumen"
              >
                <option value="meeting">📋 Modo Reunión / Minuta</option>
                <option value="essay">📺 Modo Video Ensayo / Conferencia</option>
              </select>

              {summaryData?.summary && !isGenerating && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.8125rem', padding: '0.5rem 1rem' }}
                  onClick={() => handleGenerateSummary(true)}
                >
                  <i className="fa-solid fa-arrows-rotate"></i> Regenerar Resumen
                </button>
              )}
            </div>
          </div>

          {/* Audio Player Card (for seeking timestamps) */}
          {summaryData && (
            <div style={{ marginBottom: '1.25rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--border-glass)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
                <span><i className="fa-solid fa-headphones" style={{ color: 'var(--primary)', marginRight: '0.35rem' }}></i> Reproductor de Audio (Haz clic en cualquier marca de tiempo para saltar aquí)</span>
              </div>
              <audio
                ref={audioRef}
                controls
                src={`/api/files/view/${selectedId}`}
                style={{ width: '100%', height: '40px' }}
              />
            </div>
          )}

          {isGenerating ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '3rem 1rem', textAlign: 'center' }}>
              <div className="loading-pulse" style={{ width: '4rem', height: '4rem', borderRadius: '50%', background: 'rgba(245, 158, 11, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--primary)' }}>
                <i className="fa-solid fa-brain" style={{ fontSize: '2rem', color: 'var(--primary)' }}></i>
              </div>
              <div>
                <h4 style={{ color: 'var(--primary)', marginBottom: '0.25rem' }}>
                  Generando resumen en {summaryMode === 'essay' ? 'Modo Video Ensayo (Índice de Tiempos)' : 'Modo Reunión (Minuta)'}...
                </h4>
                <p style={{ fontSize: '0.8125rem', color: 'hsl(var(--text-muted))', maxWidth: '450px' }}>
                  {summaryMode === 'essay' 
                    ? 'El modelo Gemma 4 está analizando la transcripción para extraer los capítulos por marcas de tiempo y el resumen por sección.'
                    : 'El modelo Gemma 4 está analizando la transcripción para redactar el resumen ejecutivo, la participación de locutores y los compromisos.'}
                </p>
              </div>
            </div>
          ) : summaryData?.summary ? (
            <div 
              className="summary-content markdown-body" 
              dangerouslySetInnerHTML={renderMarkdown(summaryData.summary)}
              onClick={handleSummaryContainerClick}
              style={{ fontSize: '0.875rem', lineHeight: '1.7', color: '#cbd5e1' }}
            ></div>
          ) : (
            <div className="summary-trigger-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2.5rem 1.25rem', textAlign: 'center', background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border-glass)', borderRadius: '0.5rem' }}>
              <i className="fa-solid fa-file-invoice" style={{ fontSize: '3rem', color: 'hsl(var(--primary))', opacity: '0.8' }}></i>
              <div>
                <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem', color: 'hsl(var(--text))' }}>
                  El resumen aún no se ha generado
                </h3>
                <p style={{ fontSize: '0.8125rem', color: 'hsl(var(--text-muted))', maxWidth: '450px', margin: '0 auto 1rem', lineHeight: '1.5' }}>
                  Elige el modo deseado (<strong>Reunión</strong> o <strong>Video Ensayo con marcas de tiempo</strong>) y haz clic en el botón para iniciar.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <select
                  className="mode-select-dropdown"
                  value={summaryMode}
                  onChange={(e) => setSummaryMode(e.target.value as 'meeting' | 'essay')}
                >
                  <option value="meeting">📋 Modo Reunión / Minuta</option>
                  <option value="essay">📺 Modo Video Ensayo / Conferencia</option>
                </select>

                <button 
                  type="button" 
                  className="submit-btn" 
                  onClick={() => handleGenerateSummary(false)}
                >
                  <i className="fa-solid fa-wand-magic-sparkles"></i> Comenzar resumen LLM
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="card glass-card empty-state" id="summary-empty-state">
          <i className="fa-solid fa-file-invoice" style={{ fontSize: '3rem', margin: '1rem 0', opacity: 0.3 }}></i>
          <p>Selecciona una transcripción del historial para ver su resumen ejecutivo o generar uno nuevo.</p>
        </div>
      )}
    </section>
  );
}
