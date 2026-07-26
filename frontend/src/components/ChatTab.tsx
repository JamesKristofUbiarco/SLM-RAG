import React, { useState, useEffect, useRef, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Marked } from 'marked';
import { Transcription, Message, Project, Folder, ChatSession, WebSource } from '../types';
import FolderTree from './FolderTree';

const marked = new Marked();

interface ChatTabProps {
  transcriptionList: Transcription[];
  activeId: number | null;
  setActiveId?: (id: number) => void;
  active: boolean;
}

export default function ChatTab({ transcriptionList, activeId, setActiveId, active }: ChatTabProps) {
  // Multi-source selection state (NotebookLM style)
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

  // Sync activeId from parent or auto-select all available sources by default
  useEffect(() => {
    if (selectedSourceIds.size === 0 && transcriptionList.length > 0) {
      if (activeId) {
        setSelectedSourceIds(new Set([activeId]));
      } else {
        setSelectedSourceIds(new Set(transcriptionList.map(s => s.id)));
      }
    }
  }, [activeId, transcriptionList]);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    chatBubblesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Load chat history for active session or active sources
  const loadChatHistoryForSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/chat/history?session_id=${encodeURIComponent(sessionId)}`);
      if (!res.ok) return;
      const data = await res.json();

      const mapped = data.map((item: any): Message => {
        let sources = null;
        if (item.context_sources) {
          try {
            sources = typeof item.context_sources === 'string' 
              ? JSON.parse(item.context_sources) 
              : item.context_sources;
          } catch (e) {
            sources = item.context_sources;
          }
        }
        return {
          role: item.role,
          content: item.text,
          sources: Array.isArray(sources) ? sources : null
        };
      });
      setMessages(mapped);
    } catch (err) {
      console.error('Error loading session chat history:', err);
    }
  };

  // Switch to a past conversation session
  const handleSelectSession = (session: ChatSession) => {
    setActiveSessionId(session.id);
    setIsNoSourcesConfirmed(false);
    
    if (session.context_sources) {
      const ids = session.context_sources.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      if (ids.length > 0) {
        setSelectedSourceIds(new Set(ids));
      }
    }
    
    loadChatHistoryForSession(session.id);
    setShowSessionsPanel(false);
  };

  // Start a new empty conversation
  const handleNewConversation = () => {
    setActiveSessionId(null);
    setMessages([]);
    setIsNoSourcesConfirmed(false);
    setShowSessionsPanel(false);
  };

  // Delete a chat session
  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('¿Estás seguro de que deseas eliminar esta conversación del historial?')) return;

    try {
      const res = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      if (res.ok) {
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
          setMessages([]);
          setIsNoSourcesConfirmed(false);
        }
        await fetchChatSessions();
      }
    } catch (err) {
      console.error('Error deleting session:', err);
    }
  };

  // Promote web source to permanent project/folder in SQLite
  const handlePromoteWebSource = async () => {
    if (!promoteTargetUrl) return;
    setIsPromoting(true);

    try {
      const res = await fetch('/api/web/promote_to_source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: promoteTargetUrl,
          project_id: promoteProjectId !== '' ? Number(promoteProjectId) : null,
          folder_id: promoteFolderId !== '' ? Number(promoteFolderId) : null
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Fallo al guardar fuente web');
      }

      const data = await res.json();
      alert(data.message || 'Fuente web guardada exitosamente en el proyecto.');
      setPromoteTargetUrl(null);
      await fetchProjectsAndFolders();
    } catch (err: any) {
      console.error(err);
      alert(`Error al guardar fuente web: ${err.message}`);
    } finally {
      setIsPromoting(false);
    }
  };

  // Export Chat Payload Helpers
  const activeSessionObj = sessions.find(s => s.id === activeSessionId);

  const buildExportPayload = () => {
    return {
      version: "1.0",
      title: activeSessionObj ? activeSessionObj.title : "Conversación Exportada",
      context_sources: activeSessionObj ? (activeSessionObj.context_sources || "") : "",
      created_at: activeSessionObj ? activeSessionObj.created_at : new Date().toISOString(),
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      }))
    };
  };

  const handleDownloadExportJson = () => {
    const payload = buildExportPayload();
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = (payload.title || 'chat').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    a.download = `chat_${safeTitle}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyExportClipboard = () => {
    const payload = buildExportPayload();
    const jsonStr = JSON.stringify(payload, null, 2);
    navigator.clipboard.writeText(jsonStr);
    setCopiedSuccess(true);
    setTimeout(() => setCopiedSuccess(false), 2000);
  };

  const handleImportJsonFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (text) setImportJsonText(text);
    };
    reader.readAsText(file);
  };

  const handleExecuteImport = async () => {
    if (!importJsonText.trim()) {
      alert('Por favor pega un payload JSON o selecciona un archivo JSON válido.');
      return;
    }

    let parsedPayload: any = null;
    try {
      parsedPayload = JSON.parse(importJsonText.trim());
    } catch (err) {
      alert('El texto proporcionado no es un JSON válido.');
      return;
    }

    if (!parsedPayload.messages || !Array.isArray(parsedPayload.messages) || parsedPayload.messages.length === 0) {
      alert('El payload JSON debe contener un arreglo "messages" no vacío.');
      return;
    }

    setIsImporting(true);
    try {
      const res = await fetch('/api/chat/sessions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedPayload)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Fallo al importar la conversación.');
      }

      const data = await res.json();
      alert(`Conversación '${data.title}' importada con éxito (${data.message_count} mensajes).`);
      
      setShowImportModal(false);
      setImportJsonText('');

      // Refresh sessions and activate newly imported session
      await fetchChatSessions();
      setActiveSessionId(data.session_id);
      await loadChatHistoryForSession(data.session_id);
    } catch (err: any) {
      console.error(err);
      alert(`Error al importar conversación: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  // Toggle single source
  const handleToggleSource = (id: number) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Toggle folder cascade
  const handleToggleFolder = (folderId: number, childSourceIds: number[], childFolderIds: number[], forceState?: boolean) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (forceState) {
        childSourceIds.forEach(id => next.add(id));
      } else {
        childSourceIds.forEach(id => next.delete(id));
      }
      return next;
    });
  };

  // Toggle project cascade
  const handleToggleProject = (projectId: number | null, childSourceIds: number[], forceState?: boolean) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (forceState) {
        childSourceIds.forEach(id => next.add(id));
      } else {
        childSourceIds.forEach(id => next.delete(id));
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const all = transcriptionList.map(t => t.id);
    setSelectedSourceIds(new Set(all));
  };

  const handleDeselectAll = () => {
    setSelectedSourceIds(new Set());
  };

  // Core API submit function
  const submitChatMessage = async (msgText: string) => {
    setInputVal('');
    // Optimistic user message update
    setMessages((prev) => [...prev, { role: 'user', content: msgText }]);
    setIsTyping(true);

    try {
      const idsStr = Array.from(selectedSourceIds).join(',');
      const formData = new FormData();
      if (activeSessionId) {
        formData.append('session_id', activeSessionId);
      }
      formData.append('transcription_ids', idsStr);
      formData.append('message', msgText);
      formData.append('search_mode', searchMode);
      formData.append('search_depth', searchDepth);
      if (timeFilter) formData.append('time_filter', timeFilter);
      if (domainFilter) formData.append('domain_filter', domainFilter);
      formData.append('similarity_threshold', similarityThreshold.toString());

      const res = await fetch('/api/chat', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error('Error al conectar con la API.');
      const data = await res.json();

      if (data.session_id && data.session_id !== activeSessionId) {
        setActiveSessionId(data.session_id);
      }

      setMessages((prev) => [
        ...prev, 
        { 
          role: 'assistant', 
          content: data.response, 
          sources: data.context_sources,
          web_sources: data.web_sources,
          search_logs: data.search_logs
        }
      ]);

      await fetchChatSessions();
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev, 
        { 
          role: 'assistant', 
          content: 'Error: No se pudo obtener respuesta del modelo local.' 
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    const cleanMsg = inputVal.trim();
    if (!cleanMsg) return;

    // Check if in Local mode without sources selected and warning not yet confirmed
    if (searchMode === 'local' && selectedSourceIds.size === 0 && !isNoSourcesConfirmed) {
      setPendingMessage(cleanMsg);
      setShowNoSourcesModal(true);
      return;
    }

    await submitChatMessage(cleanMsg);
  };

  // Accept modal warning: set confirmed flag and submit pending message
  const handleAcceptNoSources = async () => {
    setIsNoSourcesConfirmed(true);
    setShowNoSourcesModal(false);
    const msg = pendingMessage;
    setPendingMessage('');
    if (msg) {
      await submitChatMessage(msg);
    }
  };

  // Reject modal warning: close modal without setting confirmed flag
  const handleRejectNoSources = () => {
    setShowNoSourcesModal(false);
    setPendingMessage('');
  };

  const toggleAccordion = (msgIdx: number) => {
    setOpenedSourcesIdx((prev) => ({
      ...prev,
      [msgIdx]: !prev[msgIdx]
    }));
  };

  const renderMarkdown = (text?: string) => {
    if (!text) return { __html: '' };
    return { __html: marked.parse(text) as string };
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const dateObj = new Date(dateStr.replace(' ', 'T'));
      return dateObj.toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <section id="chat-tab" className={`tab-panel ${active ? 'active' : ''}`}>
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2>Chat Multi-Fuente y Búsqueda Web Agentica</h2>
          <p>Consulta tus documentos locales o investiga en la web en tiempo real con transparencia total e inspección RAG.</p>
        </div>

        {/* Global Chat Toolbar */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="submit-btn btn-sm"
            onClick={handleNewConversation}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
          >
            <i className="fa-solid fa-plus"></i> Nueva Conversación
          </button>

          <button
            type="button"
            className={`btn btn-sm ${showSessionsPanel ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowSessionsPanel(!showSessionsPanel)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
          >
            <i className="fa-solid fa-clock-rotate-left"></i> Historial ({sessions.length})
          </button>

          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setShowExportModal(true)}
            disabled={messages.length === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: messages.length === 0 ? 'not-allowed' : 'pointer' }}
            title="Exportar payload completo del chat"
          >
            <i className="fa-solid fa-file-export" style={{ color: '#38bdf8' }}></i> Exportar
          </button>

          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setShowImportModal(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
            title="Importar conversación desde JSON"
          >
            <i className="fa-solid fa-file-import" style={{ color: '#10b981' }}></i> Importar
          </button>

          <button
            type="button"
            className={`btn btn-sm ${showSearchSettings ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowSearchSettings(!showSearchSettings)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
            title="Ajustes de Búsqueda y Parámetros RAG"
          >
            <i className="fa-solid fa-sliders"></i> Ajustes Web
          </button>
        </div>
      </div>

      {/* Mode Selector Pill Bar */}
      <div className="tab-toggle" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className={`toggle-btn ${searchMode === 'local' ? 'active' : ''}`}
          onClick={() => setSearchMode('local')}
        >
          <i className="fa-solid fa-folder-open" style={{ color: 'var(--primary)' }}></i> 1. Solo Fuentes Locales ({selectedSourceIds.size})
        </button>
        <button
          type="button"
          className={`toggle-btn ${searchMode === 'web' ? 'active' : ''}`}
          onClick={() => setSearchMode('web')}
        >
          <i className="fa-solid fa-globe" style={{ color: 'var(--primary)' }}></i> 2. Búsqueda Web Agentica
        </button>
        <button
          type="button"
          className={`toggle-btn ${searchMode === 'hybrid' ? 'active' : ''}`}
          onClick={() => setSearchMode('hybrid')}
        >
          <i className="fa-solid fa-dna" style={{ color: 'var(--accent)' }}></i> 3. Híbrido (Locales + Web)
        </button>
      </div>

      {/* Advanced Search Parameters Panel */}
      {showSearchSettings && (
        <div className="card glass-card" style={{ marginBottom: '1.25rem', padding: '1.25rem', border: '1px solid var(--border-amber)', background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <i className="fa-solid fa-sliders"></i> Controles de Búsqueda Web y Precisión RAG
            </h4>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowSearchSettings(false)} style={{ fontSize: '0.7rem' }}>Cerrar</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.78125rem' }}>Profundidad de Búsqueda</label>
              <select
                className="form-control"
                value={searchDepth}
                onChange={e => setSearchDepth(e.target.value as 'quick' | 'deep')}
                style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', background: 'rgba(255,255,255,0.03)' }}
              >
                <option value="quick">⚡ Rápida (3 URLs / Top 4 chunks)</option>
                <option value="deep">🔬 Profunda (6 URLs / Top 10 chunks)</option>
              </select>
            </div>

            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.78125rem' }}>Filtro Temporal</label>
              <select
                className="form-control"
                value={timeFilter}
                onChange={e => setTimeFilter(e.target.value)}
                style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', background: 'rgba(255,255,255,0.03)' }}
              >
                <option value="">Cualquier momento</option>
                <option value="day">Últimas 24 horas</option>
                <option value="week">Última semana</option>
                <option value="month">Último mes</option>
                <option value="year">Último año</option>
              </select>
            </div>

            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.78125rem' }}>Filtro de Dominios (Opcional)</label>
              <input
                type="text"
                className="form-control"
                placeholder="Ej. arxiv.org, github.com"
                value={domainFilter}
                onChange={e => setDomainFilter(e.target.value)}
                style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.8125rem', background: 'rgba(255,255,255,0.03)' }}
              />
            </div>

            <div>
              <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.78125rem' }}>
                Umbral de Similitud Vectorial ({Math.round(similarityThreshold * 100)}%)
              </label>
              <input
                type="range"
                min="0.30"
                max="0.85"
                step="0.05"
                value={similarityThreshold}
                onChange={e => setSimilarityThreshold(parseFloat(e.target.value))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Main Layout Grid */}
      <div className="grid-2col" style={{ display: 'grid', gridTemplateColumns: (showSelectorCard && searchMode !== 'web') ? '340px 1fr' : '1fr', gap: '1.25rem', alignItems: 'start' }}>
        
        {/* Left Side: Multi-Source Selector Panel (Only if not Web-Only mode) */}
        {showSelectorCard && searchMode !== 'web' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            
            {/* Conversations History Drawer */}
            {showSessionsPanel && (
              <div className="card glass-card" style={{ maxHeight: '350px', display: 'flex', flexDirection: 'column', border: '1px solid rgba(168,85,247,0.3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.9rem', color: '#c084fc' }}>
                    <i className="fa-solid fa-clock-rotate-left"></i> Historial de Chats
                  </h3>
                  <button 
                    type="button" 
                    className="btn btn-sm btn-secondary" 
                    onClick={() => setShowSessionsPanel(false)}
                    style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
                  >
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                </div>

                <div style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {sessions.length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center', padding: '1rem' }}>
                      No hay conversaciones guardadas.
                    </div>
                  ) : (
                    sessions.map(s => (
                      <div
                        key={s.id}
                        onClick={() => handleSelectSession(s)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.4rem 0.6rem',
                          borderRadius: '0.375rem',
                          background: activeSessionId === s.id ? 'rgba(168, 85, 247, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                          border: activeSessionId === s.id ? '1px solid #a855f7' : '1px solid var(--border-glass)',
                          cursor: 'pointer'
                        }}
                      >
                        <div style={{ overflow: 'hidden', paddingRight: '0.5rem' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: activeSessionId === s.id ? '#fff' : '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.title}
                          </div>
                          <div style={{ fontSize: '0.6875rem', color: '#64748b' }}>
                            {formatDate(s.created_at)} · {s.message_count || 0} msgs
                          </div>
                        </div>

                        <button
                          type="button"
                          title="Borrar conversación"
                          onClick={(e) => handleDeleteSession(s.id, e)}
                          style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.2rem 0.4rem', fontSize: '0.75rem', flexShrink: 0 }}
                        >
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* FolderTree Selector Card */}
            <div className="card glass-card" style={{ minHeight: '480px', height: 'calc(100vh - 300px)', display: 'flex', flexDirection: 'column', borderRadius: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
                  <i className="fa-solid fa-layer-group" style={{ color: 'var(--primary)', marginRight: '0.4rem' }}></i>
                  Fuentes Locales del Chat
                </h3>
                <button 
                  type="button" 
                  className="btn btn-sm btn-secondary"
                  onClick={() => setShowSelectorCard(false)}
                  title="Ocultar selector"
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}
                >
                  <i className="fa-solid fa-chevron-left"></i>
                </button>
              </div>

              <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '0.25rem' }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
          
          <div className="card glass-card chat-card" id="chat-container-card" style={{ display: 'flex', flexDirection: 'column', minHeight: '480px', height: 'calc(100vh - 300px)', borderRadius: '12px' }}>
            
            {/* Active Session & Search Mode Badge Bar */}
            <div style={{ padding: '0.55rem 0.875rem', borderBottom: '1px solid var(--border-glass)', background: 'rgba(99, 102, 241, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8125rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--primary)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  {searchMode === 'local' && (
                    <><i className="fa-solid fa-folder-open" style={{ color: 'var(--primary)' }}></i> RAG Local ({selectedSourceIds.size > 0 ? `${selectedSourceIds.size} fuentes` : 'Sin fuentes - Conocimiento Crudo'})</>
                  )}
                  {searchMode === 'web' && <><i className="fa-solid fa-globe" style={{ color: 'var(--primary)' }}></i> RAG Web Agentico</>}
                  {searchMode === 'hybrid' && <><i className="fa-solid fa-dna" style={{ color: 'var(--accent)' }}></i> RAG Híbrido (Locales + Web)</>}
                </span>
                {activeSessionObj && (
                  <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--primary)', padding: '0.15rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 600 }}>
                    <i className="fa-solid fa-message"></i> {activeSessionObj.title}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={handleNewConversation}
                  style={{ fontSize: '0.72rem', padding: '0.15rem 0.4rem' }}
                  title="Nueva conversación limpia"
                >
                  <i className="fa-solid fa-plus"></i> Nueva
                </button>
                <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                  Gemma 4 12B
                </span>
              </div>
            </div>

            {/* Chat bubbles area */}
            <div className="chat-bubbles-view" id="chat-bubbles-view" style={{ flexGrow: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {messages.length === 0 && !isTyping && (
                <div style={{ textAlign: 'center', margin: 'auto', color: 'hsl(var(--text-muted))', fontSize: '0.875rem' }}>
                  <i className="fa-solid fa-comments" style={{ fontSize: '2.5rem', marginBottom: '1rem', opacity: '0.4', display: 'block' }}></i>
                  Haz cualquier pregunta. {searchMode === 'local' ? (selectedSourceIds.size > 0 ? `Consultando sobre ${selectedSourceIds.size} fuentes locales.` : 'Respondiendo con conocimiento crudo preentrenado (sin fuentes).') : 'El sistema buscará en la web en tiempo real.'}
                </div>
              )}

              {messages.map((msg, index) => (
                <div key={index} className={`chat-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                  {msg.role === 'assistant' && (
                    <div className="assistant-avatar">
                      <i className="fa-solid fa-brain"></i>
                    </div>
                  )}
                  
                  <div className="bubble-content" style={{ width: '100%' }}>
                    {/* Glassbox Live Research Stream Card */}
                    {msg.role === 'assistant' && msg.search_logs && msg.search_logs.length > 0 && (
                      <div style={{ marginBottom: '0.875rem', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '0.5rem', padding: '0.625rem 0.875rem', fontSize: '0.75rem' }}>
                        <div style={{ fontWeight: 600, color: '#38bdf8', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <i className="fa-solid fa-terminal"></i> Rastreabilidad de Investigación Web en Vivo (Glassbox)
                        </div>
                        <div style={{ fontFamily: 'monospace', color: '#cbd5e1', lineHeight: 1.5 }}>
                          {msg.search_logs.map((log, lIdx) => (
                            <div key={lIdx}>{log}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div 
                      className="bubble-text"
                      dangerouslySetInnerHTML={renderMarkdown(msg.content)}
                    ></div>
                    
                    {/* Real Web Source Badges with Promote Button */}
                    {msg.role === 'assistant' && msg.web_sources && msg.web_sources.length > 0 && (
                      <div style={{ marginTop: '0.875rem', borderTop: '1px solid var(--border-glass)', paddingTop: '0.625rem' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#38bdf8', display: 'block', marginBottom: '0.4rem' }}>
                          <i className="fa-solid fa-globe"></i> Fuentes Web Verificadas ({msg.web_sources.length}):
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          {msg.web_sources.map((wSrc, wIdx) => (
                            <div key={wIdx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.03)', padding: '0.35rem 0.6rem', borderRadius: '0.375rem', border: '1px solid var(--border-glass)', fontSize: '0.75rem' }}>
                              <a
                                href={wSrc.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#93c5fd', textDecoration: 'none', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}
                              >
                                <i className="fa-solid fa-arrow-up-right-from-square" style={{ marginRight: '0.35rem', fontSize: '0.6875rem' }}></i>
                                [{wSrc.domain}] {wSrc.title}
                              </a>
                              <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                onClick={() => {
                                  setPromoteTargetUrl(wSrc.url);
                                  setPromoteProjectId('');
                                  setPromoteFolderId('');
                                }}
                                style={{ fontSize: '0.6875rem', padding: '0.15rem 0.4rem' }}
                                title="Guardar fuente web completa en Proyecto"
                              >
                                <i className="fa-solid fa-floppy-disk" style={{ color: '#10b981' }}></i> Guardar
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Local Sources Accordion */}
                    {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                      <div className="sources-container" style={{ marginTop: '0.75rem' }}>
                        <details 
                          open={!!openedSourcesIdx[index]} 
                          onToggle={() => toggleAccordion(index)}
                          className="sources-details"
                        >
                          <summary style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-light)', cursor: 'pointer', outline: 'none' }}>
                            <i className={`fa-solid ${openedSourcesIdx[index] ? 'fa-folder-open' : 'fa-folder'}`}></i> Contexto RAG Local ({msg.sources.length} fragmentos extraídos)
                          </summary>
                          <ul style={{ listStyleType: 'none', margin: '0.5rem 0 0 0', padding: 0, fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                            {msg.sources.map((src, srcIdx) => {
                              const snippetText = typeof src === 'string' ? src : src.text;
                              return (
                                <li key={srcIdx} style={{ padding: '0.35rem 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                  <span style={{ fontStyle: 'italic', display: 'block', paddingLeft: '0.5rem', marginTop: '0.125rem', whiteSpace: 'pre-wrap', color: '#cbd5e1' }}>
                                    {snippetText}
                                  </span>
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
                <div className="chat-bubble assistant typing-bubble">
                  <div className="assistant-avatar">
                    <i className="fa-solid fa-brain"></i>
                  </div>
                  <div className="bubble-content">
                    <i className="fa-solid fa-ellipsis fa-fade"></i> Gemma 4 investigando y sintetizando respuesta...
                  </div>
                </div>
              )}
              
              <div ref={chatBubblesEndRef} />
            </div>

            {/* Form input */}
            <form id="chat-form" className="chat-input-wrapper" onSubmit={handleSendMessage} style={{ display: 'flex', borderTop: '1px solid var(--border-glass)', padding: '0.75rem' }}>
              <input
                type="text"
                id="chat-message-input"
                placeholder={searchMode === 'web' ? 'Escribe tu consulta para investigar en la web en tiempo real...' : 'Escribe tu consulta sobre las fuentes seleccionadas...'}
                required
                autoComplete="off"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                style={{ flexGrow: 1, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', borderRadius: '0.5rem', color: '#fff', padding: '0.625rem 0.875rem', fontSize: '0.875rem', outline: 'none' }}
              />
              <button type="submit" className="send-btn" id="send-chat-btn" style={{ marginLeft: '0.5rem', background: 'var(--accent-light)', border: 'none', borderRadius: '0.5rem', width: '2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer' }}>
                <i className="fa-solid fa-paper-plane"></i>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* ── Modal: Confirm Chat Without Sources (Portal) ── */}
      {showNoSourcesModal && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={handleRejectNoSources}>
          <div className="card glass-card" style={{ width: '100%', maxWidth: '480px', padding: '1.75rem', border: '1px solid rgba(245, 158, 11, 0.4)', boxShadow: '0 1rem 3rem rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '50%', backgroundColor: 'rgba(245, 158, 11, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="fa-solid fa-triangle-exclamation" style={{ color: '#f59e0b', fontSize: '1.3rem' }}></i>
              </div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc' }}>
                ¿Continuar sin fuentes seleccionadas?
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: '0.875rem', color: '#cbd5e1', lineHeight: '1.5' }}>
              Has elegido la opción <strong>Solo Fuentes Locales</strong>, pero no tienes ninguna fuente ni carpeta seleccionada en el panel izquierdo.
              <br /><br />
              El modelo responderá utilizando únicamente su <strong>conocimiento general preentrenado (Gemma 4 12B)</strong>, sin consultar ningún documento ni buscar en la web.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleRejectNoSources}
              >
                Seleccionar Fuentes Primero
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAcceptNoSources}
                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', color: '#fff' }}
              >
                Continuar con Conocimiento Crudo
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Modal: Export Chat Session Payload (Portal) ── */}
      {showExportModal && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={() => setShowExportModal(false)}>
          <div className="card glass-card" style={{ width: '100%', maxWidth: '520px', padding: '1.75rem', border: '1px solid rgba(56,189,248,0.4)', boxShadow: '0 1rem 3rem rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <i className="fa-solid fa-file-export"></i> Exportar Conversación
              </h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowExportModal(false)} style={{ fontSize: '0.75rem' }}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <p style={{ fontSize: '0.875rem', color: '#cbd5e1', lineHeight: '1.5', marginBottom: '1.25rem' }}>
              Puedes descargar el payload JSON completo de la conversación activa o copiarlo al portapapeles para transferirlo o respaldarlo.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleDownloadExportJson}
                style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontWeight: 600 }}
              >
                <i className="fa-solid fa-download"></i> 1. Descargar Archivo JSON
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCopyExportClipboard}
                style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontWeight: 600 }}
              >
                {copiedSuccess ? (
                  <span style={{ color: '#10b981' }}><i className="fa-solid fa-check"></i> ¡Copiado al Portapapeles!</span>
                ) : (
                  <>
                    <i className="fa-solid fa-copy"></i> 2. Copiar Payload al Portapapeles
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Modal: Import Chat Session Payload (Portal) ── */}
      {showImportModal && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={() => setShowImportModal(false)}>
          <div className="card glass-card" style={{ width: '100%', maxWidth: '540px', padding: '1.75rem', border: '1px solid rgba(16,185,129,0.4)', boxShadow: '0 1rem 3rem rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <i className="fa-solid fa-file-import"></i> Importar Conversación desde JSON
              </h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowImportModal(false)} style={{ fontSize: '0.75rem' }}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: '1.4', marginBottom: '1rem' }}>
              Carga un archivo `.json` exportado previamente o pega el texto del payload JSON. Se registrará como una conversación nativa en tu historial.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.78125rem' }}>
                  Seleccionar Archivo JSON:
                </label>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportJsonFile}
                  style={{ width: '100%', fontSize: '0.8125rem', color: '#cbd5e1' }}
                />
              </div>

              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.78125rem' }}>
                  O Pegar Payload JSON Directamente:
                </label>
                <textarea
                  className="form-control"
                  rows={6}
                  placeholder='Pega aquí el JSON exportado...'
                  value={importJsonText}
                  onChange={e => setImportJsonText(e.target.value)}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem', padding: '0.5rem', background: 'rgba(0,0,0,0.4)', color: '#a7f3d0' }}
                ></textarea>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" disabled={isImporting} onClick={() => setShowImportModal(false)}>Cancelar</button>
                <button type="button" className="btn btn-primary" disabled={isImporting} onClick={handleExecuteImport} style={{ background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', color: '#fff' }}>
                  {isImporting ? <><i className="fa-solid fa-spinner fa-spin"></i> Importando...</> : <><i className="fa-solid fa-check"></i> Importar Conversación</>}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Modal: Promote Web Source to Permanent Project/Folder (Portal) ── */}
      {promoteTargetUrl && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={() => setPromoteTargetUrl(null)}>
          <div className="card glass-card" style={{ width: '100%', maxWidth: '460px', padding: '1.75rem', border: '1px solid rgba(16,185,129,0.4)', boxShadow: '0 1rem 3rem rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <i className="fa-solid fa-floppy-disk" style={{ color: '#10b981' }}></i> Guardar Fuente Web Completa
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#cbd5e1', marginTop: '0.35rem', wordBreak: 'break-all' }}>
              Se extraerá la página completa con Docling para guardarla permanentemente en:
              <br /><strong style={{ color: '#38bdf8' }}>{promoteTargetUrl}</strong>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem' }}>Proyecto Destino</label>
                <select
                  className="form-control"
                  value={promoteProjectId}
                  onChange={e => {
                    setPromoteProjectId(e.target.value ? Number(e.target.value) : '');
                    setPromoteFolderId('');
                  }}
                  style={{ width: '100%', padding: '0.625rem 0.75rem', background: 'rgba(20,24,38,0.95)', border: '1px solid var(--border-glass)', borderRadius: '0.375rem', color: '#fff' }}
                >
                  <option value="">-- Sin Proyecto (Fuentes Generales) --</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {promoteProjectId !== '' && (
                <div>
                  <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem' }}>Carpeta Destino (Opcional)</label>
                  <select
                    className="form-control"
                    value={promoteFolderId}
                    onChange={e => setPromoteFolderId(e.target.value ? Number(e.target.value) : '')}
                    style={{ width: '100%', padding: '0.625rem 0.75rem', background: 'rgba(20,24,38,0.95)', border: '1px solid var(--border-glass)', borderRadius: '0.375rem', color: '#fff' }}
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

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" disabled={isPromoting} onClick={() => setPromoteTargetUrl(null)}>Cancelar</button>
                <button type="button" className="btn btn-primary" disabled={isPromoting} onClick={handlePromoteWebSource}>
                  {isPromoting ? <><i className="fa-solid fa-spinner fa-spin"></i> Guardando...</> : <><i className="fa-solid fa-check"></i> Guardar en Proyecto</>}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
