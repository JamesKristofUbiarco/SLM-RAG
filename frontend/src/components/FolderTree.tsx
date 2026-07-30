import { useState } from 'react';
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
      <div key={folder.id} className="ml-4 mt-1">
        <div className="flex items-center justify-between p-1.5 rounded-md bg-white/[0.03] border border-white/10 hover:bg-white/[0.05] transition-colors">
          <div className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
            <span onClick={() => toggleFolderCollapse(folder.id)} className="w-4 text-zinc-400 text-xs text-center">
              <i className={`fa-solid ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'}`}></i>
            </span>

            <input 
              type="checkbox" 
              className="accent-amber-500 rounded cursor-pointer w-3.5 h-3.5"
              checked={isFullySelected}
              ref={el => { if (el) el.indeterminate = isPartiallySelected; }}
              onChange={handleFolderCheckboxChange}
            />

            <span onClick={() => toggleFolderCollapse(folder.id)} className="text-amber-500 text-xs">
              <i className={`fa-solid ${isCollapsed ? 'fa-folder' : 'fa-folder-open'}`}></i>
            </span>
            <span onClick={() => toggleFolderCollapse(folder.id)} className="font-semibold text-xs text-zinc-200 truncate">
              {folder.name}
            </span>
            <span className="text-[11px] text-zinc-500 shrink-0">
              ({allFolderSourceIds.length})
            </span>
          </div>

          {isManagementMode && (
            <div className="flex items-center gap-1">
              {onCreateFolder && (
                <button
                  type="button"
                  title="Añadir Subcarpeta"
                  onClick={() => onCreateFolder(projectId, folder.id)}
                  className="text-sky-400 hover:text-sky-300 px-1.5 py-0.5 text-[11px] cursor-pointer"
                >
                  <i className="fa-solid fa-folder-plus"></i>
                </button>
              )}
              {onDeleteFolder && (
                <button
                  type="button"
                  title="Eliminar Carpeta"
                  onClick={() => onDeleteFolder(folder.id)}
                  className="text-red-400 hover:text-red-300 px-1.5 py-0.5 text-[11px] cursor-pointer"
                >
                  <i className="fa-solid fa-trash"></i>
                </button>
              )}
            </div>
          )}
        </div>

        {!isCollapsed && (
          <div className="border-l border-dashed border-white/10 ml-2.5 pl-2 space-y-1 mt-1">
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
        className={`flex items-center justify-between p-1.5 pl-4 rounded transition-colors text-xs ${
          isSelected ? 'bg-amber-500/15 border-l-2 border-amber-500' : 'hover:bg-white/[0.03] border-l-2 border-transparent'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <input 
            type="checkbox" 
            className="accent-amber-500 rounded cursor-pointer w-3.5 h-3.5"
            checked={isSelected}
            onChange={() => onToggleSource(source.id)}
          />
          <i className="fa-solid fa-file-audio text-amber-500 text-xs shrink-0"></i>
          <span 
            title={source.filename}
            className={`truncate cursor-pointer text-xs ${isSelected ? 'text-white font-medium' : 'text-zinc-300'}`}
            onClick={() => onToggleSource(source.id)}
          >
            {source.filename}
          </span>
          <span className="text-[10px] text-zinc-500 shrink-0">
            ({source.word_count || 0} pal.)
          </span>
        </div>

        {isManagementMode && onMoveSource && (
          <button
            type="button"
            title="Mover a carpeta/proyecto"
            onClick={() => onMoveSource(source)}
            className="px-2 py-0.5 rounded text-[11px] text-zinc-300 bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer ml-2"
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
    <div className="flex flex-col gap-3 w-full">
      {/* Global Toolbar for Selection */}
      {(onSelectAll || onDeselectAll) && (
        <div className="flex items-center justify-between pb-2 border-b border-white/10 text-xs">
          <div className="text-amber-400 font-semibold flex items-center gap-1.5">
            <i className="fa-solid fa-layer-group"></i> {selectedSourceIds.size} de {transcriptions.length} fuentes activas
          </div>
          <div className="flex items-center gap-2">
            {onSelectAll && (
              <button
                type="button"
                className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-white text-[11px] font-medium cursor-pointer transition-colors"
                onClick={onSelectAll}
              >
                <i className="fa-solid fa-check-double mr-1"></i> Marcar Todo
              </button>
            )}
            {onDeselectAll && (
              <button
                type="button"
                className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-white text-[11px] font-medium cursor-pointer transition-colors"
                onClick={onDeselectAll}
              >
                <i className="fa-solid fa-xmark mr-1"></i> Desmarcar
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
          <div key={project.id} className="flex flex-col mb-1">
            <div className="flex items-center justify-between p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs">
              <div className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                <span onClick={() => toggleProjectCollapse(projectKey)} className="w-4 text-amber-500 text-center">
                  <i className={`fa-solid ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'}`}></i>
                </span>

                <input 
                  type="checkbox" 
                  className="accent-amber-500 rounded cursor-pointer w-3.5 h-3.5"
                  checked={isFullySelected}
                  ref={el => { if (el) el.indeterminate = isPartiallySelected; }}
                  onChange={handleProjectCheckboxChange}
                />

                <span onClick={() => toggleProjectCollapse(projectKey)} className="text-amber-500">
                  <i className="fa-solid fa-diagram-project"></i>
                </span>
                <span onClick={() => toggleProjectCollapse(projectKey)} className="font-bold text-white truncate">
                  {project.name}
                </span>
                <span className="text-[11px] text-emerald-400 font-medium shrink-0">
                  ({allProjectSourceIds.length} fuentes)
                </span>
              </div>

              {isManagementMode && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {onCreateFolder && (
                    <button
                      type="button"
                      title="Crear Carpeta en Proyecto"
                      onClick={() => onCreateFolder(project.id, null)}
                      className="px-2 py-0.5 text-[11px] rounded bg-sky-500/15 text-sky-400 border border-sky-500/30 font-medium cursor-pointer"
                    >
                      <i className="fa-solid fa-folder-plus mr-1"></i> Carpeta
                    </button>
                  )}
                  {onDeleteProject && (
                    <button
                      type="button"
                      title="Eliminar Proyecto"
                      onClick={() => onDeleteProject(project.id)}
                      className="px-2 py-0.5 text-[11px] rounded bg-red-500/15 text-red-400 border border-red-500/30 cursor-pointer"
                    >
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  )}
                </div>
              )}
            </div>

            {!isCollapsed && (
              <div className="mt-1 space-y-1">
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
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.03] border border-white/10 text-xs">
          <div 
            onClick={() => toggleProjectCollapse('proj_general')} 
            className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
          >
            <span className="w-4 text-zinc-400 text-center">
              <i className={`fa-solid ${collapsedProjects['proj_general'] ? 'fa-chevron-right' : 'fa-chevron-down'}`}></i>
            </span>
            <span className="text-zinc-400">
              <i className="fa-solid fa-folder-open"></i>
            </span>
            <span className="font-semibold text-zinc-300 truncate">
              Fuentes Generales (Sin Proyecto)
            </span>
            <span className="text-[11px] text-zinc-500 shrink-0">
              ({unassignedSources.length})
            </span>
          </div>
        </div>

        {!collapsedProjects['proj_general'] && (
          <div className="mt-1 space-y-1">
            {unassignedSources.length === 0 ? (
              <div className="text-[11px] text-zinc-500 px-4 py-2 italic">
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
