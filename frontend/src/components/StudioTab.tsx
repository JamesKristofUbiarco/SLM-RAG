import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Marked } from 'marked';
import { Transcription, Project, Folder } from '../types';
import FolderTree from './FolderTree';

const marked = new Marked();

interface PendingStudioResume {
  artifact_type: string;
  data: any;
}

interface StudioTabProps {
  transcriptionList: Transcription[];
  activeId: number | null;
  active: boolean;
  pendingResume?: PendingStudioResume | null;
  onClearPendingResume?: () => void;
}

interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

interface Flashcard {
  id: number;
  front: string;
  back: string;
}

interface ToolConfig {
  count: number;
  difficulty: string;
  lengthSetting: string;
  customInstructions: string;
}

const defaultConfigMap: Record<string, ToolConfig> = {
  briefing: { count: 5, difficulty: 'Intermedio', lengthSetting: 'Estándar', customInstructions: '' },
  faq: { count: 5, difficulty: 'Intermedio', lengthSetting: 'Estándar', customInstructions: '' },
  timeline: { count: 5, difficulty: 'Intermedio', lengthSetting: 'Estándar', customInstructions: '' },
  quiz: { count: 5, difficulty: 'Intermedio', lengthSetting: 'Estándar', customInstructions: '' },
  flashcards: { count: 10, difficulty: 'Intermedio', lengthSetting: 'Estándar', customInstructions: '' },
};

