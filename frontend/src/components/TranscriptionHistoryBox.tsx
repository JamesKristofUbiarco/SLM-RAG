import React from 'react';
import { Transcription } from '../types';

const AUDIO_VIDEO_EXTENSIONS = [
  '.mp3', '.mp4', '.wav', '.m4a', '.mkv', '.avi', '.mov', '.flac', '.ogg', '.webm', '.wma', '.aac', '.m4v'
];

const DOCUMENT_EXTENSIONS = [
  '.pdf', '.docx', '.pptx', '.txt', '.csv', '.json', '.html', '.htm', '.md', '.markdown', '.rst', '.log',
  '.py', '.js', '.ts', '.tsx', '.jsx', '.sh', '.bash', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env'
];

export function isAudioVideoTranscription(item: Transcription): boolean {
  if (!item || !item.filename) return false;
  const name = item.filename.toLowerCase();

  // 1. Check if explicitly ends with a known audio/video extension
  if (AUDIO_VIDEO_EXTENSIONS.some(ext => name.endsWith(ext))) {
    return true;
  }

  // 2. Check if explicitly ends with a document / text / web extension
  if (DOCUMENT_EXTENSIONS.some(ext => name.endsWith(ext))) {
    return false;
  }

  // 3. Exclude web ingestion files
  if (name.startsWith('web_') || name.startsWith('http://') || name.startsWith('https://')) {
    return false;
  }

  // 4. Fallback: If it has segment data or no document extension, treat as media transcription
  return Boolean(item.segments && item.segments.length > 0);
}

interface TranscriptionHistoryBoxProps {
  transcriptionList: Transcription[];
  activeTranscriptionId?: number | null;
  onLoadTranscription?: (id: number) => void;
  onDeleteTranscription?: (id: number, filename: string) => void;
  title?: string;
  subtitle?: string;
}

export default function TranscriptionHistoryBox({
  transcriptionList,
  activeTranscriptionId,
  onLoadTranscription,
  onDeleteTranscription,
  title = "Historial de Grabaciones",
  subtitle = "Carga o elimina grabaciones previamente procesadas."
}: TranscriptionHistoryBoxProps) {
  const filteredList = transcriptionList.filter(isAudioVideoTranscription);

  return (
    <div className="p-5 sm:p-6 rounded-xl bg-[#17171c]/75 border border-white/10 backdrop-blur-md shadow-xl flex flex-col gap-3 w-full min-w-0">
      <div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {subtitle && <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>}
      </div>

      <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
        {filteredList.length === 0 ? (
          <div className="text-xs text-zinc-500 text-center py-6">
            Ninguna grabación guardada.
          </div>
        ) : (
          filteredList.map((item) => (
            <div
              key={item.id}
              className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors min-w-0 ${
                activeTranscriptionId === item.id 
                  ? 'bg-amber-500/10 border-amber-500/40' 
                  : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex flex-col min-w-0 flex-1 mr-3">
                <span className="text-xs font-semibold text-amber-400 truncate" title={item.filename}>
                  {item.filename}
                </span>
                <span className="text-[11px] text-zinc-400">
                  {item.created_at?.substring(0, 16).replace('T', ' ')} ({item.word_count || 0} palabras)
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {onLoadTranscription && (
                  <button
                    type="button"
                    onClick={() => onLoadTranscription(item.id)}
                    className="px-2.5 py-1 text-xs font-medium text-white bg-white/10 hover:bg-white/20 rounded-md border border-white/10 flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <i className="fa-solid fa-folder-open text-amber-400"></i> Cargar
                  </button>
                )}
                {onDeleteTranscription && (
                  <button
                    type="button"
                    onClick={() => onDeleteTranscription(item.id, item.filename)}
                    className="px-2.5 py-1 text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-md border border-red-500/20 flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <i className="fa-solid fa-trash text-red-400"></i> Borrar
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
