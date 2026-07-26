import React, { useState } from 'react';
import { StatusData } from '../types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  serverStatus: boolean;
  gpuName: string;
  llmModel: string;
  hasHfToken: boolean;
  statusData?: StatusData | null;
}

export default function Sidebar({ activeTab, setActiveTab, serverStatus, gpuName, llmModel, hasHfToken, statusData }: SidebarProps) {
  const ingestionChildren = ['transcription-tab', 'files-tab', 'youtube-tab', 'web-tab'];
  const [ingestionOpen, setIngestionOpen] = useState<boolean>(
    ingestionChildren.includes(activeTab)
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  const flatItems = [
    { id: 'summary-tab',  label: 'Resúmenes',         icon: 'fa-file-invoice' },
    { id: 'chat-tab',     label: 'Chat RAG',           icon: 'fa-comments' },
    { id: 'search-tab',   label: 'Búsqueda Semántica', icon: 'fa-magnifying-glass' },
    { id: 'sources-tab',  label: 'Fuentes',            icon: 'fa-folder-open' },
  ];

  const allNavItems = [
    { id: 'transcription-tab', label: 'Transcripción', icon: 'fa-microphone' },
    { id: 'files-tab',         label: 'Archivos',      icon: 'fa-file-lines' },
    { id: 'youtube-tab',       label: 'YouTube',       icon: 'fa-brands fa-youtube', iconColor: '#ef4444' },
    { id: 'web-tab',           label: 'Páginas Web',   icon: 'fa-solid fa-globe', iconColor: '#38bdf8' },
    { id: 'summary-tab',       label: 'Resúmenes',     icon: 'fa-file-invoice' },
    { id: 'chat-tab',          label: 'Chat RAG',       icon: 'fa-comments' },
    { id: 'search-tab',        label: 'Búsqueda',      icon: 'fa-magnifying-glass' },
    { id: 'sources-tab',       label: 'Fuentes',        icon: 'fa-folder-open' },
  ];

  const isTaskRunning = Boolean(statusData?.is_running);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <i className="fa-solid fa-brain brand-icon"></i>
          <div className="brand-text">
            <h1>SLM RAG</h1>
            <span>Local AI Assistant</span>
          </div>
        </div>

        {/* Mobile Menu Toggle Button */}
        <button
          type="button"
          className="mobile-menu-toggle"
          onClick={() => setMobileMenuOpen(prev => !prev)}
          aria-label="Abrir Menú"
        >
          <i className={`fa-solid ${mobileMenuOpen ? 'fa-xmark' : 'fa-bars'}`}></i>
          <span>Navegación</span>
        </button>
      </div>

      {/* Mobile Flat Nav Scrollbar */}
      <div className="mobile-nav-bar">
        {allNavItems.map(item => (
          <button
            key={item.id}
            type="button"
            className={`mobile-nav-pill ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => { setActiveTab(item.id); setMobileMenuOpen(false); }}
          >
            <i className={item.icon} style={item.iconColor ? { color: item.iconColor } : undefined}></i>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Desktop / Collapsible Mobile Menu */}
      <nav className={`nav-menu ${mobileMenuOpen ? 'mobile-expanded' : ''}`}>
        {/* ── Accordion: Ingestión ─────────────────────── */}
        <div className="nav-group">
          <button
            className={`nav-group-header ${ingestionOpen ? 'open' : ''}`}
            onClick={() => setIngestionOpen((prev) => !prev)}
            aria-expanded={ingestionOpen}
          >
            <span className="nav-group-header-left">
              <i className="fa-solid fa-layer-group"></i>
              Ingestión
            </span>
            <i className={`fa-solid fa-chevron-down nav-group-chevron ${ingestionOpen ? 'open' : ''}`}></i>
          </button>

          <div className={`nav-group-children ${ingestionOpen ? 'open' : ''}`}>
            <button
              className={`nav-child-btn ${activeTab === 'transcription-tab' ? 'active' : ''}`}
              onClick={() => { setActiveTab('transcription-tab'); setMobileMenuOpen(false); }}
            >
              <i className="fa-solid fa-microphone"></i>
              Transcripción
            </button>
            <button
              className={`nav-child-btn ${activeTab === 'files-tab' ? 'active' : ''}`}
              onClick={() => { setActiveTab('files-tab'); setMobileMenuOpen(false); }}
            >
              <i className="fa-solid fa-file-lines"></i>
              Archivos
            </button>
            <button
              className={`nav-child-btn ${activeTab === 'youtube-tab' ? 'active' : ''}`}
              onClick={() => { setActiveTab('youtube-tab'); setMobileMenuOpen(false); }}
            >
              <i className="fa-brands fa-youtube" style={{ color: '#ef4444' }}></i>
              YouTube
            </button>
            <button
              className={`nav-child-btn ${activeTab === 'web-tab' ? 'active' : ''}`}
              onClick={() => { setActiveTab('web-tab'); setMobileMenuOpen(false); }}
            >
              <i className="fa-solid fa-globe" style={{ color: '#38bdf8' }}></i>
              Páginas Web
            </button>
          </div>
        </div>

        {/* ── Flat items ───────────────────────────────── */}
        {flatItems.map((item) => (
          <button
            key={item.id}
            className={`nav-btn ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => { setActiveTab(item.id); setMobileMenuOpen(false); }}
          >
            <i className={`fa-solid ${item.icon}`}></i>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Live Reactive Server Status Card ────────────── */}
      <div className="sidebar-status">
        <div className="status-header">
          <span style={{ fontWeight: 600 }}>Estado del Servidor</span>
          <span
            className={`status-dot ${serverStatus ? (isTaskRunning ? 'processing' : 'online') : 'offline'}`}
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: !serverStatus ? '#ef4444' : isTaskRunning ? '#6366f1' : '#10b981',
              boxShadow: isTaskRunning ? '0 0 8px #6366f1' : 'none'
            }}
          ></span>
        </div>

        {/* Live Stage Indicator */}
        {isTaskRunning && (
          <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', borderRadius: '0.375rem', background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
            <div style={{ fontSize: '0.725rem', color: '#818cf8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <i className="fa-solid fa-spinner fa-spin"></i> {statusData?.current_stage || 'Procesando...'}
            </div>
            {statusData?.current_progress && (
              <div style={{ fontSize: '0.6875rem', color: '#cbd5e1', marginTop: '0.2rem', wordBreak: 'break-word' }}>
                {statusData.current_progress}
              </div>
            )}
          </div>
        )}

        <div className="status-details" style={{ marginTop: '0.5rem' }}>
          <p><i className="fa-solid fa-microchip"></i> GPU: <span>{gpuName || statusData?.device_name || 'CUDA GPU'}</span></p>
          <p><i className="fa-solid fa-memory"></i> VRAM GPU: <span>{statusData?.vram_allocated_mb ? `${statusData.vram_allocated_mb} MB` : 'Calculando...'}</span></p>
          <p><i className="fa-solid fa-network-wired"></i> LLM: <span>{llmModel || 'Gemma 4 12B'}</span></p>
          <p>
            <i className="fa-solid fa-users-viewfinder"></i> Diarización:{' '}
            <span style={{ color: hasHfToken ? '#10b981' : '#f59e0b' }}>
              {hasHfToken ? 'Token en .env' : 'Requiere Token'}
            </span>
          </p>
        </div>
      </div>
    </aside>
  );
}
