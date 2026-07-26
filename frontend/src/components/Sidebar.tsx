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
    { id: 'transcription-tab', label: 'Transcripción', icon: 'fa-solid fa-microphone' },
    { id: 'files-tab',         label: 'Archivos',      icon: 'fa-solid fa-file-lines' },
    { id: 'youtube-tab',       label: 'YouTube',       icon: 'fa-brands fa-youtube', iconColor: '#ef4444' },
    { id: 'web-tab',           label: 'Páginas Web',   icon: 'fa-solid fa-globe', iconColor: '#38bdf8' },
    { id: 'summary-tab',       label: 'Resúmenes',     icon: 'fa-solid fa-file-invoice' },
    { id: 'chat-tab',          label: 'Chat RAG',      icon: 'fa-solid fa-comments' },
    { id: 'search-tab',        label: 'Búsqueda',      icon: 'fa-solid fa-magnifying-glass' },
    { id: 'sources-tab',       label: 'Fuentes',       icon: 'fa-solid fa-folder-open' },
  ];

  const isTaskRunning = Boolean(statusData?.is_running);

  return (
    <aside className="w-full lg:w-64 shrink-0 bg-[#0a0a0d] border-b lg:border-b-0 lg:border-r border-white/10 p-4 lg:p-5 lg:pb-6 lg:fixed lg:top-0 lg:left-0 lg:bottom-0 lg:h-screen flex flex-col justify-between overflow-y-auto z-30">
      <div>
        {/* Row 1: Brand Header & Mobile Menu Button */}
        <div className="flex items-center justify-between mb-3 lg:mb-6">
          <div className="flex items-center gap-2.5">
            <i className="fa-solid fa-brain text-2xl text-amber-500"></i>
            <div>
              <h1 className="text-lg font-semibold tracking-wide text-white leading-tight">SLM RAG</h1>
              <span className="text-xs text-zinc-400 font-medium">Local AI Assistant</span>
            </div>
          </div>

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition-colors"
            onClick={() => setMobileMenuOpen(prev => !prev)}
            aria-label="Abrir Menú"
          >
            <i className={`fa-solid ${mobileMenuOpen ? 'fa-xmark' : 'fa-bars'}`}></i>
            <span>Menú</span>
          </button>
        </div>

        {/* Row 2: Mobile Horizontal Pill Navigation Bar */}
        <div className="flex lg:hidden overflow-x-auto gap-2 py-1 mb-2 no-scrollbar">
          {allNavItems.map(item => (
            <button
              key={item.id}
              type="button"
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                activeTab === item.id
                  ? 'bg-amber-500 text-zinc-950 font-semibold border-amber-500 shadow-md shadow-amber-500/20'
                  : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white hover:bg-white/10'
              }`}
              onClick={() => { setActiveTab(item.id); setMobileMenuOpen(false); }}
            >
              <i className={item.icon} style={item.iconColor ? { color: item.iconColor } : undefined}></i>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* Desktop / Collapsible Mobile Navigation Menu */}
        <nav className={`flex-col gap-1.5 ${mobileMenuOpen ? 'flex' : 'hidden lg:flex'}`}>
          {/* Accordion: Ingestión */}
          <div className="flex flex-col">
            <button
              type="button"
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors ${
                ingestionOpen ? 'text-white' : ''
              }`}
              onClick={() => setIngestionOpen((prev) => !prev)}
              aria-expanded={ingestionOpen}
            >
              <span className="flex items-center gap-2.5">
                <i className="fa-solid fa-layer-group text-amber-500"></i>
                Ingestión
              </span>
              <i className={`fa-solid fa-chevron-down text-xs transition-transform duration-200 ${ingestionOpen ? 'rotate-180 text-amber-400' : 'opacity-50'}`}></i>
            </button>

            {ingestionOpen && (
              <div className="flex flex-col gap-1 pl-4 pt-1 pb-1">
                <button
                  type="button"
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === 'transcription-tab'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                  onClick={() => { setActiveTab('transcription-tab'); setMobileMenuOpen(false); }}
                >
                  <i className="fa-solid fa-microphone w-4 text-center"></i>
                  Transcripción
                </button>

                <button
                  type="button"
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === 'files-tab'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                  onClick={() => { setActiveTab('files-tab'); setMobileMenuOpen(false); }}
                >
                  <i className="fa-solid fa-file-lines w-4 text-center"></i>
                  Archivos
                </button>

                <button
                  type="button"
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === 'youtube-tab'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                  onClick={() => { setActiveTab('youtube-tab'); setMobileMenuOpen(false); }}
                >
                  <i className="fa-brands fa-youtube w-4 text-center text-red-500"></i>
                  YouTube
                </button>

                <button
                  type="button"
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === 'web-tab'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                  onClick={() => { setActiveTab('web-tab'); setMobileMenuOpen(false); }}
                >
                  <i className="fa-solid fa-globe w-4 text-center text-sky-400"></i>
                  Páginas Web
                </button>
              </div>
            )}
          </div>

          {/* Flat Navigation Items */}
          {flatItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === item.id
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
              onClick={() => { setActiveTab(item.id); setMobileMenuOpen(false); }}
            >
              <i className={`fa-solid ${item.icon} w-4 text-center`}></i>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Live Server Status Card at Bottom */}
      <div className="hidden lg:block mt-auto pt-4 pb-1 shrink-0">
        <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 shadow-lg">
        <div className="flex items-center justify-between text-xs font-semibold text-zinc-400 mb-2">
          <span>Estado del Servidor</span>
          <span
            className="w-2.5 h-2.5 rounded-full transition-all duration-300"
            style={{
              backgroundColor: !serverStatus ? '#ef4444' : isTaskRunning ? '#6366f1' : '#10b981',
              boxShadow: isTaskRunning ? '0 0 10px #6366f1' : serverStatus ? '0 0 8px #10b981' : 'none'
            }}
          ></span>
        </div>

        {/* Live Task Progress Banner */}
        {isTaskRunning && (
          <div className="mb-2 p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-xs">
            <div className="flex items-center gap-1.5 text-indigo-400 font-medium">
              <i className="fa-solid fa-spinner fa-spin"></i>
              <span>{statusData?.current_stage || 'Procesando...'}</span>
            </div>
            {statusData?.current_progress && (
              <div className="text-[11px] text-zinc-300 mt-1 break-words">
                {statusData.current_progress}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1 text-[11px] text-zinc-400">
          <p><i className="fa-solid fa-microchip mr-1.5"></i> GPU: <span className="text-white font-medium">{gpuName || statusData?.device_name || 'CUDA GPU'}</span></p>
          <p><i className="fa-solid fa-memory mr-1.5"></i> VRAM GPU: <span className="text-white font-medium">{statusData?.vram_allocated_mb ? `${statusData.vram_allocated_mb} MB` : 'Calculando...'}</span></p>
          <p><i className="fa-solid fa-network-wired mr-1.5"></i> LLM: <span className="text-white font-medium">{llmModel || 'Gemma 4 12B'}</span></p>
          <p>
            <i className="fa-solid fa-users-viewfinder mr-1.5"></i> Diarización:{' '}
            <span className={`font-medium ${hasHfToken ? 'text-emerald-400' : 'text-amber-400'}`}>
              {hasHfToken ? 'Token en .env' : 'Requiere Token'}
            </span>
          </p>
        </div>
      </div>
    </div>
  </aside>
  );
}
