import React, { useState, useEffect, useRef, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Marked } from 'marked';
import { Transcription, Message, Project, Folder, ChatSession, WebSource, CitationItem } from '../types';
import FolderTree from './FolderTree';

const marked = new Marked();

interface ChatTabProps {
  transcriptionList: Transcription[];
  activeId: number | null;
  setActiveId?: (id: number) => void;
  active: boolean;
}

export default function ChatTab({ transcriptionList, activeId, setActiveId, active }: ChatTabProps) {
  // Multi-source selection state
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<number>>(new Set());
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [showSelectorCard, setShowSelectorCard] = useState<boolean>(true);

  // Chat Session & History State
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessionsPanel, setShowSessionsPanel] = useState<boolean>(false);

  // Search Mode & Parameters State
  const [searchMode, setSearchMode] = useState<'local' | 'web' | 'hybrid'>('local');
  const [searchDepth, setSearchDepth] = useState<'quick' | 'deep'>('quick');
  const [timeFilter, setTimeFilter] = useState<string>('');
  const [domainFilter, setDomainFilter] = useState<string>('');
  const [similarityThreshold, setSimilarityThreshold] = useState<number>(0.50);
  const [showSearchSettings, setShowSearchSettings] = useState<boolean>(false);

  // Confirmation modal state for Local chat without sources
  const [isNoSourcesConfirmed, setIsNoSourcesConfirmed] = useState<boolean>(false);
  const [showNoSourcesModal, setShowNoSourcesModal] = useState<boolean>(false);
  const [pendingMessage, setPendingMessage] = useState<string>('');

  // Promote Web Source Modal State
  const [promoteTargetUrl, setPromoteTargetUrl] = useState<string | null>(null);
  const [promoteProjectId, setPromoteProjectId] = useState<number | ''>('');
  const [promoteFolderId, setPromoteFolderId] = useState<number | ''>('');
  const [isPromoting, setIsPromoting] = useState<boolean>(false);

  // Export & Import Chat Session Modal States
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [copiedSuccess, setCopiedSuccess] = useState<boolean>(false);
  const [importJsonText, setImportJsonText] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputVal, setInputVal] = useState<string>('');
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [openedSourcesIdx, setOpenedSourcesIdx] = useState<Record<number, boolean>>({});
  const [selectedCitation, setSelectedCitation] = useState<CitationItem | null>(null);

  const chatBubblesEndRef = useRef<HTMLDivElement>(null);

  // Fetch Projects & Folders
  const fetchProjectsAndFolders = async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
        setFolders(data.folders || []);
      }
    } catch (e) {
      console.error('Error fetching projects in ChatTab:', e);
    }
  };

  // Fetch Chat Sessions History
  const fetchChatSessions = async () => {
    try {
      const res = await fetch('/api/chat/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data || []);
      }
    } catch (e) {
      console.error('Error fetching chat sessions:', e);
    }
  };

  useEffect(() => {
    fetchProjectsAndFolders();
    fetchChatSessions();
  }, [active]);

  // Sync activeId from parent if present (otherwise default to empty selection)
  useEffect(() => {
    if (activeId) {
      setSelectedSourceIds(new Set([activeId]));
    }
  }, [activeId]);

  // Auto-scroll chat bubbles to bottom
  useEffect(() => {
    if (active) {
      chatBubblesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping, active]);

  // Toggle individual source selection
  const handleToggleSource = (id: number) => {
    setSelectedSourceIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Toggle all sources in a folder
  const handleToggleFolder = (folderId: number) => {
    const folderSources = transcriptionList.filter(s => s.folder_id === folderId).map(s => s.id);
    if (folderSources.length === 0) return;

    const allSelected = folderSources.every(id => selectedSourceIds.has(id));
    setSelectedSourceIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        folderSources.forEach(id => next.delete(id));
      } else {
        folderSources.forEach(id => next.add(id));
      }
      return next;
    });
  };

  // Toggle all sources in a project
  const handleToggleProject = (projectId: number) => {
    const projectSources = transcriptionList.filter(s => s.project_id === projectId).map(s => s.id);
    if (projectSources.length === 0) return;

    const allSelected = projectSources.every(id => selectedSourceIds.has(id));
    setSelectedSourceIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        projectSources.forEach(id => next.delete(id));
      } else {
        projectSources.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedSourceIds(new Set(transcriptionList.map(s => s.id)));
  };

  const handleDeselectAll = () => {
    setSelectedSourceIds(new Set());
  };

  const toggleAccordion = (idx: number) => {
    setOpenedSourcesIdx(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  // Switch to a new clean conversation
  const handleNewConversation = () => {
    setActiveSessionId(null);
    setMessages([]);
    setIsNoSourcesConfirmed(false);
  };

  // Load a chat session from history
  const handleSelectSession = async (session: ChatSession) => {
    setActiveSessionId(session.id);
    setShowSessionsPanel(false);
    try {
      const res = await fetch(`/api/chat/sessions/${session.id}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        if (data.source_ids && data.source_ids.length > 0) {
          setSelectedSourceIds(new Set(data.source_ids));
        }
      }
    } catch (e) {
      console.error('Error loading chat session payload:', e);
    }
  };

  // Delete a chat session
  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('¿Eliminar esta conversación del historial?')) return;
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
      if (res.ok) {
        if (activeSessionId === sessionId) {
          handleNewConversation();
        }
        fetchChatSessions();
      }
    } catch (err) {
      console.error('Error deleting session:', err);
    }
  };

  // Export session JSON download
  const handleDownloadExportJson = () => {
    if (messages.length === 0) return;
    const payload = {
      session_id: activeSessionId || `session_${Date.now()}`,
      title: messages[0]?.content?.substring(0, 40) || 'Conversación RAG',
      created_at: new Date().toISOString(),
      source_ids: Array.from(selectedSourceIds),
      search_mode: searchMode,
      messages: messages
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat_export_${payload.session_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Copy export payload to clipboard
  const handleCopyExportClipboard = () => {
    if (messages.length === 0) return;
    const payload = {
      session_id: activeSessionId || `session_${Date.now()}`,
      title: messages[0]?.content?.substring(0, 40) || 'Conversación RAG',
      created_at: new Date().toISOString(),
      source_ids: Array.from(selectedSourceIds),
      search_mode: searchMode,
      messages: messages
    };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopiedSuccess(true);
    setTimeout(() => setCopiedSuccess(false), 2500);
  };

  // Execute import payload
  const handleExecuteImport = async () => {
    if (!importJsonText.trim()) return;
    setIsImporting(true);
    try {
      const payload = JSON.parse(importJsonText);
      const res = await fetch('/api/chat/sessions/import', {
        method: 'POST',
        headers: { 'Content-[#Type]': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Falló al importar la sesión.');
      const data = await res.json();
      
      await fetchChatSessions();
      setActiveSessionId(data.session_id);
      setMessages(payload.messages || []);
      if (payload.source_ids) {
        setSelectedSourceIds(new Set(payload.source_ids));
      }
      setShowImportModal(false);
      setImportJsonText('');
      alert('¡Conversación importada con éxito!');
    } catch (e: any) {
      alert(`Error al importar JSON: ${e.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (evt.target?.result) {
        setImportJsonText(evt.target.result as string);
      }
    };
    reader.readAsText(file);
  };

  // Save/Promote Web Source to Permanent Project
  const handlePromoteWebSource = async () => {
    if (!promoteTargetUrl) return;
    setIsPromoting(true);
    try {
      const res = await fetch('/api/web/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: [promoteTargetUrl],
          project_id: promoteProjectId !== '' ? promoteProjectId : null,
          folder_id: promoteFolderId !== '' ? promoteFolderId : null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Error al guardar fuente web.');

      alert(`¡Página web guardada con éxito en tu biblioteca permanentemente!`);
      setPromoteTargetUrl(null);
      fetchProjectsAndFolders();
    } catch (err: any) {
      alert(`Error al guardar fuente web: ${err.message}`);
    } finally {
      setIsPromoting(false);
    }
  };

  // Primary Send Message Action
  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    const query = inputVal.trim();
    if (!query || isTyping) return;

    // Check if user is in 'local' mode without any selected sources
    if (searchMode === 'local' && selectedSourceIds.size === 0 && !isNoSourcesConfirmed) {
      setPendingMessage(query);
      setShowNoSourcesModal(true);
      return;
    }

    await dispatchQuery(query);
  };

  const handleAcceptNoSources = async () => {
    setIsNoSourcesConfirmed(true);
    setShowNoSourcesModal(false);
    if (pendingMessage) {
      const q = pendingMessage;
      setPendingMessage('');
      await dispatchQuery(q);
    }
  };

  const handleRejectNoSources = () => {
    setShowNoSourcesModal(false);
    setPendingMessage('');
    setShowSelectorCard(true);
  };

  const dispatchQuery = async (queryText: string) => {
    const userMsg: Message = { role: 'user', content: queryText };
    setMessages(prev => [...prev, userMsg]);
    setInputVal('');
    setIsTyping(true);

    try {
      const payload = {
        session_id: activeSessionId,
        query: queryText,
        source_ids: Array.from(selectedSourceIds),
        search_mode: searchMode,
        search_depth: searchDepth,
        time_filter: timeFilter || null,
        domain_filter: domainFilter || null,
        similarity_threshold: similarityThreshold,
        history: messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        let errStr = 'Error al procesar consulta de Chat RAG.';
        if (typeof data.detail === 'string') {
          errStr = data.detail;
        } else if (Array.isArray(data.detail)) {
          errStr = data.detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ');
        } else if (data.detail) {
          errStr = JSON.stringify(data.detail);
        }
        throw new Error(errStr);
      }

      if (data.session_id && !activeSessionId) {
        setActiveSessionId(data.session_id);
        fetchChatSessions();
      }

      const assistantMsg: Message = {
        role: 'assistant',
        content: data.response || data.answer || 'Sin respuesta generada.',
        sources: data.sources || [],
        web_sources: data.web_sources || [],
        citations: data.citations || [],
        search_logs: data.search_logs || []
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      const errMsg = typeof err === 'string' ? err : (err.message || 'Error desconocido');
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `❌ Error de RAG: ${errMsg}` }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const renderMarkdown = (text: string) => {
    if (!text) return { __html: '' };
    marked.use({ breaks: true, gfm: true });
    let rawHtml = marked.parse(text) as string;
    // Replace citation tags [1], [2] with stylized inline badge spans
    rawHtml = rawHtml.replace(/\[(\d+)\]/g, '<span class="inline-flex items-center justify-center px-1.5 py-0.2 mx-0.5 text-[10px] font-bold text-zinc-950 bg-amber-400 rounded-full cursor-pointer hover:bg-amber-300 transition-colors shadow-sm" title="Cita [$1]">$1</span>');
    return { __html: rawHtml };
  };

  const formatDate = (isoStr?: string) => {
    if (!isoStr) return '';
    return isoStr.substring(0, 16).replace('T', ' ');
  };

  const activeSessionObj = sessions.find(s => s.id === activeSessionId);

  return (
    <section id="chat-tab" className={`flex-col gap-6 w-full ${active ? 'flex' : 'hidden'} lg:h-full lg:overflow-hidden`}>
      {/* Top Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 mb-1">
        <div>
          <h2 className="text-2xl font-semibold text-white tracking-tight mb-1">Chat RAG Agentico</h2>
          <p className="text-sm text-zinc-400">Consulta de forma inteligente sobre múltiples fuentes locales o investiga en la web con sintesis en tiempo real.</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
              showSessionsPanel 
                ? 'bg-amber-500 text-zinc-950 shadow-md shadow-amber-500/20' 
                : 'bg-white/10 text-white hover:bg-white/15 border border-white/10'
            }`}
            onClick={() => setShowSessionsPanel(!showSessionsPanel)}
          >
            <i className="fa-solid fa-clock-rotate-left"></i> Historial ({sessions.length})
          </button>

          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => setShowExportModal(true)}
            disabled={messages.length === 0}
            title="Exportar payload completo del chat"
          >
            <i className="fa-solid fa-file-export text-sky-400"></i> Exportar
          </button>

          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
            onClick={() => setShowImportModal(true)}
            title="Importar conversación desde JSON"
          >
            <i className="fa-solid fa-file-import text-emerald-400"></i> Importar
          </button>

          <button
            type="button"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
              showSearchSettings
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : 'bg-white/10 text-white hover:bg-white/15 border border-white/10'
            }`}
            onClick={() => setShowSearchSettings(!showSearchSettings)}
            title="Ajustes de Búsqueda y Parámetros RAG"
          >
            <i className="fa-solid fa-sliders"></i> Ajustes Web
          </button>
        </div>
      </div>

      {/* Mode Selector Pill Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full mb-1">
        <button
          type="button"
          className={`flex items-center justify-center gap-2 p-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
            searchMode === 'local'
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-400 shadow-md shadow-amber-500/10'
              : 'bg-white/[0.02] border-white/10 text-zinc-400 hover:text-white hover:bg-white/[0.04]'
          }`}
          onClick={() => setSearchMode('local')}
        >
          <i className="fa-solid fa-folder-open text-amber-500"></i> 1. Solo Fuentes Locales ({selectedSourceIds.size})
        </button>

        <button
          type="button"
          className={`flex items-center justify-center gap-2 p-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
            searchMode === 'web'
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-400 shadow-md shadow-amber-500/10'
              : 'bg-white/[0.02] border-white/10 text-zinc-400 hover:text-white hover:bg-white/[0.04]'
          }`}
          onClick={() => setSearchMode('web')}
        >
          <i className="fa-solid fa-globe text-sky-400"></i> 2. Búsqueda Web Agentica
        </button>

        <button
          type="button"
          className={`flex items-center justify-center gap-2 p-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
            searchMode === 'hybrid'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 shadow-md shadow-emerald-500/10'
              : 'bg-white/[0.02] border-white/10 text-zinc-400 hover:text-white hover:bg-white/[0.04]'
          }`}
          onClick={() => setSearchMode('hybrid')}
        >
          <i className="fa-solid fa-dna text-emerald-400"></i> 3. Híbrido (Locales + Web)
        </button>
      </div>

      {/* Advanced Search Parameters Panel */}
      {showSearchSettings && (
        <div className="p-4 sm:p-5 rounded-xl bg-[#17171c] border border-amber-500/40 shadow-xl flex flex-col gap-4 mb-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-amber-400 flex items-center gap-2">
              <i className="fa-solid fa-sliders"></i> Controles de Búsqueda Web y Precisión RAG
            </h4>
            <button 
              className="text-xs text-zinc-400 hover:text-white px-2 py-1 bg-white/5 rounded cursor-pointer"
              onClick={() => setShowSearchSettings(false)}
            >
              Cerrar
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div className="flex flex-col gap-1.5">
              <label className="text-zinc-300 font-medium">Profundidad de Búsqueda</label>
              <select
                className="bg-[#1e293b] border border-white/10 rounded-lg text-white p-2 focus:outline-none focus:border-amber-500"
                value={searchDepth}
                onChange={e => setSearchDepth(e.target.value as 'quick' | 'deep')}
              >
                <option value="quick">⚡ Rápida (3 URLs / Top 4 chunks)</option>
                <option value="deep">🔬 Profunda (6 URLs / Top 10 chunks)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-zinc-300 font-medium">Filtro Temporal</label>
              <select
                className="bg-[#1e293b] border border-white/10 rounded-lg text-white p-2 focus:outline-none focus:border-amber-500"
                value={timeFilter}
                onChange={e => setTimeFilter(e.target.value)}
              >
                <option value="">Cualquier momento</option>
                <option value="day">Últimas 24 horas</option>
                <option value="week">Última semana</option>
                <option value="month">Último mes</option>
                <option value="year">Último año</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-zinc-300 font-medium">Filtro de Dominios (Opcional)</label>
              <input
                type="text"
                className="bg-[#1e293b] border border-white/10 rounded-lg text-white p-2 focus:outline-none focus:border-amber-500"
                placeholder="Ej. arxiv.org, github.com"
                value={domainFilter}
                onChange={e => setDomainFilter(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-zinc-300 font-medium">
                Umbral Vectorial ({Math.round(similarityThreshold * 100)}%)
              </label>
              <input
                type="range"
                min="0.30"
                max="0.85"
                step="0.05"
                value={similarityThreshold}
                onChange={e => setSimilarityThreshold(parseFloat(e.target.value))}
                className="accent-amber-500 cursor-pointer my-auto"
              />
            </div>
          </div>
        </div>
      )}

      {/* Main Layout Grid */}
      <div className={`grid gap-6 items-stretch flex-1 min-h-0 w-full min-w-0 ${
        (showSelectorCard && searchMode !== 'web') ? 'grid-cols-1 lg:grid-cols-[320px_1fr]' : 'grid-cols-1'
      }`}>
        
        {/* Left Side: Multi-Source Selector Panel */}
        {showSelectorCard && searchMode !== 'web' && (
          <div className="flex flex-col gap-4 w-full min-h-0 lg:h-full">
            <div className="p-4 sm:p-5 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col h-[560px] lg:h-full overflow-hidden">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <i className="fa-solid fa-layer-group text-amber-500"></i>
                  Fuentes Locales
                </h3>
                <button 
                  type="button" 
                  className="px-2 py-1 text-xs text-zinc-400 hover:text-white bg-white/5 rounded cursor-pointer transition-colors"
                  onClick={() => setShowSelectorCard(false)}
                  title="Ocultar selector"
                >
                  <i className="fa-solid fa-chevron-left"></i> Ocultar
                </button>
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
          </div>
        )}

        {/* Right Side: Chat Container */}
        <div className="flex flex-col gap-3 w-full min-w-0 min-h-0 lg:h-full">
          <div className="rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col h-[560px] lg:h-full overflow-hidden" id="chat-container-card">
            
            {/* Active Session & Search Mode Badge Bar */}
            <div className="px-4 py-2.5 bg-amber-500/5 border-b border-white/10 flex items-center justify-between text-xs flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                {(!showSelectorCard || searchMode === 'web') && (
                  <button
                    type="button"
                    className="px-2 py-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded flex items-center gap-1 cursor-pointer hover:bg-amber-500/20"
                    onClick={() => { setShowSelectorCard(true); if (searchMode === 'web') setSearchMode('local'); }}
                    title="Mostrar selector de fuentes"
                  >
                    <i className="fa-solid fa-folder-open"></i> Mostrar Fuentes ({selectedSourceIds.size})
                  </button>
                )}
                <span className="text-amber-400 font-semibold flex items-center gap-1.5">
                  {searchMode === 'local' && (
                    <><i className="fa-solid fa-folder-open"></i> RAG Local ({selectedSourceIds.size > 0 ? `${selectedSourceIds.size} fuentes` : 'Sin fuentes - Conocimiento Crudo'})</>
                  )}
                  {searchMode === 'web' && <><i className="fa-solid fa-globe text-sky-400"></i> RAG Web Agentico</>}
                  {searchMode === 'hybrid' && <><i className="fa-solid fa-dna text-emerald-400"></i> RAG Híbrido (Locales + Web)</>}
                </span>
                {activeSessionObj && (
                  <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[11px] font-semibold flex items-center gap-1">
                    <i className="fa-solid fa-message"></i> {activeSessionObj.title}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-2.5 py-1 text-xs text-white bg-white/10 hover:bg-white/15 rounded border border-white/10 flex items-center gap-1 cursor-pointer"
                  onClick={handleNewConversation}
                  title="Nueva conversación limpia"
                >
                  <i className="fa-solid fa-plus"></i> Nueva
                </button>
                <span className="text-zinc-400 text-xs">Gemma 4 12B</span>
              </div>
            </div>

            {/* Chat bubbles area */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4" id="chat-bubbles-view">
              {messages.length === 0 && !isTyping && (
                <div className="text-center my-auto text-zinc-400 text-sm p-6">
                  <i className="fa-solid fa-comments text-4xl mb-3 opacity-40 block text-amber-500"></i>
                  Haz cualquier pregunta. {searchMode === 'local' ? (selectedSourceIds.size > 0 ? `Consultando sobre ${selectedSourceIds.size} fuentes locales.` : 'Respondiendo con conocimiento crudo preentrenado (sin fuentes).') : 'El sistema buscará en la web en tiempo real.'}
                </div>
              )}

              {messages.map((msg, index) => (
                <div key={index} className={`flex gap-3 max-w-[90%] sm:max-w-[85%] ${msg.role === 'user' ? 'self-end flex-row-reverse' : 'self-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 text-xs">
                      <i className="fa-solid fa-brain"></i>
                    </div>
                  )}
                  
                  <div className={`p-4 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-amber-500/20 text-white border border-amber-500/30 rounded-tr-none'
                      : 'bg-white/[0.04] text-zinc-200 border border-white/10 rounded-tl-none w-full'
                  }`}>
                    {/* Glassbox Live Research Stream Card */}
                    {msg.role === 'assistant' && msg.search_logs && msg.search_logs.length > 0 && (
                      <div className="mb-3 p-3 rounded-lg bg-slate-950/80 border border-sky-500/30 text-xs">
                        <div className="font-semibold text-sky-400 mb-1 flex items-center gap-1.5">
                          <i className="fa-solid fa-terminal"></i> Rastreabilidad de Investigación Web en Vivo (Glassbox)
                        </div>
                        <div className="font-mono text-zinc-300 space-y-0.5 leading-relaxed">
                          {msg.search_logs.map((log, lIdx) => (
                            <div key={lIdx}>{log}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div 
                      className="prose prose-invert max-w-none space-y-2 text-zinc-200"
                      dangerouslySetInnerHTML={renderMarkdown(msg.content)}
                    ></div>
                    
                    {/* Real Web Source Badges */}
                    {msg.role === 'assistant' && msg.web_sources && msg.web_sources.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-white/10 flex flex-col gap-1.5">
                        <span className="text-xs font-semibold text-sky-400 flex items-center gap-1">
                          <i className="fa-solid fa-globe"></i> Fuentes Web Verificadas ({msg.web_sources.length}):
                        </span>
                        <div className="flex flex-col gap-1">
                          {msg.web_sources.map((wSrc, wIdx) => (
                            <div key={wIdx} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.03] border border-white/10 text-xs">
                              <a
                                href={wSrc.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sky-300 hover:underline truncate max-w-[75%]"
                              >
                                <i className="fa-solid fa-arrow-up-right-from-square mr-1 text-[10px]"></i>
                                [{wSrc.domain}] {wSrc.title}
                              </a>
                              <button
                                type="button"
                                className="px-2 py-0.5 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 rounded border border-emerald-500/20 flex items-center gap-1 cursor-pointer"
                                onClick={() => {
                                  setPromoteTargetUrl(wSrc.url);
                                  setPromoteProjectId('');
                                  setPromoteFolderId('');
                                }}
                                title="Guardar fuente web completa en Proyecto"
                              >
                                <i className="fa-solid fa-floppy-disk"></i> Guardar
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Clickable Citation Badges */}
                    {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-white/10 flex flex-col gap-2">
                        <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                          <i className="fa-solid fa-quote-left"></i> Citas de Fuentes ({msg.citations.length}):
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {msg.citations.map((c) => (
                            <button
                              key={c.num}
                              type="button"
                              className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-300 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-all"
                              onClick={() => setSelectedCitation(c)}
                            >
                              <span className="px-1.5 py-0.5 rounded bg-amber-500 text-zinc-950 font-bold text-[10px]">[{c.num}]</span>
                              <span className="truncate max-w-[190px]">{c.filename}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Save Fragment to Notebook Button */}
                    {msg.role === 'assistant' && (
                      <div className="mt-3 pt-2 border-t border-white/10 flex justify-end">
                        <button
                          type="button"
                          className="px-2.5 py-1 text-xs font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg border border-amber-500/25 flex items-center gap-1.5 cursor-pointer transition-colors"
                          onClick={async () => {
                            try {
                              const res = await fetch('/api/notes', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  title: `Fragmento Chat: ${msg.content.substring(0, 30)}...`,
                                  content: msg.content,
                                  source_type: 'chat_fragment'
                                })
                              });
                              if (res.ok) alert('¡Fragmento guardado con éxito en tu Cuaderno de Notas!');
                            } catch (e) {
                              alert('Error al guardar la nota en el cuaderno.');
                            }
                          }}
                          title="Guardar esta respuesta en tu Cuaderno de Notas"
                        >
                          <i className="fa-solid fa-bookmark text-amber-400"></i> Guardar en Cuaderno
                        </button>
                      </div>
                    )}

                    {/* Local Sources Accordion */}
                    {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-white/10">
                        <details 
                          open={!!openedSourcesIdx[index]} 
                          onToggle={() => toggleAccordion(index)}
                          className="text-xs"
                        >
                          <summary className="font-semibold text-amber-400 cursor-pointer outline-none flex items-center gap-1.5">
                            <i className={`fa-solid ${openedSourcesIdx[index] ? 'fa-folder-open' : 'fa-folder'}`}></i> Contexto RAG Local ({msg.sources.length} fragmentos extraídos)
                          </summary>
                          <ul className="mt-2 space-y-1.5 list-none pl-0 text-zinc-300">
                            {msg.sources.map((src, srcIdx) => {
                              const snippetText = typeof src === 'string' ? src : src.text;
                              return (
                                <li key={srcIdx} className="p-2 rounded bg-black/30 border border-white/5 text-[11px] leading-relaxed italic">
                                  {snippetText}
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="flex gap-3 max-w-[85%] self-start">
                  <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 text-xs">
                    <i className="fa-solid fa-brain"></i>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-white/[0.04] text-zinc-300 border border-white/10 text-xs flex items-center gap-2">
                    <i className="fa-solid fa-spinner fa-spin text-amber-400"></i> Gemma 4 investigando y sintetizando respuesta...
                  </div>
                </div>
              )}
              
              <div ref={chatBubblesEndRef} />
            </div>

            {/* Form input */}
            <form id="chat-form" className="flex items-center gap-2 border-t border-white/10 p-3 bg-black/30" onSubmit={handleSendMessage}>
              <input
                type="text"
                id="chat-message-input"
                placeholder={searchMode === 'web' ? 'Escribe tu consulta para investigar en la web en tiempo real...' : 'Escribe tu consulta sobre las fuentes seleccionadas...'}
                required
                autoComplete="off"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                className="flex-1 bg-white/[0.03] border border-white/10 rounded-lg text-white px-3.5 py-2.5 text-sm focus:outline-none focus:border-amber-500 transition-colors"
              />
              <button type="submit" className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold rounded-lg flex items-center justify-center transition-colors cursor-pointer" id="send-chat-btn">
                <i className="fa-solid fa-paper-plane"></i>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Modal: Confirm Chat Without Sources */}
      {showNoSourcesModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={handleRejectNoSources}>
          <div className="p-6 rounded-2xl bg-[#17171c] border border-amber-500/40 shadow-2xl max-w-md w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 text-lg shrink-0">
                <i className="fa-solid fa-triangle-exclamation"></i>
              </div>
              <h3 className="text-base font-semibold text-white">
                ¿Continuar sin fuentes seleccionadas?
              </h3>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Has elegido la opción <strong>Solo Fuentes Locales</strong>, pero no tienes ninguna fuente seleccionada.
              <br /><br />
              El modelo responderá utilizando únicamente su <strong>conocimiento general preentrenado (Gemma 4 12B)</strong>, sin consultar ningún documento.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                className="px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white font-medium cursor-pointer transition-colors"
                onClick={handleRejectNoSources}
              >
                Seleccionar Fuentes Primero
              </button>
              <button
                type="button"
                className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-zinc-950 font-semibold text-xs cursor-pointer shadow-md shadow-amber-500/20 transition-all"
                onClick={handleAcceptNoSources}
              >
                Continuar con Conocimiento Crudo
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Export Chat Session Payload */}
      {showExportModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowExportModal(false)}>
          <div className="p-6 rounded-2xl bg-[#17171c] border border-sky-500/40 shadow-2xl max-w-md w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h3 className="text-base font-semibold text-sky-400 flex items-center gap-2">
                <i className="fa-solid fa-file-export"></i> Exportar Conversación
              </h3>
              <button className="text-zinc-400 hover:text-white text-xs cursor-pointer" onClick={() => setShowExportModal(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Puedes descargar el payload JSON completo de la conversación activa o copiarlo al portapapeles para respaldarlo.
            </p>

            <div className="flex flex-col gap-2.5 pt-2">
              <button
                type="button"
                className="w-full py-2.5 px-4 bg-sky-500 hover:bg-sky-400 text-zinc-950 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
                onClick={handleDownloadExportJson}
              >
                <i className="fa-solid fa-download"></i> 1. Descargar Archivo JSON
              </button>

              <button
                type="button"
                className="w-full py-2.5 px-4 bg-white/10 hover:bg-white/15 text-white font-medium text-xs rounded-xl flex items-center justify-center gap-2 border border-white/10 transition-colors cursor-pointer"
                onClick={handleCopyExportClipboard}
              >
                {copiedSuccess ? (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1"><i className="fa-solid fa-check"></i> ¡Copiado al Portapapeles!</span>
                ) : (
                  <><i className="fa-solid fa-copy"></i> 2. Copiar Payload al Portapapeles</>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Import Chat Session Payload */}
      {showImportModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowImportModal(false)}>
          <div className="p-6 rounded-2xl bg-[#17171c] border border-emerald-500/40 shadow-2xl max-w-lg w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h3 className="text-base font-semibold text-emerald-400 flex items-center gap-2">
                <i className="fa-solid fa-file-import"></i> Importar Conversación desde JSON
              </h3>
              <button className="text-zinc-400 hover:text-white text-xs cursor-pointer" onClick={() => setShowImportModal(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Carga un archivo `.json` exportado previamente o pega el texto del payload JSON.
            </p>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-300">Seleccionar Archivo JSON:</label>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportJsonFile}
                  className="text-xs text-zinc-400"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-300">O Pegar Payload JSON Directamente:</label>
                <textarea
                  rows={5}
                  placeholder='Pega aquí el JSON exportado...'
                  value={importJsonText}
                  onChange={e => setImportJsonText(e.target.value)}
                  className="w-full font-mono text-xs p-2.5 bg-black/40 border border-white/10 rounded-lg text-emerald-300 focus:outline-none focus:border-emerald-500"
                ></textarea>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" className="px-3.5 py-2 rounded-lg bg-white/10 text-white text-xs font-medium cursor-pointer" disabled={isImporting} onClick={() => setShowImportModal(false)}>Cancelar</button>
                <button type="button" className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer transition-colors" disabled={isImporting} onClick={handleExecuteImport}>
                  {isImporting ? <><i className="fa-solid fa-spinner fa-spin"></i> Importando...</> : <><i className="fa-solid fa-check"></i> Importar Conversación</>}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Promote Web Source */}
      {promoteTargetUrl && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPromoteTargetUrl(null)}>
          <div className="p-6 rounded-2xl bg-[#17171c] border border-emerald-500/40 shadow-2xl max-w-md w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-floppy-disk text-emerald-400"></i> Guardar Fuente Web Completa
            </h3>
            <p className="text-xs text-zinc-300 break-all leading-relaxed">
              Se extraerá la página completa para guardarla en:
              <br /><strong className="text-sky-400">{promoteTargetUrl}</strong>
            </p>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-300">Proyecto Destino</label>
                <select
                  className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white p-2.5 text-xs"
                  value={promoteProjectId}
                  onChange={e => {
                    setPromoteProjectId(e.target.value ? Number(e.target.value) : '');
                    setPromoteFolderId('');
                  }}
                >
                  <option value="">-- Sin Proyecto (Fuentes Generales) --</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {promoteProjectId !== '' && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-zinc-300">Carpeta Destino (Opcional)</label>
                  <select
                    className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white p-2.5 text-xs"
                    value={promoteFolderId}
                    onChange={e => setPromoteFolderId(e.target.value ? Number(e.target.value) : '')}
                  >
                    <option value="">-- Raíz del Proyecto --</option>
                    {folders
                      .filter(f => f.project_id === Number(promoteProjectId))
                      .map(f => (
                        <option key={f.id} value={f.id}>{f.parent_id ? '  ↳ ' : ''}{f.name}</option>
                      ))}
                  </select>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" className="px-3.5 py-2 rounded-lg bg-white/10 text-white text-xs font-medium cursor-pointer" disabled={isPromoting} onClick={() => setPromoteTargetUrl(null)}>Cancelar</button>
                <button type="button" className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer transition-colors" disabled={isPromoting} onClick={handlePromoteWebSource}>
                  {isPromoting ? <><i className="fa-solid fa-spinner fa-spin"></i> Guardando...</> : <><i className="fa-solid fa-check"></i> Guardar en Proyecto</>}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Conversations History Drawer */}
      {showSessionsPanel && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowSessionsPanel(false)}>
          <div className="p-6 rounded-2xl bg-[#17171c] border border-amber-500/40 shadow-2xl max-w-lg w-full max-h-[550px] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
              <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-2">
                <i className="fa-solid fa-clock-rotate-left"></i> Historial de Conversaciones Guardadas
              </h3>
              <button 
                type="button" 
                className="text-xs text-zinc-400 hover:text-white px-2 py-1 bg-white/5 rounded cursor-pointer" 
                onClick={() => setShowSessionsPanel(false)}
              >
                <i className="fa-solid fa-xmark"></i> Cerrar
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {sessions.length === 0 ? (
                <div className="text-xs text-zinc-500 text-center py-8">
                  No hay conversaciones guardadas.
                </div>
              ) : (
                sessions.map(s => (
                  <div
                    key={s.id}
                    onClick={() => handleSelectSession(s)}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors cursor-pointer ${
                      activeSessionId === s.id
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                        : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04] text-white'
                    }`}
                  >
                    <div className="min-w-0 flex-1 mr-3">
                      <div className="text-xs font-semibold truncate">
                        {s.title}
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">
                        {formatDate(s.created_at)} · {s.message_count || 0} mensajes
                      </div>
                    </div>

                    <button
                      type="button"
                      title="Borrar conversación"
                      onClick={(e) => handleDeleteSession(s.id, e)}
                      className="p-1.5 rounded text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-xs shrink-0 cursor-pointer transition-colors"
                    >
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Citation Inspection Modal */}
      {selectedCitation && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedCitation(null)}>
          <div className="p-6 rounded-2xl bg-[#17171c] border border-amber-500/40 shadow-2xl max-w-2xl w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-amber-500 text-zinc-950 font-bold text-xs">[{selectedCitation.num}]</span>
                {selectedCitation.filename}
              </h3>
              <button type="button" className="text-zinc-400 hover:text-white text-lg cursor-pointer" onClick={() => setSelectedCitation(null)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-amber-400 flex items-center gap-1">
                <i className="fa-solid fa-puzzle-piece"></i> Fragmento Vectorial Citado:
              </span>
              <div className="p-4 bg-black/50 rounded-xl border border-white/10 font-mono text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap max-h-[350px] overflow-y-auto shadow-inner">
                "{selectedCitation.full_text}"
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-zinc-400 pt-2 border-t border-white/10">
              <span>Fuente Local RAG #{selectedCitation.source_id}</span>
              <button
                type="button"
                className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold cursor-pointer transition-colors flex items-center gap-1.5"
                onClick={() => {
                  const sourceId = selectedCitation.source_id;
                  setSelectedCitation(null);
                  if (setActiveId && sourceId > 0) setActiveId(sourceId);
                }}
              >
                <i className="fa-solid fa-eye"></i> Ver Fuente Original en Fuentes
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
