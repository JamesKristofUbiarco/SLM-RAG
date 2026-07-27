import React, { useState, useEffect, useRef } from 'react';
import { Marked } from 'marked';
import { Transcription } from '../types';
import { isAudioVideoTranscription } from './TranscriptionHistoryBox';

const marked = new Marked();

type SummaryMode = 'meeting' | 'essay' | 'recipe' | 'doc_executive' | 'doc_analysis' | 'web_digest';

interface SummaryTabProps {
  transcriptionList: Transcription[];
  activeId: number | null;
  setActiveId?: (id: number) => void;
  active: boolean;
}

export default function SummaryTab({ transcriptionList, activeId, setActiveId, active }: SummaryTabProps) {
  const [selectedId, setSelectedId] = useState<number | ''>(activeId || '');
  const [summaryData, setSummaryData] = useState<Transcription | null>(null);
  const [summaryMode, setSummaryMode] = useState<SummaryMode>('meeting');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const selectedItem = transcriptionList.find((item) => item.id === selectedId);
  const isMedia = selectedItem ? isAudioVideoTranscription(selectedItem) : false;

  // Sync selectedId with activeId from parent
  useEffect(() => {
    if (activeId) {
      setSelectedId(activeId);
    }
  }, [activeId]);

  // Adjust default summary mode based on content type
  useEffect(() => {
    if (selectedItem) {
      if (isMedia) {
        if (summaryMode !== 'meeting' && summaryMode !== 'essay' && summaryMode !== 'recipe') {
          setSummaryMode('meeting');
        }
      } else {
        if (summaryMode !== 'doc_executive' && summaryMode !== 'doc_analysis' && summaryMode !== 'web_digest') {
          const isWeb = selectedItem.filename?.startsWith('web_');
          setSummaryMode(isWeb ? 'web_digest' : 'doc_executive');
        }
      }
    }
  }, [selectedId, isMedia]);

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
      if (data.summary_mode) {
        setSummaryMode(data.summary_mode as SummaryMode);
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

  const getModeLabel = (mode: SummaryMode): string => {
    switch (mode) {
      case 'meeting': return 'Modo Reunión (Minuta)';
      case 'essay': return 'Modo Video Ensayo (Marcas de Tiempo)';
      case 'recipe': return 'Modo Recetas de Cocina (Ingredientes y Pasos)';
      case 'doc_executive': return 'Síntesis Ejecutiva de Documento';
      case 'doc_analysis': return 'Análisis Técnico de Documento';
      case 'web_digest': return 'Resumen Digest Web';
      default: return 'Resumen Inteligente';
    }
  };

  const renderModeOptions = () => {
    if (isMedia) {
      return (
        <>
          <option value="meeting">📋 Modo Reunión / Minuta</option>
          <option value="essay">📺 Modo Video Ensayo / Conferencia (Tiempos)</option>
          <option value="recipe">🍳 Modo Recetas de Cocina (Ingredientes y Pasos)</option>
        </>
      );
    }
    return (
      <>
        <option value="doc_executive">📄 Síntesis Ejecutiva de Documento</option>
        <option value="doc_analysis">🔬 Análisis Técnico y Desglose</option>
        <option value="web_digest">🌐 Resumen Digest / Contenido Web</option>
      </>
    );
  };

  return (
    <section id="summary-tab" className={`flex-col gap-6 w-full ${active ? 'flex' : 'hidden'}`}>
      <div className="mb-1">
        <h2 className="text-2xl font-semibold text-white tracking-tight mb-1">Resúmenes Inteligentes</h2>
        <p className="text-sm text-zinc-400">
          Genera resúmenes estructurados adaptados al tipo de contenido (Reunión, Video Ensayo o Recetas de Cocina para contenido multimedia; Síntesis Ejecutiva, Análisis Técnico o Digest Web para documentos).
        </p>
      </div>

      <div className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-3 w-full mb-2">
        <label htmlFor="history-summary-select" className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
          <i className="fa-solid fa-history text-amber-500"></i> Seleccionar Fuente o Grabación:
        </label>
        <select
          id="history-summary-select"
          className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500 transition-colors"
          value={selectedId}
          onChange={(e) => {
            const val = e.target.value ? parseInt(e.target.value) : '';
            setSelectedId(val);
            if (setActiveId && typeof val === 'number') setActiveId(val);
          }}
        >
          <option value="">-- Elige un archivo o fuente ingerida --</option>
          {transcriptionList.map((item) => (
            <option key={item.id} value={item.id}>
              {item.filename} ({item.created_at?.substring(0, 10)})
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="p-12 text-center rounded-xl bg-[#17171c]/75 border border-white/10">
          <i className="fa-solid fa-spinner fa-spin text-3xl text-amber-500 mb-3"></i>
          <p className="text-sm text-zinc-400">Cargando información del resumen...</p>
        </div>
      ) : selectedId ? (
        <div className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-4 w-full">
          <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-white/10">
            <h3 className="text-lg font-semibold text-white break-all">
              {summaryData?.filename || 'Archivo de Fuente'}
            </h3>

            {/* Controls Bar (shown when summary already exists to allow re-generating in another mode) */}
            {summaryData?.summary && (
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  className="bg-[#1e293b] border border-white/10 rounded-lg text-white px-3 py-2 text-xs font-medium focus:outline-none focus:border-amber-500 transition-colors"
                  value={summaryMode}
                  onChange={(e) => setSummaryMode(e.target.value as SummaryMode)}
                  disabled={isGenerating}
                  title="Selecciona el modo de resumen"
                >
                  {renderModeOptions()}
                </select>

                {!isGenerating && (
                  <button
                    type="button"
                    className="px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
                    onClick={() => handleGenerateSummary(true)}
                  >
                    <i className="fa-solid fa-arrows-rotate text-amber-400"></i> Regenerar Resumen
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Audio Player Card (Only for audio/video media files) */}
          {summaryData && isMedia && (
            <div className="p-3.5 rounded-lg bg-white/[0.02] border border-white/10 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <i className="fa-solid fa-headphones text-amber-500"></i> 
                  Reproductor de Audio (Haz clic en cualquier marca de tiempo para saltar aquí)
                </span>
              </div>
              <audio
                ref={audioRef}
                controls
                src={`/api/files/view/${selectedId}`}
                className="w-full h-10 rounded-lg outline-none"
              />
            </div>
          )}

          {isGenerating ? (
            <div className="flex flex-col items-center justify-center gap-4 py-12 px-4 text-center">
              <div className="w-16 h-16 rounded-full bg-amber-500/15 border-2 border-amber-500 flex items-center justify-center animate-pulse">
                <i className="fa-solid fa-brain text-2xl text-amber-500"></i>
              </div>
              <div>
                <h4 className="text-base font-semibold text-amber-400 mb-1">
                  Generando resumen en {getModeLabel(summaryMode)}...
                </h4>
                <p className="text-xs text-zinc-400 max-w-md mx-auto">
                  El modelo Gemma 4 está analizando el contenido de la fuente seleccionada para estructurar la síntesis solicitada.
                </p>
              </div>
            </div>
          ) : summaryData?.summary ? (
            <div 
              className="prose prose-invert max-w-none text-sm text-zinc-300 leading-relaxed space-y-3" 
              dangerouslySetInnerHTML={renderMarkdown(summaryData.summary)}
              onClick={handleSummaryContainerClick}
            ></div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 py-10 px-5 text-center bg-white/[0.01] border border-dashed border-white/10 rounded-xl">
              <i className="fa-solid fa-file-invoice text-4xl text-amber-500/80"></i>
              <div>
                <h3 className="text-base font-semibold text-white mb-1">
                  El resumen aún no se ha generado
                </h3>
                <p className="text-xs text-zinc-400 max-w-md mx-auto mb-4">
                  Elige el modo deseado para este tipo de contenido ({isMedia ? 'Reunión, Video Ensayo o Recetas de Cocina' : 'Síntesis Ejecutiva, Análisis Técnico o Digest Web'}) y haz clic en el botón para iniciar.
                </p>
              </div>

              <div className="flex items-center gap-3 flex-wrap justify-center">
                <select
                  className="bg-[#1e293b] border border-white/10 rounded-lg text-white px-3.5 py-2.5 text-xs font-medium focus:outline-none focus:border-amber-500 transition-colors"
                  value={summaryMode}
                  onChange={(e) => setSummaryMode(e.target.value as SummaryMode)}
                >
                  {renderModeOptions()}
                </select>

                <button 
                  type="button" 
                  className="py-2.5 px-5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all cursor-pointer" 
                  onClick={() => handleGenerateSummary(false)}
                >
                  <i className="fa-solid fa-wand-magic-sparkles"></i> Comenzar resumen LLM
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-12 text-center rounded-xl bg-[#17171c]/75 border border-white/10" id="summary-empty-state">
          <i className="fa-solid fa-file-invoice text-4xl text-zinc-600 mb-3 block"></i>
          <p className="text-xs text-zinc-400">Selecciona una fuente del historial para ver su resumen o generar uno nuevo.</p>
        </div>
      )}
    </section>
  );
}
