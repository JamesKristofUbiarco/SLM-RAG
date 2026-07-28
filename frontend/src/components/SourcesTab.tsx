import React, { useState, useEffect, ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { Transcription, ChunkItem, Project, Folder, NoteItem } from '../types';
import FolderTree from './FolderTree';

interface SourcesTabProps {
  transcriptionList: Transcription[];
  onRefresh?: () => Promise<void>;
  onResumeInStudio?: (payload: any) => void;
  active: boolean;
}

export default function SourcesTab({ transcriptionList, onRefresh, onResumeInStudio, active }: SourcesTabProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'hierarchy' | 'table'>('hierarchy');

  // Notebook Notes State
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [showCreateNoteModal, setShowCreateNoteModal] = useState<boolean>(false);
  const [newNoteTitle, setNewNoteTitle] = useState<string>('');
  const [newNoteContent, setNewNoteContent] = useState<string>('');
  const [isPromotingNoteId, setIsPromotingNoteId] = useState<number | null>(null);

  // Projects & Folders State
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);

  // Project Modal State
  const [showProjectModal, setShowProjectModal] = useState<boolean>(false);
  const [newProjectName, setNewProjectName] = useState<string>('');
  const [newProjectDesc, setNewProjectDesc] = useState<string>('');

  // Folder Modal State
  const [showFolderModal, setShowFolderModal] = useState<boolean>(false);
  const [targetProjectId, setTargetProjectId] = useState<number | null>(null);
  const [targetParentFolderId, setTargetParentFolderId] = useState<number | null>(null);
  const [newFolderName, setNewFolderName] = useState<string>('');

  // Move Source Modal State
  const [moveSourceTarget, setMoveSourceTarget] = useState<Transcription | null>(null);
  const [moveBatchTargets, setMoveBatchTargets] = useState<number[] | null>(null);
  const [moveSelectedProjectId, setMoveSelectedProjectId] = useState<number | ''>('');
  const [moveSelectedFolderId, setMoveSelectedFolderId] = useState<number | ''>('');

  // Inspector modal states
  const [inspectSource, setInspectSource] = useState<Transcription | null>(null);
  const [inspectTab, setInspectTab] = useState<'original' | 'extracted' | 'chunks'>('original');
  const [extractedText, setExtractedText] = useState<string>('');
  const [chunksList, setChunksList] = useState<ChunkItem[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);

  // Delete confirmation modal states
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{ ids: number[]; label: string } | null>(null);

  const fetchNotes = async () => {
    try {
      const res = await fetch('/api/notes');
      if (res.ok) {
        const data = await res.json();
        setNotes(data || []);
      }
    } catch (err) {
      console.error('Error fetching notes:', err);
    }
  };

  const handleCreateNote = async () => {
    if (!newNoteContent.trim()) return;
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newNoteTitle,
          content: newNoteContent,
          source_type: 'user_note'
        })
      });
      if (res.ok) {
        setNewNoteTitle('');
        setNewNoteContent('');
        setShowCreateNoteModal(false);
        fetchNotes();
      }
    } catch (err) {
      console.error('Error creating note:', err);
    }
  };

  const handleDeleteNote = async (id: number) => {
    try {
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
      if (res.ok) fetchNotes();
    } catch (err) {
      console.error('Error deleting note:', err);
    }
  };

  const handlePromoteNoteToSource = async (id: number) => {
    setIsPromotingNoteId(id);
    try {
      const res = await fetch(`/api/notes/${id}/promote_to_source`, { method: 'POST' });
      if (res.ok) {
        alert('¡Nota convertida a Fuente RAG e indexada correctamente!');
        if (onRefresh) await onRefresh();
        fetchProjectsAndFolders();
      }
    } catch (err: any) {
      alert(`Error al promover nota: ${err.message}`);
    } finally {
      setIsPromotingNoteId(null);
    }
  };

  const handleExportFlashcardsCSV = (noteTitle: string, rawContent: string) => {
    try {
      const parsed = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
      const cards = parsed.data || parsed.flashcards || [];
      if (!Array.isArray(cards) || cards.length === 0) {
        alert('No se encontraron flashcards válidas en esta nota.');
        return;
      }
      
      const rows = cards.map((c: any) => {
        const cleanFront = (c.front || '').replace(/"/g, '""');
        const cleanBack = (c.back || '').replace(/"/g, '""');
        return `"${cleanFront}","${cleanBack}"`;
      });
      
      const csvContent = '\uFEFF' + rows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const sanitizedTitle = (noteTitle || 'flashcards').replace(/[^a-zA-Z0-9_-]/g, '_');
      link.href = url;
      link.setAttribute('download', `${sanitizedTitle}_flashcards.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Error al exportar las flashcards a CSV.');
    }
  };

  // Fetch Projects and Folders from API
  const fetchProjectsAndFolders = async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
        setFolders(data.folders || []);
      }
    } catch (e) {
      console.error('Error fetching projects and folders:', e);
    }
  };

  useEffect(() => {
    if (active) {
      fetchProjectsAndFolders();
      fetchNotes();
      if (onRefresh) onRefresh();
    }
  }, [active]);

  // Clear selections when list changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [transcriptionList]);

  const handleOpenInspector = async (source: Transcription) => {
    setInspectSource(source);
    setInspectTab('original');
    setIsLoadingDetails(true);
    setExtractedText('');
    setChunksList([]);

    try {
      const resDetails = await fetch(`/api/transcriptions/${source.id}`);
      if (resDetails.ok) {
        const dataDetails = await resDetails.json();
        setExtractedText(dataDetails.text || source.filename);
      }

      const resChunks = await fetch(`/api/transcriptions/${source.id}/chunks`);
      if (resChunks.ok) {
        const dataChunks: ChunkItem[] = await resChunks.json();
        setChunksList(dataChunks);
      }
    } catch (e) {
      console.error("Error loading source details for inspector:", e);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleToggleAll = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const allIds = transcriptionList.map((item) => item.id);
      setSelectedIds(new Set(allIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleToggleRow = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Action: Open Create Project Modal
  const openCreateProjectModal = () => {
    setNewProjectName('');
    setNewProjectDesc('');
    setShowProjectModal(true);
  };

  // Submit Create Project
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName.trim(), description: newProjectDesc.trim() })
      });
      if (res.ok) {
        setShowProjectModal(false);
        fetchProjectsAndFolders();
      }
    } catch (err) {
      console.error("Error creating project:", err);
    }
  };

  // Action: Open Create Folder Modal
  const openCreateFolderModal = (projectId: number, parentFolderId: number | null = null) => {
    setTargetProjectId(projectId);
    setTargetParentFolderId(parentFolderId);
    setNewFolderName('');
    setShowFolderModal(true);
  };

  // Submit Create Folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || !targetProjectId) return;
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFolderName.trim(),
          project_id: targetProjectId,
          parent_id: targetParentFolderId
        })
      });
      if (res.ok) {
        setShowFolderModal(false);
        fetchProjectsAndFolders();
      }
    } catch (err) {
      console.error("Error creating folder:", err);
    }
  };

  // Action: Move Single Source Modal
  const openMoveSourceModal = (source: Transcription) => {
    setMoveSourceTarget(source);
    setMoveBatchTargets(null);
    setMoveSelectedProjectId(source.project_id || '');
    setMoveSelectedFolderId(source.folder_id || '');
  };

  // Action: Move Selected Batch Sources Modal
  const openMoveBatchSourcesModal = () => {
    if (selectedIds.size === 0) return;
    setMoveSourceTarget(null);
    setMoveBatchTargets(Array.from(selectedIds));
    setMoveSelectedProjectId('');
    setMoveSelectedFolderId('');
  };

  // Execute Move Source (Single or Batch)
  const handleExecuteMoveSource = async () => {
    const idsToMove = moveBatchTargets ? moveBatchTargets : (moveSourceTarget ? [moveSourceTarget.id] : []);
    if (idsToMove.length === 0) return;

    try {
      const res = await fetch('/api/transcriptions/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcription_ids: idsToMove,
          project_id: moveSelectedProjectId !== '' ? moveSelectedProjectId : null,
          folder_id: moveSelectedFolderId !== '' ? moveSelectedFolderId : null
        })
      });

      if (res.ok) {
        setMoveSourceTarget(null);
        setMoveBatchTargets(null);
        if (onRefresh) await onRefresh();
        await fetchProjectsAndFolders();
      }
    } catch (err) {
      console.error("Error moving sources:", err);
    }
  };

  // Delete Handlers with confirmation modal
  const promptDeleteSingle = (id: number, filename: string) => {
    setDeleteConfirmTarget({ ids: [id], label: `"${filename}"` });
  };

  const promptDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    setDeleteConfirmTarget({ ids: Array.from(selectedIds), label: `${selectedIds.size} fuentes seleccionadas` });
  };

  const handleDeleteFolder = (folderId: number, folderName: string) => {
    const folderSources = transcriptionList.filter(s => s.folder_id === folderId);
    setDeleteConfirmTarget({
      ids: folderSources.map(s => s.id),
      label: `carpeta "${folderName}" y sus ${folderSources.length} fuentes`
    });
  };

  const handleDeleteProject = (projectId: number, projectName: string) => {
    const projectSources = transcriptionList.filter(s => s.project_id === projectId);
    setDeleteConfirmTarget({
      ids: projectSources.map(s => s.id),
      label: `proyecto "${projectName}" y sus ${projectSources.length} fuentes`
    });
  };

  const executeConfirmDelete = async () => {
    if (!deleteConfirmTarget || deleteConfirmTarget.ids.length === 0) return;
    setIsDeleting(true);

    try {
      const res = await fetch('/api/transcriptions/delete-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: deleteConfirmTarget.ids })
      });

      if (res.ok) {
        setSelectedIds(new Set());
        setDeleteConfirmTarget(null);
        if (onRefresh) await onRefresh();
        await fetchProjectsAndFolders();
      } else {
        alert('Fallo al eliminar los elementos seleccionados.');
      }
    } catch (err) {
      console.error(err);
      alert('Error al procesar la solicitud de eliminación.');
    } finally {
      setIsDeleting(false);
    }
  };

  const isAllChecked = transcriptionList.length > 0 && selectedIds.size === transcriptionList.length;

  const formatDate = (isoStr?: string) => {
    if (!isoStr) return '-';
    return isoStr.substring(0, 10);
  };

  const getSourceLocationLabel = (source: Transcription) => {
    const proj = projects.find(p => p.id === source.project_id);
    const fold = folders.find(f => f.id === source.folder_id);
    if (proj && fold) return `${proj.name} / ${fold.name}`;
    if (proj) return proj.name;
    if (fold) return `Folder: ${fold.name}`;
    return 'General (Sin Proyecto)';
  };

  const renderOriginalViewer = () => {
    if (!inspectSource) return null;
    const fn = (inspectSource.filename || '').toLowerCase();
    const fileUrl = `/api/files/view/${inspectSource.id}`;

    const isPdf = fn.endsWith('.pdf');
    const isVideo = fn.endsWith('.mp4') || fn.endsWith('.webm') || fn.endsWith('.mkv') || fn.endsWith('.mov') || fn.endsWith('.avi') || inspectSource.source_type === 'video';
    const isAudio = fn.endsWith('.mp3') || fn.endsWith('.wav') || fn.endsWith('.m4a') || fn.endsWith('.ogg') || fn.endsWith('.flac') || fn.endsWith('.aac') || inspectSource.source_type === 'audio' || inspectSource.source_type === 'youtube';

    return (
      <div className="flex flex-col gap-4">
        {/* PDF Embedded Viewer */}
        {isPdf && (
          <div className="flex flex-col gap-2">
            <div className="w-full h-[480px] rounded-xl overflow-hidden border border-white/10 bg-black/60 shadow-inner">
              <iframe
                src={fileUrl}
                className="w-full h-full border-none"
                title={inspectSource.filename}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
              <span className="flex items-center gap-1.5"><i className="fa-solid fa-file-pdf text-red-400"></i> Visualizador PDF Embebido</span>
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-amber-400 hover:underline flex items-center gap-1 font-medium"
              >
                <i className="fa-solid fa-up-right-from-square"></i> Abrir PDF en pestaña nueva
              </a>
            </div>
          </div>
        )}

        {/* Video Player */}
        {isVideo && !isPdf && (
          <div className="flex flex-col gap-2">
            <div className="w-full max-h-[420px] bg-black rounded-xl overflow-hidden border border-white/10 flex items-center justify-center shadow-inner">
              <video
                controls
                src={fileUrl}
                className="max-h-[420px] w-full rounded-xl"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
              <span className="flex items-center gap-1.5"><i className="fa-solid fa-video text-sky-400"></i> Reproductor de Video Original</span>
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-amber-400 hover:underline flex items-center gap-1 font-medium"
              >
                <i className="fa-solid fa-download"></i> Descargar Video
              </a>
            </div>
          </div>
        )}

        {/* Audio Player */}
        {isAudio && !isVideo && !isPdf && (
          <div className="p-4 bg-black/40 rounded-xl border border-white/10 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-zinc-300 font-medium">
              <span className="flex items-center gap-1.5 text-amber-400">
                <i className="fa-solid fa-headphones"></i> Reproductor de Audio Original
              </span>
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-zinc-400 hover:text-white flex items-center gap-1 text-[11px]"
              >
                <i className="fa-solid fa-download"></i> Descargar Audio
              </a>
            </div>
            <audio controls src={fileUrl} className="w-full h-11 rounded-lg outline-none mt-1" />
          </div>
        )}

        {/* Metadata Information Box */}
        <div className="p-4 bg-black/30 rounded-xl border border-white/10 font-mono text-xs text-zinc-300 space-y-1.5">
          <p><span className="text-zinc-500">ID DB:</span> {inspectSource.id}</p>
          <p><span className="text-zinc-500">Nombre:</span> {inspectSource.filename}</p>
          <p><span className="text-zinc-500">Tipo de Fuente:</span> {inspectSource.source_type || 'Documento/Multimedia'}</p>
          <p><span className="text-zinc-500">Ruta Física:</span> {inspectSource.filepath || 'N/A'}</p>
          <p><span className="text-zinc-500">Total de Palabras:</span> {inspectSource.word_count || 0}</p>
          <p><span className="text-zinc-500">Total Chunks Vectoriales:</span> {inspectSource.chunk_count || 0}</p>
          <p><span className="text-zinc-500">Ubicación:</span> {getSourceLocationLabel(inspectSource)}</p>
        </div>
      </div>
    );
  };

  return (
    <section id="sources-tab" className={`flex-col gap-6 w-full ${active ? 'flex' : 'hidden'}`}>
      <div className="mb-1">
        <h2 className="text-2xl font-semibold text-white tracking-tight mb-1">Gestión de Fuentes RAG & Proyectos</h2>
        <p className="text-sm text-zinc-400">Organiza tus audios, documentos e ingestas web en Proyectos y Carpetas con vista jerárquica.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start w-full">
        {/* Left Column: RAG Sources Management */}
        <div className="xl:col-span-2 p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-4 w-full">
          {/* Top Actions Bar */}
          <div className="flex items-center justify-between flex-wrap gap-3 pb-4 border-b border-white/10">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="px-3.5 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-amber-400 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                onClick={openCreateProjectModal}
              >
                <i className="fa-solid fa-folder-plus"></i> Nuevo Proyecto
              </button>

              {selectedIds.size > 0 && (
                <>
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/35 text-purple-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                    onClick={openMoveBatchSourcesModal}
                  >
                    <i className="fa-solid fa-arrows-up-down-left-right"></i> Mover ({selectedIds.size})
                  </button>

                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/35 text-red-400 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                    onClick={promptDeleteSelected}
                  >
                    <i className="fa-solid fa-trash"></i> Eliminar ({selectedIds.size})
                  </button>
                </>
              )}
            </div>

            {/* View Mode Selector */}
            <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/10">
              <button
                type="button"
                className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  viewMode === 'hierarchy'
                    ? 'bg-amber-500/15 border border-amber-500/35 text-amber-400 font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                onClick={() => setViewMode('hierarchy')}
              >
                <i className="fa-solid fa-sitemap"></i> Jerárquica
              </button>
              <button
                type="button"
                className={`flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-amber-500/15 border border-amber-500/35 text-amber-400 font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                onClick={() => setViewMode('table')}
              >
                <i className="fa-solid fa-table-list"></i> Tabla
              </button>
            </div>
          </div>

          {/* View Mode 1: Hierarchy Tree */}
          {viewMode === 'hierarchy' ? (
            <FolderTree
              projects={projects}
              folders={folders}
              transcriptions={transcriptionList}
              selectedSourceIds={selectedIds}
              onToggleSource={handleToggleRow}
              onCreateFolder={openCreateFolderModal}
              onDeleteFolder={handleDeleteFolder}
              onDeleteProject={handleDeleteProject}
              onMoveSource={openMoveSourceModal}
              isManagementMode={true}
            />
          ) : (
            /* View Mode 2: Classic Table */
            <div className="w-full overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full min-w-[650px] text-left text-xs border-collapse">
                <thead className="bg-black/40 text-zinc-400 font-semibold border-b border-white/10">
                  <tr>
                    <th className="p-3 w-10">
                      <input type="checkbox" className="accent-amber-500 rounded" checked={isAllChecked} onChange={handleToggleAll} />
                    </th>
                    <th className="p-3">Nombre de Fuente</th>
                    <th className="p-3">Ubicación</th>
                    <th className="p-3">Fecha</th>
                    <th className="p-3">Chunks</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {transcriptionList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-zinc-500">
                        No hay fuentes indexadas en el sistema.
                      </td>
                    </tr>
                  ) : (
                    transcriptionList.map((item) => {
                      const isChecked = selectedIds.has(item.id);
                      return (
                        <tr key={item.id} className={`hover:bg-white/[0.03] transition-colors ${isChecked ? 'bg-indigo-500/10' : ''}`}>
                          <td className="p-3">
                            <input type="checkbox" className="accent-amber-500 rounded" checked={isChecked} onChange={() => handleToggleRow(item.id)} />
                          </td>
                          <td className="p-3 font-semibold text-white">
                            <div className="flex items-center gap-2 truncate max-w-[200px]">
                              <i className="fa-solid fa-file-audio text-amber-500"></i>
                              <span className="truncate">{item.filename}</span>
                            </div>
                          </td>
                          <td className="p-3 text-zinc-300">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/[0.04] border border-white/10 text-[11px] truncate max-w-[150px]">
                              <i className="fa-solid fa-folder-open text-purple-400"></i>
                              {getSourceLocationLabel(item)}
                            </span>
                          </td>
                          <td className="p-3 text-zinc-400">
                            {formatDate(item.created_at)}
                          </td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[11px] font-semibold border border-amber-500/30">
                              {item.chunk_count || 0}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 text-xs cursor-pointer font-medium"
                                onClick={() => handleOpenInspector(item)}
                                title="Inspeccionar archivo original y chunks"
                              >
                                <i className="fa-solid fa-eye"></i> Inspeccionar
                              </button>
                              <button
                                type="button"
                                className="px-2 py-1 rounded bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 text-xs cursor-pointer"
                                onClick={() => openMoveSourceModal(item)}
                                title="Mover a Proyecto o Carpeta"
                              >
                                <i className="fa-solid fa-folder-tree"></i>
                              </button>
                              <button
                                type="button"
                                className="px-2 py-1 rounded bg-red-500/15 hover:bg-red-500/25 text-red-400 text-xs cursor-pointer"
                                onClick={() => promptDeleteSingle(item.id, item.filename)}
                                title="Eliminar fuente"
                              >
                                <i className="fa-solid fa-trash"></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Column: Notebook / Cuaderno de Notas Card */}
        <div className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-4 w-full">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-book-bookmark text-amber-500"></i>
              Cuaderno de Notas ({notes.length})
            </h3>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-md shadow-amber-500/20 transition-all"
              onClick={() => setShowCreateNoteModal(true)}
            >
              <i className="fa-solid fa-plus"></i> Nueva Nota
            </button>
          </div>

          <div className="flex flex-col gap-3 max-h-[620px] overflow-y-auto pr-1">
            {notes.length === 0 ? (
              <div className="text-center p-8 text-zinc-500 text-xs">
                <i className="fa-solid fa-note-sticky text-3xl mb-2 block opacity-40 text-amber-500"></i>
                Tu cuaderno está vacío. Crea notas o guarda fragmentos desde el Chat y los Resúmenes.
              </div>
            ) : (
              notes.map(n => {
                const isStudioQuiz = n.source_type === 'studio_quiz';
                const isStudioFlashcards = n.source_type === 'studio_flashcards';
                const isStudioBriefing = n.source_type === 'studio_briefing';
                const isStudioFAQ = n.source_type === 'studio_faq';
                const isStudioTimeline = n.source_type === 'studio_timeline';
                const isStudioPodcast = n.source_type === 'studio_podcast';
                const isStudioOther = n.source_type?.startsWith('studio_') && !isStudioQuiz && !isStudioFlashcards && !isStudioBriefing && !isStudioFAQ && !isStudioTimeline && !isStudioPodcast;
                const isStudioAny = isStudioQuiz || isStudioFlashcards || isStudioBriefing || isStudioFAQ || isStudioTimeline || isStudioPodcast || isStudioOther;

                let displayContent = n.content;
                if (isStudioQuiz) {
                  displayContent = 'Examen interactivo guardado. Haz clic en "Retomar en Studio" para resolver las preguntas.';
                } else if (isStudioFlashcards) {
                  displayContent = 'Colección de tarjetas 3D guardada. Haz clic en "Retomar en Studio" para repasar.';
                } else if (typeof n.content === 'string' && n.content.trim().startsWith('{')) {
                  try {
                    const parsed = JSON.parse(n.content);
                    if (parsed.content) displayContent = parsed.content;
                  } catch (e) {}
                }

                return (
                  <div key={n.id} className="p-3.5 rounded-xl bg-white/[0.03] border border-white/10 flex flex-col gap-2 transition-all hover:border-amber-500/30">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white text-xs truncate max-w-[65%]">{n.title}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                        isStudioQuiz ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' :
                        isStudioFlashcards ? 'bg-pink-500/15 text-pink-300 border-pink-500/30' :
                        isStudioBriefing ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
                        isStudioFAQ ? 'bg-sky-500/15 text-sky-300 border-sky-500/30' :
                        isStudioTimeline ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
                        isStudioPodcast ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' :
                        isStudioOther ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
                        n.source_type === 'chat_fragment' ? 'bg-sky-500/15 text-sky-300 border-sky-500/30' :
                        n.source_type === 'summary_fragment' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
                        'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      }`}>
                        {isStudioQuiz ? '📝 Examen' :
                         isStudioFlashcards ? '🎴 Flashcards' :
                         isStudioBriefing ? '📄 Briefing' :
                         isStudioFAQ ? '❓ FAQ' :
                         isStudioTimeline ? '⏳ Línea de Tiempo' :
                         isStudioPodcast ? '🎙️ Podcast' :
                         isStudioOther ? '⚡ Studio' :
                         n.source_type === 'chat_fragment' ? '💬 Chat' :
                         n.source_type === 'summary_fragment' ? '📄 Resumen' : '📌 Nota'}
                      </span>
                    </div>

                    <p className="text-xs text-zinc-300 line-clamp-3 leading-relaxed whitespace-pre-wrap font-sans">
                      {displayContent}
                    </p>

                    <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px] flex-wrap gap-2">
                      <span className="text-zinc-500">{formatDate(n.created_at)}</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isStudioAny && (
                          <button
                            type="button"
                            className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold cursor-pointer transition-all flex items-center gap-1 shadow-sm"
                            onClick={() => {
                              try {
                                let parsed: any = null;
                                if (typeof n.content === 'string' && n.content.trim().startsWith('{')) {
                                  try { parsed = JSON.parse(n.content); } catch (e) { parsed = null; }
                                }
                                
                                const rawMode = n.source_type?.replace('studio_', '') || 'briefing';
                                const mode = parsed?.artifact_type || parsed?.type || rawMode;
                                const artifactType = parsed?.type || (mode === 'quiz' || mode === 'flashcards' ? mode : 'markdown');
                                
                                const payload = {
                                  type: artifactType,
                                  artifact_type: mode,
                                  title: parsed?.title || n.title,
                                  content: parsed?.content || n.content,
                                  data: parsed?.data || parsed?.quiz || parsed?.flashcards || []
                                };
                                
                                onResumeInStudio?.(payload);
                              } catch (e) {
                                alert('No se pudo decodificar el contenido de Studio.');
                              }
                            }}
                            title="Abrir y retomar este elemento en Studio Hub"
                          >
                            <i className="fa-solid fa-gamepad"></i> Retomar en Studio
                          </button>
                        )}

                        {isStudioFlashcards && (
                          <button
                            type="button"
                            className="px-2.5 py-1 rounded bg-pink-500/20 hover:bg-pink-500/30 border border-pink-500/40 text-pink-300 font-bold cursor-pointer transition-all flex items-center gap-1 shadow-sm"
                            onClick={() => handleExportFlashcardsCSV(n.title, n.content)}
                            title="Exportar esta colección de flashcards a un archivo CSV"
                          >
                            <i className="fa-solid fa-file-csv"></i> CSV
                          </button>
                        )}

                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 font-medium cursor-pointer transition-colors flex items-center gap-1"
                          onClick={() => handlePromoteNoteToSource(n.id)}
                          disabled={isPromotingNoteId === n.id}
                          title="Convertir esta nota en una Fuente RAG indexada"
                        >
                          {isPromotingNoteId === n.id ? (
                            <i className="fa-solid fa-spinner fa-spin"></i>
                          ) : (
                            <><i className="fa-solid fa-file-import"></i> ➕ A RAG</>
                          )}
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-zinc-300 cursor-pointer"
                          onClick={() => navigator.clipboard.writeText(n.content)}
                          title="Copiar texto"
                        >
                          <i className="fa-solid fa-copy"></i>
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 cursor-pointer"
                          onClick={() => handleDeleteNote(n.id)}
                          title="Eliminar nota"
                        >
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Modal: Create Project */}
      {showProjectModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowProjectModal(false)}>
          <div className="p-6 rounded-2xl bg-[#17171c] border border-purple-500/40 shadow-2xl max-w-md w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-diagram-project text-purple-400"></i> Nuevo Proyecto
            </h3>
            <form onSubmit={handleCreateProject} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-300">Nombre del Proyecto *</label>
                <input
                  type="text"
                  className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white p-2.5 text-xs focus:outline-none focus:border-amber-500"
                  placeholder="Ej. Investigación 2026"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-300">Descripción (Opcional)</label>
                <textarea
                  rows={3}
                  className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white p-2.5 text-xs focus:outline-none focus:border-amber-500"
                  placeholder="Detalles sobre este proyecto..."
                  value={newProjectDesc}
                  onChange={e => setNewProjectDesc(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" className="px-3.5 py-2 rounded-lg bg-white/10 text-white text-xs font-medium cursor-pointer" onClick={() => setShowProjectModal(false)}>Cancelar</button>
                <button type="submit" className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold cursor-pointer transition-colors">Crear Proyecto</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Create Folder / Subfolder */}
      {showFolderModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowFolderModal(false)}>
          <div className="p-6 rounded-2xl bg-[#17171c] border border-sky-500/40 shadow-2xl max-w-md w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-folder-plus text-sky-400"></i> {targetParentFolderId ? 'Nueva Subcarpeta' : 'Nueva Carpeta'}
            </h3>
            <form onSubmit={handleCreateFolder} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-300">Nombre de la Carpeta *</label>
                <input
                  type="text"
                  className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white p-2.5 text-xs focus:outline-none focus:border-amber-500"
                  placeholder="Ej. Entrevistas / Documentos"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" className="px-3.5 py-2 rounded-lg bg-white/10 text-white text-xs font-medium cursor-pointer" onClick={() => setShowFolderModal(false)}>Cancelar</button>
                <button type="submit" className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold cursor-pointer transition-colors">Crear Carpeta</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Move Source */}
      {(moveSourceTarget || moveBatchTargets) && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setMoveSourceTarget(null); setMoveBatchTargets(null); }}>
          <div className="p-6 rounded-2xl bg-[#17171c] border border-amber-500/40 shadow-2xl max-w-md w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-arrow-right-to-city text-amber-500"></i> {moveBatchTargets ? `Mover ${moveBatchTargets.length} Fuentes` : 'Mover Fuente'}
            </h3>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Selecciona el destino para: <strong>{moveBatchTargets ? `${moveBatchTargets.length} fuentes seleccionadas` : moveSourceTarget?.filename}</strong>
            </p>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-300">Proyecto Destino</label>
                <select
                  className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white p-2.5 text-xs"
                  value={moveSelectedProjectId}
                  onChange={e => {
                    setMoveSelectedProjectId(e.target.value ? Number(e.target.value) : '');
                    setMoveSelectedFolderId('');
                  }}
                >
                  <option value="">-- Sin Proyecto (Fuentes Generales) --</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {moveSelectedProjectId !== '' && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-zinc-300">Carpeta Destino (Opcional)</label>
                  <select
                    className="w-full bg-[#1e293b] border border-white/10 rounded-lg text-white p-2.5 text-xs"
                    value={moveSelectedFolderId}
                    onChange={e => setMoveSelectedFolderId(e.target.value ? Number(e.target.value) : '')}
                  >
                    <option value="">-- Raíz del Proyecto --</option>
                    {folders
                      .filter(f => f.project_id === Number(moveSelectedProjectId))
                      .map(f => (
                        <option key={f.id} value={f.id}>{f.parent_id ? '  ↳ ' : ''}{f.name}</option>
                      ))}
                  </select>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button type="button" className="px-3.5 py-2 rounded-lg bg-white/10 text-white text-xs font-medium cursor-pointer" onClick={() => { setMoveSourceTarget(null); setMoveBatchTargets(null); }}>Cancelar</button>
                <button type="button" className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold cursor-pointer transition-colors" onClick={handleExecuteMoveSource}>Guardar Ubicación</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 3D Source Inspector Modal */}
      {inspectSource && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setInspectSource(null)}>
          <div className="p-6 rounded-2xl bg-[#17171c] border border-white/10 shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col gap-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <i className="fa-solid fa-cube text-amber-500"></i>
                {inspectSource.filename}
              </h3>
              <button type="button" className="text-zinc-400 hover:text-white text-lg cursor-pointer" onClick={() => setInspectSource(null)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="flex items-center gap-2 border-b border-white/10 pb-3 flex-wrap text-xs">
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                  inspectTab === 'original' ? 'bg-amber-500 text-zinc-950 font-semibold' : 'bg-white/10 text-white hover:bg-white/15'
                }`}
                onClick={() => setInspectTab('original')}
              >
                <i className="fa-solid fa-file"></i> 1. Archivo Original
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                  inspectTab === 'extracted' ? 'bg-amber-500 text-zinc-950 font-semibold' : 'bg-white/10 text-white hover:bg-white/15'
                }`}
                onClick={() => setInspectTab('extracted')}
              >
                <i className="fa-solid fa-align-left"></i> 2. Texto Extraído (Docling / Whisper)
              </button>
              <button
                type="button"
                className={`px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                  inspectTab === 'chunks' ? 'bg-amber-500 text-zinc-950 font-semibold' : 'bg-white/10 text-white hover:bg-white/15'
                }`}
                onClick={() => setInspectTab('chunks')}
              >
                <i className="fa-solid fa-puzzle-piece"></i> 3. Chunks Vectoriales ({chunksList.length})
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              {isLoadingDetails ? (
                <div className="text-center py-12">
                  <i className="fa-solid fa-spinner fa-spin text-3xl text-amber-500 mb-3 block"></i>
                  <p className="text-xs text-zinc-400">Cargando inspección tridimensional...</p>
                </div>
              ) : (
                <>
                  {inspectTab === 'original' && renderOriginalViewer()}

                  {inspectTab === 'extracted' && (
                    <div className="p-4 bg-black/40 rounded-xl border border-white/10 max-h-[500px] overflow-y-auto">
                      <pre className="font-mono text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed">
                        {extractedText || 'No hay texto disponible.'}
                      </pre>
                    </div>
                  )}

                  {inspectTab === 'chunks' && (
                    <div className="flex flex-col gap-3">
                      {chunksList.length > 0 ? (
                        chunksList.map((c) => (
                          <div key={c.id} className="p-3.5 rounded-xl bg-white/[0.02] border border-white/10 text-xs">
                            <div className="flex items-center justify-between text-amber-400 font-semibold mb-1">
                              <span><i className="fa-solid fa-hashtag"></i> Chunk #{c.chunk_index} (ID DB: {c.id})</span>
                              <span className="text-zinc-400 font-mono text-[11px]"><i className="fa-solid fa-font"></i> {c.char_count} caracteres</span>
                            </div>
                            <div className="text-zinc-300 leading-relaxed whitespace-pre-wrap font-sans">
                              "{c.text}"
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-12 text-zinc-500">
                          <i className="fa-solid fa-puzzle-piece text-3xl mb-2 opacity-40 block"></i>
                          <p className="text-xs">No se encontraron fragmentos vectoriales almacenados para esta fuente.</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmTarget && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDeleteConfirmTarget(null)}>
          <div className="p-6 rounded-2xl bg-[#17171c] border border-red-500/40 shadow-2xl max-w-md w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 text-lg shrink-0">
                <i className="fa-solid fa-triangle-exclamation"></i>
              </div>
              <h3 className="text-base font-semibold text-white">
                Confirmar Eliminación
              </h3>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              ¿Estás seguro de que deseas eliminar permanentemente <strong>{deleteConfirmTarget.label}</strong>?
              <br /><br />
              Esta acción borrará la transcripción, fragmentos vectoriales (embeddings), resúmenes e historial de chat asociados.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                className="px-3.5 py-2 rounded-lg bg-white/10 text-white text-xs font-medium cursor-pointer"
                disabled={isDeleting}
                onClick={() => setDeleteConfirmTarget(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                disabled={isDeleting}
                onClick={executeConfirmDelete}
              >
                {isDeleting ? (
                  <><i className="fa-solid fa-spinner fa-spin"></i> Eliminando...</>
                ) : (
                  <><i className="fa-solid fa-trash"></i> Eliminar Definitivamente</>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal: Create Note */}
      {showCreateNoteModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowCreateNoteModal(false)}>
          <div className="p-6 rounded-2xl bg-[#17171c] border border-amber-500/40 shadow-2xl max-w-lg w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <i className="fa-solid fa-book-bookmark text-amber-500"></i>
                Crear Nueva Nota en el Cuaderno
              </h3>
              <button type="button" className="text-zinc-400 hover:text-white" onClick={() => setShowCreateNoteModal(false)}>
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="flex flex-col gap-3 text-xs">
              <div className="flex flex-col gap-1">
                <label className="text-zinc-300 font-medium">Título de la Nota</label>
                <input
                  type="text"
                  className="bg-black/40 border border-white/10 rounded-lg p-2.5 text-white focus:outline-none focus:border-amber-500"
                  placeholder="Ej. Resumen de ideas sobre la arquitectura RAG"
                  value={newNoteTitle}
                  onChange={e => setNewNoteTitle(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-zinc-300 font-medium">Contenido / Apuntes (Markdown)</label>
                <textarea
                  rows={6}
                  className="bg-black/40 border border-white/10 rounded-lg p-2.5 text-white font-mono focus:outline-none focus:border-amber-500 resize-none"
                  placeholder="Escribe tus apuntes, notas o fragmentos..."
                  value={newNoteContent}
                  onChange={e => setNewNoteContent(e.target.value)}
                ></textarea>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
              <button
                type="button"
                className="px-3.5 py-2 rounded-lg bg-white/10 text-white text-xs font-medium cursor-pointer"
                onClick={() => setShowCreateNoteModal(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs cursor-pointer transition-colors flex items-center gap-1.5"
                onClick={handleCreateNote}
              >
                <i className="fa-solid fa-floppy-disk"></i> Guardar Nota
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
