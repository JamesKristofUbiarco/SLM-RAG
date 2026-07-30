import type { Folder, Transcription } from '../types';

const AUDIO_VIDEO_EXTENSIONS = [
  '.mp3', '.mp4', '.wav', '.m4a', '.mkv', '.avi', '.mov', '.flac', '.ogg', '.webm', '.wma', '.aac', '.m4v',
];

const DOCUMENT_EXTENSIONS = [
  '.pdf', '.docx', '.pptx', '.txt', '.csv', '.json', '.html', '.htm', '.md', '.markdown', '.rst', '.log',
  '.py', '.js', '.ts', '.tsx', '.jsx', '.sh', '.bash', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env',
];

export function isAudioVideoTranscription(item: Transcription): boolean {
  if (!item?.filename) return false;
  const name = item.filename.toLowerCase();
  if (DOCUMENT_EXTENSIONS.some(ext => name.endsWith(ext)) || name.startsWith('web_') || /^https?:\/\//.test(name)) {
    return false;
  }
  if (AUDIO_VIDEO_EXTENSIONS.some(ext => name.endsWith(ext))) {
    return true;
  }
  const firstSegment = item.segments?.[0];
  return Boolean(firstSegment && (firstSegment.start > 0 || firstSegment.end > 0));
}

export function getDescendantFolderIds(folders: Folder[], rootFolderId: number): Set<number> {
  const descendantIds = new Set<number>([rootFolderId]);
  let foundDescendant = true;
  while (foundDescendant) {
    foundDescendant = false;
    for (const folder of folders) {
      if (folder.parent_id && descendantIds.has(folder.parent_id) && !descendantIds.has(folder.id)) {
        descendantIds.add(folder.id);
        foundDescendant = true;
      }
    }
  }
  return descendantIds;
}