export default function StudioTab({ transcriptionList, activeId, active, pendingResume, onClearPendingResume }: StudioTabProps) {
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<number>>(new Set());
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);

  // Selected tool mode (defaulting to briefing)
  const [activeArtifactType, setActiveArtifactType] = useState<string>('briefing');

  // Independent custom configuration parameters PER MODE
  const [toolConfigs, setToolConfigs] = useState<Record<string, ToolConfig>>(defaultConfigMap);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);

  // Generation state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [artifactData, setArtifactData] = useState<any>(null);

  // Quiz Player State
  const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});
  const [showQuizResults, setShowQuizResults] = useState<boolean>(false);

  // Flashcards Player State
  const [currentCardIndex, setCurrentCardIndex] = useState<number>(0);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);

  // Helper to retrieve current mode config
  const currentConfig = toolConfigs[activeArtifactType] || defaultConfigMap[activeArtifactType];

  const updateCurrentConfig = (updates: Partial<ToolConfig>) => {
    setToolConfigs(prev => ({
      ...prev,
      [activeArtifactType]: {
        ...(prev[activeArtifactType] || defaultConfigMap[activeArtifactType]),
        ...updates
      }
    }));
  };

  const fetchProjectsAndFolders = async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
        setFolders(data.folders || []);
      }
    } catch (e) {
      console.error('Error fetching projects in StudioTab:', e);
    }
  };

  useEffect(() => {
    if (active) {
      fetchProjectsAndFolders();
    }
  }, [active]);

  useEffect(() => {
    if (active && pendingResume) {
      const mode = pendingResume.artifact_type || pendingResume.type || 'briefing';
      setActiveArtifactType(mode);
      
      const isQuizOrFlashcards = mode === 'quiz' || mode === 'flashcards';
      const artifactType = isQuizOrFlashcards ? mode : 'markdown';
      const questionsOrCards = pendingResume.data || pendingResume.quiz || pendingResume.flashcards || [];
      const markdownContent = pendingResume.content || (typeof pendingResume === 'string' ? pendingResume : '');
      
      const restoredArtifactData = {
        ...pendingResume,
        type: artifactType,
        artifact_type: mode,
        content: markdownContent,
        data: questionsOrCards
      };
      
      setArtifactData(restoredArtifactData);
      setUserAnswers({});
      setShowQuizResults(false);
      setCurrentCardIndex(0);
      setIsFlipped(false);
      
      if (onClearPendingResume) {
        onClearPendingResume();
      }
    }
  }, [active, pendingResume]);

  useEffect(() => {
    if (activeId) {
      setSelectedSourceIds(new Set([activeId]));
    }
  }, [activeId]);

  const handleToggleSource = (id: number) => {
    setSelectedSourceIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleFolder = (folderId: number) => {
    const folderSources = transcriptionList.filter(s => s.folder_id === folderId);
    const folderSourceIds = folderSources.map(s => s.id);
    const allSelected = folderSourceIds.every(id => selectedSourceIds.has(id));

    setSelectedSourceIds(prev => {
      const next = new Set(prev);
      folderSourceIds.forEach(id => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  const handleToggleProject = (projectId: number) => {
    const projectSources = transcriptionList.filter(s => s.project_id === projectId);
    const projectSourceIds = projectSources.map(s => s.id);
    const allSelected = projectSourceIds.every(id => selectedSourceIds.has(id));

    setSelectedSourceIds(prev => {
      const next = new Set(prev);
      projectSourceIds.forEach(id => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedSourceIds(new Set(transcriptionList.map(s => s.id)));
  };

  const handleDeselectAll = () => {
    setSelectedSourceIds(new Set());
  };

  const handleExecuteSynthesis = async () => {
    if (selectedSourceIds.size === 0) {
      alert('Por favor selecciona al menos una fuente local en el panel izquierdo.');
      return;
    }

    setIsGenerating(true);
    setArtifactData(null);
    setUserAnswers({});
    setShowQuizResults(false);
    setCurrentCardIndex(0);
    setIsFlipped(false);

    try {
      const res = await fetch('/api/studio/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifact_type: activeArtifactType,
          source_ids: Array.from(selectedSourceIds),
          count: currentConfig.count,
          difficulty: currentConfig.difficulty,
          length: currentConfig.lengthSetting,
          custom_instructions: currentConfig.customInstructions
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg = 'Fallo al generar contenido en Studio Hub';
        try {
          const errJson = JSON.parse(errorText);
          errorMsg = errJson.detail || errorMsg;
        } catch {
          errorMsg = errorText || errorMsg;
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();
      if (data.status === 'error') {
        throw new Error(data.message || 'Error en la generación de fuentes.');
      }

      setArtifactData(data);
    } catch (err: any) {
      alert(`Error en Studio Hub: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const renderMarkdown = (text: string) => {
    if (!text) return { __html: '' };
    marked.use({ breaks: true, gfm: true });
    const rawHtml = marked.parse(text) as string;
    return { __html: rawHtml };
  };

  const handleSaveToNotebook = async (title: string, content: string, sourceType = 'user_note') => {
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          content: content,
          source_type: sourceType
        })
      });
      if (res.ok) {
        alert('¡Guardado con éxito en tu Cuaderno de Notas!');
      } else {
        const errData = await res.json();
        alert(`Error al guardar: ${errData.detail || 'Error en servidor'}`);
      }
    } catch (e: any) {
      alert(`Error al guardar en el cuaderno: ${e.message}`);
    }
  };

  const handleSaveQuizToNotebook = () => {
    if (!artifactData || !Array.isArray(artifactData.data)) return;
    const title = `Examen: ${artifactData.title || getToolLabel('quiz')}`;
    const payload = JSON.stringify({
      type: 'quiz',
      artifact_type: 'quiz',
      data: artifactData.data,
      title: artifactData.title
    });
    handleSaveToNotebook(title, payload, 'studio_quiz');
  };

  const handleSaveFlashcardsToNotebook = () => {
    if (!artifactData || !Array.isArray(artifactData.data)) return;
    const title = `Flashcards: ${artifactData.title || getToolLabel('flashcards')}`;
    const payload = JSON.stringify({
      type: 'flashcards',
      artifact_type: 'flashcards',
      data: artifactData.data,
      title: artifactData.title
    });
    handleSaveToNotebook(title, payload, 'studio_flashcards');
  };

  const handleSaveMarkdownArtifactToNotebook = () => {
    if (!artifactData || !artifactData.content) return;
    const toolLabel = getToolLabel(activeArtifactType);
    const title = `${toolLabel}: ${artifactData.title || 'Studio Hub'}`;
    const payload = JSON.stringify({
      type: 'markdown',
      artifact_type: activeArtifactType,
      title: title,
      content: artifactData.content
    });
    handleSaveToNotebook(title, payload, `studio_${activeArtifactType}`);
  };

  const handleExportFlashcardsCSV = () => {
    if (!artifactData || !Array.isArray(artifactData.data) || artifactData.data.length === 0) return;
    const cards = artifactData.data;
    const rows = cards.map((c: any) => {
      const cleanFront = (c.front || '').replace(/"/g, '""');
      const cleanBack = (c.back || '').replace(/"/g, '""');
      return `"${cleanFront}","${cleanBack}"`;
    });
    
    const csvContent = '\uFEFF' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const sanitizedTitle = (artifactData.title || 'flashcards').replace(/[^a-zA-Z0-9_-]/g, '_');
    link.href = url;
    link.setAttribute('download', `${sanitizedTitle}_flashcards.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const calculateScore = (questions: QuizQuestion[]) => {
    let score = 0;
    questions.forEach(q => {
      if (userAnswers[q.id] === q.correct_index) score++;
    });
    return score;
  };

  const getToolLabel = (type: string) => {
    switch (type) {
      case 'briefing': return 'Documento Briefing';
      case 'faq': return 'Preguntas FAQ';
      case 'timeline': return 'Línea de Tiempo';
      case 'quiz': return 'Examen / Quiz';
      case 'flashcards': return 'Flashcards 3D';
      default: return type;
    }
  };

  return (
    <section id="studio-tab" className={`flex-col gap-6 w-full ${active ? 'flex' : 'hidden'}`}>
      <div className="mb-1">
        <h2 className="text-2xl font-semibold text-white tracking-tight mb-1">🎨 Studio Hub: Generador Multifuente de Estudio</h2>
        <p className="text-sm text-zinc-400">Configura el enfoque personalizado de cada modo y sintetiza briefings, exámenes y flashcards interactivos.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start w-full">
        {/* Left Side: Multi-Source Selector Card */}
        <div className="p-4 sm:p-5 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col h-[680px] overflow-hidden">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-layer-group text-amber-500"></i>
              Fuentes para Studio ({selectedSourceIds.size})
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto pr-1">
            <FolderTree
              projects={projects}
              folders={folders}
              transcriptions={transcriptionList}
              selectedSourceIds={selectedSourceIds}
              onToggleSource={handleToggleSource}
              onToggleFolder={handleToggleFolder}
              onToggleProject={handleToggleProject}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
              isManagementMode={false}
            />
          </div>
        </div>

        {/* Right Side: Studio Tools & Control Bar */}
        <div className="flex flex-col gap-5 w-full min-w-0">
          {/* Mode Selector Buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <button
              type="button"
              className={`p-3.5 rounded-xl border flex flex-col items-center gap-2 text-center transition-all cursor-pointer ${
                activeArtifactType === 'briefing'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-lg shadow-amber-500/10 font-semibold'
                  : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.07] text-zinc-300'
              }`}
              onClick={() => setActiveArtifactType('briefing')}
            >
              <i className="fa-solid fa-file-signature text-2xl text-amber-400"></i>
              <span className="text-xs">Documento Briefing</span>
            </button>

            <button
              type="button"
              className={`p-3.5 rounded-xl border flex flex-col items-center gap-2 text-center transition-all cursor-pointer ${
                activeArtifactType === 'faq'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-lg shadow-amber-500/10 font-semibold'
                  : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.07] text-zinc-300'
              }`}
              onClick={() => setActiveArtifactType('faq')}
            >
              <i className="fa-solid fa-circle-question text-2xl text-sky-400"></i>
              <span className="text-xs">Preguntas FAQ</span>
            </button>

            <button
              type="button"
              className={`p-3.5 rounded-xl border flex flex-col items-center gap-2 text-center transition-all cursor-pointer ${
                activeArtifactType === 'timeline'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-lg shadow-amber-500/10 font-semibold'
                  : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.07] text-zinc-300'
              }`}
              onClick={() => setActiveArtifactType('timeline')}
            >
              <i className="fa-solid fa-timeline text-2xl text-emerald-400"></i>
              <span className="text-xs">Línea de Tiempo</span>
            </button>

            <button
              type="button"
              className={`p-3.5 rounded-xl border flex flex-col items-center gap-2 text-center transition-all cursor-pointer ${
                activeArtifactType === 'quiz'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-lg shadow-amber-500/10 font-semibold'
                  : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.07] text-zinc-300'
              }`}
              onClick={() => setActiveArtifactType('quiz')}
            >
              <i className="fa-solid fa-brain text-2xl text-purple-400"></i>
              <span className="text-xs">Examen / Quiz</span>
            </button>

            <button
              type="button"
              className={`p-3.5 rounded-xl border flex flex-col items-center gap-2 text-center transition-all cursor-pointer ${
                activeArtifactType === 'flashcards'
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-lg shadow-amber-500/10 font-semibold'
                  : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.07] text-zinc-300'
              }`}
              onClick={() => setActiveArtifactType('flashcards')}
            >
              <i className="fa-solid fa-clone text-2xl text-pink-400"></i>
              <span className="text-xs">Flashcards 3D</span>
            </button>
          </div>

          {/* Action & Configuration Bar */}
          <div className="p-4 rounded-xl bg-[#17171c]/90 border border-white/10 backdrop-blur-md shadow-xl flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2.5 flex-wrap text-xs">
              <button
                type="button"
                className="px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-white font-medium flex items-center gap-2 cursor-pointer transition-colors"
                onClick={() => setShowConfigModal(true)}
              >
                <i className="fa-solid fa-gear text-amber-400"></i>
                Configurar {getToolLabel(activeArtifactType)}
              </button>

              {/* Badges showing current mode configuration */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeArtifactType === 'quiz' && (
                  <span className="px-2.5 py-1 rounded-md bg-purple-500/15 border border-purple-500/30 text-purple-300 text-[11px] font-semibold">
                    {currentConfig.count} Preguntas · Nivel {currentConfig.difficulty}
                  </span>
                )}
                {activeArtifactType === 'flashcards' && (
                  <span className="px-2.5 py-1 rounded-md bg-pink-500/15 border border-pink-500/30 text-pink-300 text-[11px] font-semibold">
                    {currentConfig.count} Tarjetas · Nivel {currentConfig.difficulty}
                  </span>
                )}
                {(activeArtifactType === 'briefing' || activeArtifactType === 'faq' || activeArtifactType === 'timeline') && (
                  <span className="px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold">
                    Extensión: {currentConfig.lengthSetting}
                  </span>
                )}
                {currentConfig.customInstructions.trim() !== '' && (
                  <span className="px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-semibold flex items-center gap-1">
                    <i className="fa-solid fa-bullseye"></i> Enfoque Personalizado Activo
                  </span>
                )}
              </div>
            </div>

            {/* Synthesize Action Button */}
            <button
              type="button"
              className="py-2.5 px-6 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50"
              onClick={handleExecuteSynthesis}
              disabled={isGenerating || selectedSourceIds.size === 0}
            >
              {isGenerating ? (
                <><i className="fa-solid fa-spinner fa-spin"></i> Sintetizando...</>
              ) : (
                <><i className="fa-solid fa-bolt"></i> Sintetizar {getToolLabel(activeArtifactType)}</>
              )}
            </button>
          </div>

          {/* Artifact Output Container */}
          <div className="p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col min-h-[480px]">
            {isGenerating ? (
              <div className="flex flex-col items-center justify-center gap-4 my-auto text-center py-16">
                <div className="w-16 h-16 rounded-full bg-amber-500/15 border-2 border-amber-500 flex items-center justify-center animate-pulse">
                  <i className="fa-solid fa-wand-magic-sparkles text-2xl text-amber-400"></i>
                </div>
                <div>
                  <h4 className="text-base font-semibold text-amber-400 mb-1">
                    Sintetizando {getToolLabel(activeArtifactType)} Multifuente...
                  </h4>
                  <p className="text-xs text-zinc-400 max-w-md mx-auto">
                    El modelo Gemma 4 está analizando {selectedSourceIds.size} fuente(s) con tu configuración personalizada de {getToolLabel(activeArtifactType)}.
                  </p>
                </div>
              </div>
            ) : artifactData ? (
              <div className="flex flex-col gap-4">
                {/* Markdown Artifact View */}
                {(artifactData.type === 'markdown' || Boolean(artifactData.content && artifactData.type !== 'quiz' && artifactData.type !== 'flashcards')) && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                        <i className="fa-solid fa-sparkles"></i> Artefacto Generado ({getToolLabel(activeArtifactType)})
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-medium cursor-pointer flex items-center gap-1.5"
                          onClick={handleSaveMarkdownArtifactToNotebook}
                        >
                          <i className="fa-solid fa-bookmark"></i> Guardar en Cuaderno
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-zinc-300 text-xs cursor-pointer"
                          onClick={() => navigator.clipboard.writeText(artifactData.content)}
                        >
                          <i className="fa-solid fa-copy"></i> Copiar Markdown
                        </button>
                      </div>
                    </div>

                    <div
                      className="prose prose-invert max-w-none text-sm text-zinc-300 leading-relaxed space-y-3"
                      dangerouslySetInnerHTML={renderMarkdown(artifactData.content)}
                    ></div>
                  </div>
                )}

                {/* Interactive Quiz / Exam Player */}
                {artifactData.type === 'quiz' && Array.isArray(artifactData.data) && (
                  <div className="flex flex-col gap-6">
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <div>
                        <h3 className="text-base font-semibold text-white flex items-center gap-2">
                          <i className="fa-solid fa-brain text-purple-400"></i>
                          Examen Interactivo ({artifactData.data.length} Preguntas - Nivel {currentConfig.difficulty})
                        </h3>
                        <p className="text-xs text-zinc-400 mt-0.5">Selecciona tus respuestas y evalúa tu nivel de conocimiento.</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-medium text-xs cursor-pointer flex items-center gap-1.5 transition-colors"
                          onClick={handleSaveQuizToNotebook}
                          title="Guardar este examen interactivo en el Cuaderno de Notas"
                        >
                          <i className="fa-solid fa-bookmark text-amber-400"></i> Guardar en Cuaderno
                        </button>

                        {showQuizResults ? (
                          <div className="flex items-center gap-3">
                            <span className="px-3 py-1 rounded-lg bg-amber-500 text-zinc-950 font-bold text-xs">
                              Puntuación: {calculateScore(artifactData.data)} / {artifactData.data.length} ({Math.round((calculateScore(artifactData.data) / artifactData.data.length) * 100)}%)
                            </span>
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs cursor-pointer"
                              onClick={() => { setUserAnswers({}); setShowQuizResults(false); }}
                            >
                              <i className="fa-solid fa-rotate-left"></i> Reiniciar Examen
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs cursor-pointer shadow-lg shadow-purple-500/20"
                            onClick={() => setShowQuizResults(true)}
                            disabled={Object.keys(userAnswers).length === 0}
                          >
                            <i className="fa-solid fa-check-double"></i> Calificar Examen
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-5">
                      {artifactData.data.map((q: QuizQuestion, qIdx: number) => {
                        const selectedIdx = userAnswers[q.id];
                        const isCorrect = selectedIdx === q.correct_index;

                        return (
                          <div key={q.id} className="p-4 sm:p-5 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-3">
                            <div className="font-semibold text-white text-sm flex items-start gap-2">
                              <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold text-xs shrink-0">#{qIdx + 1}</span>
                              <span>{q.question}</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                              {q.options.map((opt: string, optIdx: number) => {
                                let btnStyle = "bg-white/[0.04] border-white/10 text-zinc-300 hover:bg-white/[0.08]";
                                if (selectedIdx === optIdx) {
                                  btnStyle = "bg-amber-500/20 border-amber-500 text-amber-300 font-semibold";
                                }

                                if (showQuizResults) {
                                  if (optIdx === q.correct_index) {
                                    btnStyle = "bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold";
                                  } else if (selectedIdx === optIdx && !isCorrect) {
                                    btnStyle = "bg-red-500/20 border-red-500 text-red-300 font-semibold";
                                  }
                                }

                                return (
                                  <button
                                    key={optIdx}
                                    type="button"
                                    className={`p-3 rounded-lg border text-xs text-left transition-all cursor-pointer ${btnStyle}`}
                                    onClick={() => !showQuizResults && setUserAnswers(prev => ({ ...prev, [q.id]: optIdx }))}
                                  >
                                    <span className="font-bold mr-2 text-zinc-400">{String.fromCharCode(65 + optIdx)}.</span>
                                    {opt}
                                  </button>
                                );
                              })}
                            </div>

                            {showQuizResults && (
                              <div className={`p-3 rounded-lg text-xs leading-relaxed mt-1 ${isCorrect ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border border-amber-500/30 text-amber-300'}`}>
                                <strong>Explicación:</strong> {q.explanation}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Interactive 3D Flashcards Player */}
                {artifactData.type === 'flashcards' && Array.isArray(artifactData.data) && artifactData.data.length > 0 && (
                  <div className="flex flex-col items-center gap-6 py-4">
                    <div className="w-full flex items-center justify-between pb-3 border-b border-white/10 flex-wrap gap-2">
                      <h3 className="text-base font-semibold text-white flex items-center gap-2">
                        <i className="fa-solid fa-clone text-pink-400"></i>
                        Tarjetas de Estudio 3D ({currentCardIndex + 1} de {artifactData.data.length})
                      </h3>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg bg-pink-500/15 hover:bg-pink-500/25 border border-pink-500/30 text-pink-300 font-medium text-xs cursor-pointer flex items-center gap-1.5 transition-colors"
                          onClick={handleExportFlashcardsCSV}
                          title="Exportar esta colección de tarjetas 3D a un archivo CSV"
                        >
                          <i className="fa-solid fa-file-csv text-pink-400"></i> Exportar a CSV
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-medium text-xs cursor-pointer flex items-center gap-1.5 transition-colors"
                          onClick={handleSaveFlashcardsToNotebook}
                          title="Guardar esta colección de tarjetas 3D en el Cuaderno de Notas"
                        >
                          <i className="fa-solid fa-bookmark text-amber-400"></i> Guardar en Cuaderno
                        </button>
                        <span className="text-xs text-zinc-400">Haz clic en la tarjeta para voltearla</span>
                      </div>
                    </div>

                    {/* 3D Flip Card */}
                    <div
                      className="w-full max-w-xl h-72 cursor-pointer perspective-1000"
                      onClick={() => setIsFlipped(!isFlipped)}
                    >
                      <div className={`relative w-full h-full rounded-2xl border transition-all duration-500 shadow-2xl p-8 flex flex-col justify-between ${
                        isFlipped
                          ? 'bg-gradient-to-br from-pink-950/80 to-purple-950/80 border-pink-500/40 text-pink-100'
                          : 'bg-gradient-to-br from-slate-900 to-zinc-900 border-amber-500/40 text-white'
                      }`}>
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span className={isFlipped ? 'text-pink-400' : 'text-amber-400'}>
                            {isFlipped ? '💡 Explicación / Respuesta (Reverso)' : '❓ Pregunta / Concepto (Frente)'}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-white/10 text-zinc-300">
                            #{currentCardIndex + 1}
                          </span>
                        </div>

                        <div className="text-center my-auto px-4">
                          <p className="text-lg font-medium leading-relaxed">
                            {isFlipped ? artifactData.data[currentCardIndex].back : artifactData.data[currentCardIndex].front}
                          </p>
                        </div>

                        <div className="text-center text-[11px] text-zinc-400">
                          <i className="fa-solid fa-rotate mr-1"></i> Toca para voltear tarjeta
                        </div>
                      </div>
                    </div>

                    {/* Navigation Controls */}
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold cursor-pointer disabled:opacity-40"
                        onClick={() => {
                          setCurrentCardIndex(prev => Math.max(0, prev - 1));
                          setIsFlipped(false);
                        }}
                        disabled={currentCardIndex === 0}
                      >
                        <i className="fa-solid fa-chevron-left mr-1"></i> Anterior
                      </button>

                      <span className="text-xs font-mono text-zinc-400">
                        {currentCardIndex + 1} / {artifactData.data.length}
                      </span>

                      <button
                        type="button"
                        className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs cursor-pointer disabled:opacity-40"
                        onClick={() => {
                          setCurrentCardIndex(prev => Math.min(artifactData.data.length - 1, prev + 1));
                          setIsFlipped(false);
                        }}
                        disabled={currentCardIndex === artifactData.data.length - 1}
                      >
                        Siguiente <i className="fa-solid fa-chevron-right ml-1"></i>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center my-auto py-16 text-zinc-500 text-sm">
                <i className="fa-solid fa-wand-magic-sparkles text-4xl mb-3 block opacity-30 text-amber-500"></i>
                Presiona el botón <strong>"⚡ Sintetizar {getToolLabel(activeArtifactType)}"</strong> para generar tu contenido personalizado.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Configuration Modal */}
      {showConfigModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowConfigModal(false)}>
          <div className="p-6 rounded-2xl bg-[#17171c] border border-amber-500/40 shadow-2xl max-w-lg w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <i className="fa-solid fa-gear text-amber-400"></i>
                Configuración Independiente: {getToolLabel(activeArtifactType)}
              </h3>
              <button type="button" className="text-zinc-400 hover:text-white" onClick={() => setShowConfigModal(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="flex flex-col gap-4 text-xs">
              {/* Option: Count (Quiz / Flashcards) */}
              {activeArtifactType === 'quiz' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-zinc-300 font-medium">Cantidad de Preguntas ({currentConfig.count})</label>
                  <input
                    type="range"
                    min={3}
                    max={20}
                    step={1}
                    value={currentConfig.count}
                    onChange={e => updateCurrentConfig({ count: parseInt(e.target.value) })}
                    className="accent-amber-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>3 preguntas</span>
                    <span>10 preguntas</span>
                    <span>20 preguntas</span>
                  </div>
                </div>
              )}

              {activeArtifactType === 'flashcards' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-zinc-300 font-medium">Cantidad de Tarjetas ({currentConfig.count})</label>
                  <input
                    type="range"
                    min={5}
                    max={25}
                    step={1}
                    value={currentConfig.count}
                    onChange={e => updateCurrentConfig({ count: parseInt(e.target.value) })}
                    className="accent-amber-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>5 tarjetas</span>
                    <span>15 tarjetas</span>
                    <span>25 tarjetas</span>
                  </div>
                </div>
              )}

              {/* Option: Difficulty (Quiz / Flashcards) */}
              {(activeArtifactType === 'quiz' || activeArtifactType === 'flashcards') && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-zinc-300 font-medium">Nivel de Dificultad</label>
                  <select
                    className="bg-black/40 border border-white/10 rounded-lg p-2.5 text-white focus:outline-none focus:border-amber-500"
                    value={currentConfig.difficulty}
                    onChange={e => updateCurrentConfig({ difficulty: e.target.value })}
                  >
                    <option value="Fácil">Fácil (Conceptos introductorios)</option>
                    <option value="Intermedio">Intermedio (Comprensión general)</option>
                    <option value="Avanzado">Avanzado / Exigente (Detalles profundos)</option>
                  </select>
                </div>
              )}

              {/* Option: Length (Briefing / FAQ / Timeline) */}
              {(activeArtifactType === 'briefing' || activeArtifactType === 'faq' || activeArtifactType === 'timeline') && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-zinc-300 font-medium">Extensión del Documento</label>
                  <select
                    className="bg-black/40 border border-white/10 rounded-lg p-2.5 text-white focus:outline-none focus:border-amber-500"
                    value={currentConfig.lengthSetting}
                    onChange={e => updateCurrentConfig({ lengthSetting: e.target.value })}
                  >
                    <option value="Breve">Breve / Conciso (Resumen rápido)</option>
                    <option value="Estándar">Estándar (Equilibrado)</option>
                    <option value="Detallado">Detallado / Exhaustivo (Profundo)</option>
                  </select>
                </div>
              )}

              {/* Option: Custom Instructions Prompt (INDEPENDENT PER MODE) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-zinc-300 font-medium flex items-center justify-between">
                  <span>Enfoque e Instrucciones Exclusivas para {getToolLabel(activeArtifactType)}</span>
                </label>
                <textarea
                  rows={4}
                  className="bg-black/40 border border-white/10 rounded-lg p-2.5 text-white font-sans focus:outline-none focus:border-amber-500 resize-none text-xs leading-relaxed"
                  placeholder={`Escribe aquí el enfoque específico únicamente para ${getToolLabel(activeArtifactType)}...`}
                  value={currentConfig.customInstructions}
                  onChange={e => updateCurrentConfig({ customInstructions: e.target.value })}
                ></textarea>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs cursor-pointer transition-colors flex items-center gap-1.5"
                onClick={() => setShowConfigModal(false)}
              >
                <i className="fa-solid fa-check"></i> Aplicar Configuración
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
