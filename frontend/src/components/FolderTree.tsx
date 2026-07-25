import React, { useState } from 'react';
import { Project, Folder, Transcription } from '../types';

interface FolderTreeProps {
  projects: Project[];
  folders: Folder[];
  transcriptions: Transcription[];
  selectedSourceIds: Set<number>;
  onToggleSource: (id: number) => void;
  onToggleFolder?: (folderId: number, childSourceIds: number[], childFolderIds: number[], forceState?: boolean) => void;
  onToggleProject?: (projectId: number | null, childSourceIds: number[], forceState?: boolean) => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  // Management callbacks (optional)
  onCreateFolder?: (projectId: number, parentId: number | null) => void;
  onDeleteFolder?: (folderId: number) => void;
  onDeleteProject?: (projectId: number) => void;
  onMoveSource?: (source: Transcription) => void;
  isManagementMode?: boolean;
}

export default function FolderTree({
  projects,
  folders,
  transcriptions,
  selectedSourceIds,
  onToggleSource,
  onToggleFolder,
  onToggleProject,
  onSelectAll,
  onDeselectAll,
  onCreateFolder,
  onDeleteFolder,
  onDeleteProject,
  onMoveSource,
  isManagementMode = false
}: FolderTreeProps) {
  // Collapsed state for projects and folders
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [collapsedFolders, setCollapsedFolders] = useState<Record<number, boolean>>({});

  const toggleProjectCollapse = (key: string) => {
    setCollapsedProjects(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleFolderCollapse = (folderId: number) => {
    setCollapsedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  // Helper to recursively get all descendant source IDs in a folder
  const getFolderSourceIds = (folderId: number): number[] => {
    const directSources = transcriptions.filter(t => t.folder_id === folderId).map(t => t.id);
    const subFolders = folders.filter(f => f.parent_id === folderId);
    let subSources: number[] = [];
    subFolders.forEach(sub => {
      subSources = [...subSources, ...getFolderSourceIds(sub.id)];
    });
    return [...directSources, ...subSources];
  };

  // Helper to get all folder IDs under a parent folder
  const getFolderChildFolderIds = (folderId: number): number[] => {
    const subFolders = folders.filter(f => f.parent_id === folderId);
    let ids = subFolders.map(f => f.id);
    subFolders.forEach(sub => {
      ids = [...ids, ...getFolderChildFolderIds(sub.id)];
    });
    return ids;
  };

  // Recursive folder renderer
  const renderFolder = (folder: Folder, projectId: number) => {
    const isCollapsed = collapsedFolders[folder.id];
    const directSources = transcriptions.filter(t => t.folder_id === folder.id);
    const childFolders = folders.filter(f => f.parent_id === folder.id);
    const allFolderSourceIds = getFolderSourceIds(folder.id);

    const isFullySelected = allFolderSourceIds.length > 0 && allFolderSourceIds.every(id => selectedSourceIds.has(id));
    const isPartiallySelected = !isFullySelected && allFolderSourceIds.some(id => selectedSourceIds.has(id));

    const handleFolderCheckboxChange = () => {
      if (onToggleFolder) {
        onToggleFolder(folder.id, allFolderSourceIds, [folder.id, ...getFolderChildFolderIds(folder.id)], !isFullySelected);
      }
    };

    return (
      <div key={folder.id} className="tree-folder-node" style={{ marginLeft: '1.25rem', marginTop: '0.35rem' }}>
        <div 
          className="folder-node-header" 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            padding: '0.35rem 0.6rem', 
            background: 'rgba(255, 255, 255, 0.03)', 
            borderRadius: '0.375rem',
            border: '1px solid var(--border-glass)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexGrow: 1, cursor: 'pointer' }}>
            <span onClick={() => toggleFolderCollapse(folder.id)} style={{ width: '1.25rem', color: '#94a3b8' }}>
              <i className={`fa-solid ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'}`}></i>
            </span>

            <label className="checkbox-container" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', margin: 0 }}>
              <input 
                type="checkbox" 
                checked={isFullySelected}
                ref={el => { if (el) el.indeterminate = isPartiallySelected; }}
                onChange={handleFolderCheckboxChange}
              />
              <span className="checkmark"></span>
            </label>

            <span onClick={() => toggleFolderCollapse(folder.id)} style={{ color: '#f59e0b', fontSize: '0.9rem' }}>
              <i className={`fa-solid ${isCollapsed ? 'fa-folder' : 'fa-folder-open'}`}></i>
            </span>
            <span onClick={() => toggleFolderCollapse(folder.id)} style={{ fontWeight: 600, fontSize: '0.85rem', color: '#e2e8f0' }}>
              {folder.name}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '0.25rem' }}>
              ({allFolderSourceIds.length})
            </span>
          </div>

          {isManagementMode && (
            <div className="folder-actions" style={{ display: 'flex', gap: '0.35rem' }}>
              {onCreateFolder && (
                <button
                  type="button"
                  title="Añadir Subcarpeta"
                  onClick={() => onCreateFolder(projectId, folder.id)}
                  style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', padding: '0.2rem 0.4rem', fontSize: '0.75rem' }}
                >
                  <i className="fa-solid fa-folder-plus"></i>
                </button>
              )}
              {onDeleteFolder && (
                <button
                  type="button"
                  title="Eliminar Carpeta"
                  onClick={() => onDeleteFolder(folder.id)}
                  style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.2rem 0.4rem', fontSize: '0.75rem' }}
                >
                  <i className="fa-solid fa-trash"></i>
                </button>
              )}
            </div>
          )}
        </div>

        {!isCollapsed && (
          <div className="folder-node-children" style={{ borderLeft: '1px dashed rgba(255,255,255,0.1)', marginLeft: '0.6rem', paddingLeft: '0.5rem' }}>
            {/* Render Subfolders */}
            {childFolders.map(sub => renderFolder(sub, projectId))}

            {/* Render Direct Sources */}
            {directSources.map(source => renderSourceNode(source))}
          </div>
        )}
      </div>
    );
  };

  // Render individual Source/File node
  const renderSourceNode = (source: Transcription) => {
    const isSelected = selectedSourceIds.has(source.id);
    return (
      <div 
        key={source.id} 
        className="tree-source-node"
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          padding: '0.3rem 0.5rem', 
          marginLeft: '1.25rem', 
          marginTop: '0.25rem',
          borderRadius: '0.25rem',
          background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
          borderLeft: isSelected ? '2px solid #6366f1' : '2px solid transparent'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden', flexGrow: 1 }}>
          <label className="checkbox-container" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', margin: 0 }}>
            <input 
              type="checkbox" 
              checked={isSelected}
              onChange={() => onToggleSource(source.id)}
            />
            <span className="checkmark"></span>
          </label>
          <i className="fa-solid fa-file-audio" style={{ color: '#818cf8', fontSize: '0.8rem', flexShrink: 0 }}></i>
          <span 
            title={source.filename}
            style={{ 
              fontSize: '0.8125rem', 
              color: isSelected ? '#fff' : '#cbd5e1', 
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              whiteSpace: 'nowrap',
              cursor: 'pointer' 
            }}
            onClick={() => onToggleSource(source.id)}
          >
            {source.filename}
          </span>
          <span style={{ fontSize: '0.6875rem', color: '#64748b', flexShrink: 0 }}>
            ({source.word_count || 0} palabras)
          </span>
        </div>

        {isManagementMode && onMoveSource && (
          <button
            type="button"
            title="Mover a carpeta/proyecto"
            onClick={() => onMoveSource(source)}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)', color: '#cbd5e1', cursor: 'pointer', padding: '0.2rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.7rem' }}
          >
            <i className="fa-solid fa-arrow-right-to-city"></i> Mover
          </button>
        )}
      </div>
    );
  };

  // Unassigned Sources (no project assigned)
  const unassignedSources = transcriptions.filter(t => !t.project_id);

  return (
    <div className="folder-tree-container">
      {/* Global Toolbar for Selection */}
      {(onSelectAll || onDeselectAll) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-glass)' }}>
          <div style={{ fontSize: '0.8125rem', color: '#818cf8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <i className="fa-solid fa-layer-group"></i> {selectedSourceIds.size} de {transcriptions.length} fuentes activas
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {onSelectAll && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={onSelectAll}
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-glass)', color: '#fff' }}
              >
                <i className="fa-solid fa-check-double"></i> Marcar Todo
              </button>
            )}
            {onDeselectAll && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={onDeselectAll}
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-glass)', color: '#cbd5e1' }}
              >
                <i className="fa-solid fa-xmark"></i> Desmarcar
              </button>
            )}
          </div>
        </div>
      )}

      {/* Projects List */}
      {projects.map(project => {
        const projectKey = `proj_${project.id}`;
        const isCollapsed = collapsedProjects[projectKey];
        const projectFolders = folders.filter(f => f.project_id === project.id && !f.parent_id);
        const projectSources = transcriptions.filter(t => t.project_id === project.id);
        const allProjectSourceIds = projectSources.map(t => t.id);

        const isFullySelected = allProjectSourceIds.length > 0 && allProjectSourceIds.every(id => selectedSourceIds.has(id));
        const isPartiallySelected = !isFullySelected && allProjectSourceIds.some(id => selectedSourceIds.has(id));

        const handleProjectCheckboxChange = () => {
          if (onToggleProject) {
            onToggleProject(project.id, allProjectSourceIds, !isFullySelected);
          }
        };

        return (
          <div key={project.id} className="project-node" style={{ marginBottom: '1rem' }}>
            <div 
              className="project-header"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0.75rem',
                background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(168,85,247,0.1))',
                borderRadius: '0.5rem',
                border: '1px solid rgba(99,102,241,0.3)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexGrow: 1, cursor: 'pointer' }}>
                <span onClick={() => toggleProjectCollapse(projectKey)} style={{ width: '1.25rem', color: '#c084fc' }}>
                  <i className={`fa-solid ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'}`}></i>
                </span>

                <label className="checkbox-container" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', margin: 0 }}>
                  <input 
                    type="checkbox" 
                    checked={isFullySelected}
                    ref={el => { if (el) el.indeterminate = isPartiallySelected; }}
                    onChange={handleProjectCheckboxChange}
                  />
                  <span className="checkmark"></span>
                </label>

                <span onClick={() => toggleProjectCollapse(projectKey)} style={{ color: '#a855f7', fontSize: '1rem' }}>
                  <i className="fa-solid fa-diagram-project"></i>
                </span>
                <span onClick={() => toggleProjectCollapse(projectKey)} style={{ fontWeight: 700, fontSize: '0.9rem', color: '#fff' }}>
                  {project.name}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#a7f3d0', marginLeft: '0.25rem' }}>
                  ({allProjectSourceIds.length} fuentes)
                </span>
              </div>

              {isManagementMode && (
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  {onCreateFolder && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Crear Carpeta en Proyecto"
                      onClick={() => onCreateFolder(project.id, null)}
                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)' }}
                    >
                      <i className="fa-solid fa-folder-plus"></i> Carpeta
                    </button>
                  )}
                  {onDeleteProject && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Eliminar Proyecto"
                      onClick={() => onDeleteProject(project.id)}
                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}
                    >
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  )}
                </div>
              )}
            </div>

            {!isCollapsed && (
              <div className="project-children" style={{ marginTop: '0.4rem' }}>
                {/* Top-level folders under project */}
                {projectFolders.map(folder => renderFolder(folder, project.id))}

                {/* Sources directly under project without a folder */}
                {transcriptions.filter(t => t.project_id === project.id && !t.folder_id).map(source => renderSourceNode(source))}
              </div>
            )}
          </div>
        );
      })}

      {/* General / Unassigned Sources Section */}
      <div className="project-node unassigned-node" style={{ marginBottom: '1rem' }}>
        <div 
          className="project-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.5rem 0.75rem',
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: '0.5rem',
            border: '1px solid var(--border-glass)'
          }}
        >
          <div 
            onClick={() => toggleProjectCollapse('proj_general')} 
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexGrow: 1, cursor: 'pointer' }}
          >
            <span style={{ width: '1.25rem', color: '#94a3b8' }}>
              <i className={`fa-solid ${collapsedProjects['proj_general'] ? 'fa-chevron-right' : 'fa-chevron-down'}`}></i>
            </span>
            <span style={{ color: '#94a3b8', fontSize: '1rem' }}>
              <i className="fa-solid fa-folder-open"></i>
            </span>
            <span style={{ fontWeight: 600, fontSize: '0.875rem', color: '#cbd5e1' }}>
              Fuentes Generales (Sin Proyecto)
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '0.25rem' }}>
              ({unassignedSources.length})
            </span>
          </div>
        </div>

        {!collapsedProjects['proj_general'] && (
          <div className="project-children" style={{ marginTop: '0.4rem' }}>
            {unassignedSources.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: '#64748b', padding: '0.5rem 1.25rem' }}>
                No hay fuentes sueltas sin proyecto.
              </div>
            ) : (
              unassignedSources.map(source => renderSourceNode(source))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
