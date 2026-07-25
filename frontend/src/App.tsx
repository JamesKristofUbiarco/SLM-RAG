import React, { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import TranscribeTab from './components/TranscribeTab';
import SummaryTab from './components/SummaryTab';
import ChatTab from './components/ChatTab';
import SearchTab from './components/SearchTab';
import SourcesTab from './components/SourcesTab';
import FilesTab from './components/FilesTab';
import YouTubeTab from './components/YouTubeTab';
import WebTab from './components/WebTab';
import TranscriptionViewer from './components/TranscriptionViewer';
import { Transcription, StatusData } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('transcription-tab');
  const [transcriptionList, setTranscriptionList] = useState<Transcription[]>([]);
  
  // Active transcription selected for play/view
  const [activeTranscriptionId, setActiveTranscriptionId] = useState<number | null>(null);

  // File redirected from Archivos tab to Transcripción
  const [pendingTranscribeFile, setPendingTranscribeFile] = useState<File | null>(null);
  // Path redirected from YouTube tab to Transcripción
  const [pendingTranscribePath, setPendingTranscribePath] = useState<string | null>(null);

  // Server hardware monitor states
  const [serverStatus, setServerStatus] = useState<boolean>(false);
  const [gpuName, setGpuName] = useState<string>('');
  const [llmModel, setLlmModel] = useState<string>('');
  const [hasHfToken, setHasHfToken] = useState<boolean>(false);

  // Transcription active progress polling states
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const serverCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch list of transcriptions from server
  const loadTranscriptions = async () => {
    try {
      const res = await fetch('/api/transcriptions');
      if (res.ok) {
        const data: Transcription[] = await res.json();
        setTranscriptionList(data);
      }
    } catch (err) {
      console.error('Error fetching transcriptions:', err);
    }
  };

  // Perform a status check to verify server is online and retrieve hardware names
  const checkServerStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setServerStatus(true);
        setGpuName(data.gpu_name);
        setLlmModel(data.llm_model);
        setHasHfToken(data.has_hf_token || false);

        // Always update statusData so VRAM, GPU, etc. are visible even when idle
        setStatusData(data);

        // If server reports a job is running but we are not polling in frontend, start polling!
        if (data.is_running && !isPolling) {
          startPollingStatus();
        }
      } else {
        setServerStatus(false);
      }
    } catch (err) {
      setServerStatus(false);
      console.error('Server status check failed:', err);
    }
  };

  // Poll status when a job is active
  const startPollingStatus = () => {
    setIsPolling(true);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/status');
        if (!res.ok) return;
        const data: StatusData = await res.json();
        setStatusData(data);
        setHasHfToken(data.has_hf_token || false);

        if (!data.is_running) {
          // Job finished!
          stopPollingStatus();
          loadTranscriptions();
          // Find the newest transcription ID to auto-load it
          const listRes = await fetch('/api/transcriptions');
          if (listRes.ok) {
            const listData: Transcription[] = await listRes.json();
            if (listData.length > 0) {
              setActiveTranscriptionId(listData[0].id);
            }
          }
        }
      } catch (err) {
        console.error('Error polling status:', err);
      }
    }, 1000);
  };

  const stopPollingStatus = async () => {
    setIsPolling(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data: StatusData = await res.json();
        setStatusData(data);
      }
    } catch (e) {
      setStatusData(prev => prev ? { ...prev, is_running: false, current_stage: 'Idle', current_progress: '' } : null);
    }
  };

  // Delete transcription action triggered from history lists
  const handleDeleteTranscription = async (id: number, filename: string) => {
    const confirmDelete = confirm(`¿Estás seguro de que deseas eliminar permanentemente la grabación "${filename}" y todo su historial de RAG y chat?`);
    if (!confirmDelete) return;

    try {
      const res = await fetch(`/api/transcriptions/${id}/delete`, {
        method: 'POST'
      });
      if (res.ok) {
        if (activeTranscriptionId === id) {
          setActiveTranscriptionId(null);
        }
        loadTranscriptions();
      } else {
        alert('Error al borrar la transcripción.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Initial load
  useEffect(() => {
    loadTranscriptions();
    checkServerStatus();

    // Check status periodically for server heartbeat
    serverCheckIntervalRef.current = setInterval(checkServerStatus, 5000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (serverCheckIntervalRef.current) clearInterval(serverCheckIntervalRef.current);
    };
  }, []);

  return (
    <div className="app-container">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        serverStatus={serverStatus}
        gpuName={gpuName}
        llmModel={llmModel}
        hasHfToken={hasHfToken}
        statusData={statusData}
      />
      
      <main className="main-content">
        <TranscribeTab 
          onTranscriptionSuccess={(newId) => {
            loadTranscriptions();
            setActiveTranscriptionId(newId);
          }}
          statusData={statusData}
          isPolling={isPolling}
          startPollingStatus={startPollingStatus}
          stopPollingStatus={stopPollingStatus}
          transcriptionList={transcriptionList}
          activeTranscriptionId={activeTranscriptionId}
          onLoadTranscription={(id) => setActiveTranscriptionId(id)}
          onDeleteTranscription={handleDeleteTranscription}
          hasHfToken={hasHfToken}
          onViewerDeleted={(id) => {
            if (activeTranscriptionId === id) {
              setActiveTranscriptionId(null);
            }
            loadTranscriptions();
          }}
          active={activeTab === 'transcription-tab'}
          pendingFile={pendingTranscribeFile}
          pendingPath={pendingTranscribePath}
        />

        <SummaryTab 
          transcriptionList={transcriptionList}
          activeId={activeTranscriptionId}
          setActiveId={setActiveTranscriptionId}
          active={activeTab === 'summary-tab'}
        />

        <ChatTab 
          transcriptionList={transcriptionList}
          activeId={activeTranscriptionId}
          setActiveId={setActiveTranscriptionId}
          active={activeTab === 'chat-tab'}
        />

        <SearchTab 
          transcriptionList={transcriptionList}
          onNavigateToTab={(tab, id) => {
            setActiveTranscriptionId(id);
            setActiveTab(tab);
          }}
          active={activeTab === 'search-tab'}
        />

        <SourcesTab 
          transcriptionList={transcriptionList}
          onRefresh={loadTranscriptions}
          active={activeTab === 'sources-tab'}
        />

        <FilesTab
          active={activeTab === 'files-tab'}
          onIngested={loadTranscriptions}
          onRedirectToTranscription={(file) => {
            setPendingTranscribeFile(file);
            setActiveTab('transcription-tab');
          }}
        />

        <YouTubeTab
          active={activeTab === 'youtube-tab'}
          onTranscriptionSuccess={(newId) => {
            loadTranscriptions();
            setActiveTranscriptionId(newId);
            setActiveTab('transcription-tab');
          }}
          statusData={statusData}
          startPollingStatus={startPollingStatus}
          stopPollingStatus={stopPollingStatus}
          hasHfToken={hasHfToken}
          onRedirectToTranscriptionPath={(path) => {
            setPendingTranscribePath(path);
            setActiveTab('transcription-tab');
          }}
        />

        <WebTab
          active={activeTab === 'web-tab'}
          onIngestionComplete={loadTranscriptions}
        />
      </main>
    </div>
  );
}
