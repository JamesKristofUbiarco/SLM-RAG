import React, { useState, useEffect, ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { Transcription, ChunkItem, Project, Folder } from '../types';
import FolderTree from './FolderTree';

interface SourcesTabProps {
  transcriptionList: Transcription[];
  onRefresh?: () => Promise<void>;
  active: boolean;
}

export default function SourcesTab({ transcriptionList, onRefresh, active }: SourcesTabProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'hierarchy' | 'table'>('hierarchy');

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
    fetchProjectsAndFolders();
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

  // Creation of Project
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
        setNewProjectName('');
        setNewProjectDesc('');
        setShowProjectModal(false);
        await fetchProjectsAndFolders();
      }
    } catch (err) {
      console.error('Error creating project:', err);
    }
  };

  // Creation of Folder
  const openCreateFolderModal = (projectId: number, parentId: number | null = null) => {
    setTargetProjectId(projectId);
    setTargetParentFolderId(parentId);
    setNewFolderName('');
    setShowFolderModal(true);
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || !targetProjectId) return;

    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: targetProjectId,
          parent_id: targetParentFolderId,
          name: newFolderName.trim()
        })
      });
      if (res.ok) {
        setNewFolderName('');
        setShowFolderModal(false);
        await fetchProjectsAndFolders();
      }
    } catch (err) {
      console.error('Error creating folder:', err);
    }
  };

  // Deletion of Project / Folder
  const handleDeleteProject = async (projectId: number) => {
    if (!confirm('¿Estás seguro de que deseas eliminar este proyecto? Las fuentes no se borrarán, solo quedarán sin proyecto.')) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchProjectsAndFolders();
        if (onRefresh) await onRefresh();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteFolder = async (folderId: number) => {
    if (!confirm('¿Estás seguro de que deseas eliminar esta carpeta? Las fuentes no se borrarán, solo quedarán sueltas en el proyecto.')) return;
    try {
      const res = await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchProjectsAndFolders();
        if (onRefresh) await onRefresh();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Move Source Modal
  const openMoveSourceModal = (source: Transcription) => {
    setMoveSourceTarget(source);
    setMoveBatchTargets(null);
    setMoveSelectedProjectId(source.project_id || '');
    setMoveSelectedFolderId(source.folder_id || '');
  };

  const openMoveBatchModal = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setMoveBatchTargets(ids);
    setMoveSourceTarget(null);
    setMoveSelectedProjectId('');
    setMoveSelectedFolderId('');
  };

  const handleExecuteMoveSource = async () => {
    const targetIds = moveBatchTargets ? moveBatchTargets : (moveSourceTarget ? [moveSourceTarget.id] : []);
    if (targetIds.length === 0) return;

    try {
      for (const id of targetIds) {
        await fetch(`/api/transcriptions/${id}/location`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: moveSelectedProjectId ? Number(moveSelectedProjectId) : null,
            folder_id: moveSelectedFolderId ? Number(moveSelectedFolderId) : null
          })
        });
      }

      setMoveSourceTarget(null);
      setMoveBatchTargets(null);
      if (onRefresh) await onRefresh();
    } catch (e) {
      console.error('Error moving source(s):', e);
    }
  };

  const promptDeleteSingle = (id: number, filename: string) => {
    setDeleteConfirmTarget({
      ids: [id],
      label: `la fuente "${filename}"`
    });
  };

  const promptDeleteSelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setDeleteConfirmTarget({
      ids,
      label: `${ids.length} fuentes seleccionadas`
    });
  };

  const executeConfirmDelete = async () => {
    if (!deleteConfirmTarget || deleteConfirmTarget.ids.length === 0) return;

    setIsDeleting(true);
    const targetIds = deleteConfirmTarget.ids;

    try {
      for (const id of targetIds) {
        const res = await fetch(`/api/transcriptions/${id}/delete`, {
          method: 'POST'
        });
        if (!res.ok) {
          console.error(`Fallo al eliminar fuente con ID ${id}`);
        }
      }

      setSelectedIds((prev) => {
        const next = new Set(prev);
        targetIds.forEach((id) => next.delete(id));
        return next;
      });

      if (onRefresh) {
        await onRefresh();
      }
    } catch (err: any) {
      console.error(err);
      alert(`Error al eliminar fuentes: ${err.message}`);
    } finally {
      setIsDeleting(false);
      setDeleteConfirmTarget(null);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    try {
      const dateObj = new Date(dateStr.replace(' ', 'T'));
      return dateObj.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateStr;
    }
  };

  const getExtension = (name: string): string => {
    const parts = name.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  };

  const getSourceLocationLabel = (item: Transcription) => {
    if (!item.project_id) return 'Fuentes Generales';
    const proj = projects.find(p => p.id === item.project_id);
    const folder = folders.find(f => f.id === item.folder_id);
    const projName = proj ? proj.name : 'Proyecto';
    if (folder) return `${projName} / ${folder.name}`;
    return projName;
  };

  const renderOriginalViewer = () => {
    if (!inspectSource) return null;
    const ext = getExtension(inspectSource.filename);

    if (ext === 'pdf') {
      return (
        <iframe
          src={`/api/files/view/${inspectSource.id}`}
          style={{ width: '100%', height: '550px', border: 'none', borderRadius: '0.5rem', background: '#fff' }}
          title={inspectSource.filename}
        />
      );
    }

    if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
      return (
        <div style={{ textAlign: 'center', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '0.5rem' }}>
          <img
            src={`/api/files/view/${inspectSource.id}`}
            alt={inspectSource.filename}
            style={{ maxWidth: '100%', maxHeight: '550px', borderRadius: '0.375rem', objectFit: 'contain' }}
          />
        </div>
      );
    }

    if (['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'].includes(ext)) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: '0.5rem' }}>
          <i className="fa-solid fa-music" style={{ fontSize: '3rem', marginBottom: '1rem', color: 'hsl(var(--primary))' }}></i>
          <p style={{ marginBottom: '1rem', fontWeight: 600 }}>{inspectSource.filename}</p>
          <audio controls src={`/api/files/view/${inspectSource.id}`} style={{ width: '100%', maxWidth: '500px' }} />
        </div>
      );
    }

    if (['mp4', 'mkv', 'webm', 'avi', 'mov'].includes(ext)) {
      return (
        <div style={{ textAlign: 'center', background: '#000', borderRadius: '0.5rem', overflow: 'hidden' }}>
          <video controls src={`/api/files/view/${inspectSource.id}`} style={{ width: '100%', maxHeight: '500px' }} />
        </div>
      );
    }

    if (['docx', 'pptx'].includes(ext)) {
      return (
        <div className="card glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
          <i className={`fa-solid ${ext === 'docx' ? 'fa-file-word' : 'fa-file-powerpoint'}`} style={{ fontSize: '4rem', color: 'hsl(var(--primary))', marginBottom: '1rem' }}></i>
          <h3>{inspectSource.filename}</h3>
          <p style={{ color: 'hsl(var(--text-muted))', margin: '1rem 0' }}>
            Los documentos binarios Microsoft Word y PowerPoint no se pueden renderizar nativamente en el navegador. Puedes consultar el texto estructurado extraído por Docling en la pestaña <strong>"Texto Extraído"</strong> o descargar el archivo original a continuación:
          </p>
          <a
            href={`/api/files/view/${inspectSource.id}`}
            download={inspectSource.filename}
            className="btn btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', margin: '0 auto' }}
          >
            <i className="fa-solid fa-download"></i> Descargar Archivo Original (.{ext})
          </a>
        </div>
      );
    }

    return (
      <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '0.5rem', maxHeight: '550px', overflowY: 'auto' }}>
        <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.8125rem', whiteSpace: 'pre-wrap', color: '#e2e8f0' }}>
          {extractedText || 'Cargando contenido del archivo...'}
        </pre>
      </div>
    );
  };

  const isAllChecked = transcriptionList.length > 0 && selectedIds.size === transcriptionList.length;

  return (
    <section id="sources-tab" className={`tab-panel ${active ? 'active' : ''}`}>
      <div className="panel-header">
        <h2>Gestión de Fuentes y Proyectos</h2>
        <p>Organiza tus documentos y audios en Proyectos, Carpetas y Subcarpetas con inspección tridimensional.</p>
      </div>

      {/* ── Main Sources Card ─────────────────────────── */}
      <div className="card glass-card">
        {/* Controls Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowProjectModal(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
            >
              <i className="fa-solid fa-folder-plus"></i> Nuevo Proyecto
            </button>

            {selectedIds.size > 0 && (
              <>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={openMoveBatchModal}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
                >
                  <i className="fa-solid fa-folder-open" style={{ color: '#a855f7' }}></i> Mover Seleccionados ({selectedIds.size})
                </button>

                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={isDeleting}
                  onClick={promptDeleteSelected}
                  style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: 'white', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
                >
                  {isDeleting ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-trash"></i>}
                  Eliminar Seleccionados ({selectedIds.size})
                </button>
              </>
            )}
          </div>

          {/* View Mode Selector */}
          <div style={{ display: 'flex', gap: '0.25rem', background: 'rgba(255,255,255,0.05)', padding: '0.2rem', borderRadius: '0.375rem', border: '1px solid var(--border-glass)' }}>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'hierarchy' ? 'btn-primary' : ''}`}
              onClick={() => setViewMode('hierarchy')}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
            >
              <i className="fa-solid fa-sitemap"></i> Vista Jerárquica
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : ''}`}
              onClick={() => setViewMode('table')}
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
            >
              <i className="fa-solid fa-table-list"></i> Vista Tabla
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
          /* View Mode 2: Classic Table with horizontal scroll */
          <div className="table-responsive">
            <table className="sources-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>
                    <label className="checkbox-container">
                      <input type="checkbox" checked={isAllChecked} onChange={handleToggleAll} />
                      <span className="checkmark"></span>
                    </label>
                  </th>
                  <th>Nombre de Fuente</th>
                  <th>Ubicación / Proyecto</th>
                  <th>Fecha Ingestión</th>
                  <th>Palabras</th>
                  <th>Chunks</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {transcriptionList.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'hsl(var(--text-muted))' }}>
                      No hay fuentes indexadas en el sistema.
                    </td>
                  </tr>
                ) : (
                  transcriptionList.map((item) => {
                    const isChecked = selectedIds.has(item.id);
                    return (
                      <tr key={item.id} style={{ background: isChecked ? 'rgba(99,102,241,0.05)' : 'transparent' }}>
                        <td>
                          <label className="checkbox-container">
                            <input type="checkbox" checked={isChecked} onChange={() => handleToggleRow(item.id)} />
                            <span className="checkmark"></span>
                          </label>
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <i className="fa-solid fa-file-audio" style={{ color: 'hsl(var(--primary))' }}></i>
                            <span>{item.filename}</span>
                          </div>
                        </td>
                        <td style={{ color: '#cbd5e1' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: 'rgba(255,255,255,0.04)', padding: '0.2rem 0.5rem', borderRadius: '0.25rem', border: '1px solid var(--border-glass)', fontSize: '0.75rem' }}>
                            <i className="fa-solid fa-folder-open" style={{ color: '#a855f7' }}></i>
                            {getSourceLocationLabel(item)}
                          </span>
                        </td>
                        <td style={{ color: 'hsl(var(--text-muted))' }}>
                          {formatDate(item.created_at)}
                        </td>
                        <td>
                          {item.word_count || 0}
                        </td>
                        <td>
                          <span className="badge" style={{ background: 'rgba(245, 158, 11, 0.15)', color: 'var(--primary)' }}>
                            {item.chunk_count || 0} chunks
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => openMoveSourceModal(item)}
                              title="Mover a Proyecto/Carpeta"
                              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                            >
                              <i className="fa-solid fa-folder"></i> Mover
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => handleOpenInspector(item)}
                              title="Inspeccionar tridimensionalmente"
                              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                            >
                              <i className="fa-solid fa-eye"></i> Inspeccionar
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => promptDeleteSingle(item.id, item.filename)}
                              title="Eliminar fuente"
                              style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
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

      {/* ── Modal: Create Project (Portal) ────────────────────────────── */}
      {showProjectModal && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={() => setShowProjectModal(false)}>
          <div className="card glass-card" style={{ width: '100%', maxWidth: '440px', padding: '1.75rem', border: '1px solid rgba(168,85,247,0.4)', boxShadow: '0 1rem 3rem rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <i className="fa-solid fa-diagram-project" style={{ color: '#a855f7' }}></i> Nuevo Proyecto
            </h3>
            <form onSubmit={handleCreateProject} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem' }}>Nombre del Proyecto *</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Ej. Investigación 2026"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  required
                  autoFocus
                  style={{ width: '100%', padding: '0.625rem 0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', borderRadius: '0.375rem', color: '#fff' }}
                />
              </div>
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem' }}>Descripción (Opcional)</label>
                <textarea
                  className="form-control"
                  rows={3}
                  placeholder="Detalles sobre este proyecto..."
                  value={newProjectDesc}
                  onChange={e => setNewProjectDesc(e.target.value)}
                  style={{ width: '100%', padding: '0.625rem 0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', borderRadius: '0.375rem', color: '#fff' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowProjectModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Crear Proyecto</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ── Modal: Create Folder / Subfolder (Portal) ─────────────────── */}
      {showFolderModal && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={() => setShowFolderModal(false)}>
          <div className="card glass-card" style={{ width: '100%', maxWidth: '440px', padding: '1.75rem', border: '1px solid rgba(56,189,248,0.4)', boxShadow: '0 1rem 3rem rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <i className="fa-solid fa-folder-plus" style={{ color: '#38bdf8' }}></i> {targetParentFolderId ? 'Nueva Subcarpeta' : 'Nueva Carpeta'}
            </h3>
            <form onSubmit={handleCreateFolder} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem' }}>Nombre de la Carpeta *</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Ej. Entrevistas / Documentos"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  required
                  autoFocus
                  style={{ width: '100%', padding: '0.625rem 0.75rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-glass)', borderRadius: '0.375rem', color: '#fff' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowFolderModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Crear Carpeta</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ── Modal: Move Source (Portal) ────────────────────────────────── */}
      {(moveSourceTarget || moveBatchTargets) && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }} onClick={() => { setMoveSourceTarget(null); setMoveBatchTargets(null); }}>
          <div className="card glass-card" style={{ width: '100%', maxWidth: '460px', padding: '1.75rem', border: '1px solid rgba(129,140,248,0.4)', boxShadow: '0 1rem 3rem rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <i className="fa-solid fa-arrow-right-to-city" style={{ color: 'var(--primary)' }}></i> {moveBatchTargets ? `Mover ${moveBatchTargets.length} Fuentes` : 'Mover Fuente'}
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#cbd5e1', marginTop: '0.35rem' }}>
              Selecciona el destino para: <strong>{moveBatchTargets ? `${moveBatchTargets.length} fuentes seleccionadas` : moveSourceTarget?.filename}</strong>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.25rem' }}>
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem' }}>Proyecto Destino</label>
                <select
                  className="form-control"
                  value={moveSelectedProjectId}
                  onChange={e => {
                    setMoveSelectedProjectId(e.target.value ? Number(e.target.value) : '');
                    setMoveSelectedFolderId('');
                  }}
                  style={{ width: '100%', padding: '0.625rem 0.75rem', background: 'rgba(20,24,38,0.95)', border: '1px solid var(--border-glass)', borderRadius: '0.375rem', color: '#fff' }}
                >
                  <option value="">-- Sin Proyecto (Fuentes Generales) --</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {moveSelectedProjectId !== '' && (
                <div>
                  <label className="form-label" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8125rem' }}>Carpeta Destino (Opcional)</label>
                  <select
                    className="form-control"
                    value={moveSelectedFolderId}
                    onChange={e => setMoveSelectedFolderId(e.target.value ? Number(e.target.value) : '')}
                    style={{ width: '100%', padding: '0.625rem 0.75rem', background: 'rgba(20,24,38,0.95)', border: '1px solid var(--border-glass)', borderRadius: '0.375rem', color: '#fff' }}
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

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => { setMoveSourceTarget(null); setMoveBatchTargets(null); }}>Cancelar</button>
                <button type="button" className="btn btn-primary" onClick={handleExecuteMoveSource}>Guardar Ubicación</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── 3D Source Inspector Modal (Portal) ─────────────────────────── */}
      {inspectSource && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem'
          }}
          onClick={() => setInspectSource(null)}
        >
          <div
            className="card glass-card"
            style={{
              width: '100%',
              maxWidth: '900px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              padding: '1.5rem',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                  <i className="fa-solid fa-cube" style={{ color: 'hsl(var(--primary))', marginRight: '0.5rem' }}></i>
                  {inspectSource.filename}
                </h3>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => setInspectSource(null)}
                style={{ fontSize: '1.1rem', padding: '0.25rem 0.6rem' }}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.5rem' }}>
              <button
                type="button"
                className={`btn btn-sm ${inspectTab === 'original' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setInspectTab('original')}
              >
                <i className="fa-solid fa-file"></i> 1. Archivo Original
              </button>
              <button
                type="button"
                className={`btn btn-sm ${inspectTab === 'extracted' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setInspectTab('extracted')}
              >
                <i className="fa-solid fa-align-left"></i> 2. Texto Extraído (Docling / Whisper)
              </button>
              <button
                type="button"
                className={`btn btn-sm ${inspectTab === 'chunks' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setInspectTab('chunks')}
              >
                <i className="fa-solid fa-puzzle-piece"></i> 3. Chunks Vectoriales ({chunksList.length})
              </button>
            </div>

            <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
              {isLoadingDetails ? (
                <div style={{ textAlign: 'center', padding: '3rem' }}>
                  <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2rem', color: 'hsl(var(--primary))', marginBottom: '1rem' }}></i>
                  <p>Cargando inspección tridimensional...</p>
                </div>
              ) : (
                <>
                  {inspectTab === 'original' && renderOriginalViewer()}

                  {inspectTab === 'extracted' && (
                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '0.5rem', maxHeight: '550px', overflowY: 'auto' }}>
                      <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.875rem', whiteSpace: 'pre-wrap', color: '#e2e8f0', lineHeight: 1.6 }}>
                        {extractedText || 'No hay texto disponible.'}
                      </pre>
                    </div>
                  )}

                  {inspectTab === 'chunks' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {chunksList.length > 0 ? (
                        chunksList.map((c) => (
                          <div key={c.id} style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid var(--border-glass)', borderRadius: '0.5rem', padding: '0.875rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.75rem', color: 'var(--accent-light)', fontWeight: 600 }}>
                              <span><i className="fa-solid fa-hashtag"></i> Chunk #{c.chunk_index} (ID DB: {c.id})</span>
                              <span><i className="fa-solid fa-font"></i> {c.char_count} caracteres</span>
                            </div>
                            <div style={{ fontSize: '0.8125rem', lineHeight: 1.5, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>
                              "{c.text}"
                            </div>
                          </div>
                        ))
                      ) : (
                        <div style={{ textAlign: 'center', padding: '2rem', color: 'hsl(var(--text-muted))' }}>
                          <i className="fa-solid fa-puzzle-piece" style={{ fontSize: '2.5rem', marginBottom: '0.75rem', opacity: 0.3, display: 'block' }}></i>
                          <p>No se encontraron fragmentos vectoriales almacenados para esta fuente.</p>
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

      {/* Delete Confirmation Modal (Portal) */}
      {deleteConfirmTarget && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem'
          }}
          onClick={() => setDeleteConfirmTarget(null)}
        >
          <div
            className="card glass-card"
            style={{
              width: '100%',
              maxWidth: '480px',
              padding: '1.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              boxShadow: '0 1rem 3rem rgba(239, 68, 68, 0.2)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="fa-solid fa-triangle-exclamation" style={{ color: '#ef4444', fontSize: '1.3rem' }}></i>
              </div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#f8fafc' }}>
                Confirmar Eliminación
              </h3>
            </div>

            <p style={{ margin: 0, fontSize: '0.9rem', color: '#cbd5e1', lineHeight: '1.5' }}>
              ¿Estás seguro de que deseas eliminar permanentemente <strong>{deleteConfirmTarget.label}</strong>?
              <br /><br />
              Esta acción borrará la transcripción, fragmentos vectoriales (embeddings), resúmenes e historial de chat asociados de la base de datos local.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={isDeleting}
                onClick={() => setDeleteConfirmTarget(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                disabled={isDeleting}
                onClick={executeConfirmDelete}
                style={{ backgroundColor: '#dc2626', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
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
    </section>
  );
}
