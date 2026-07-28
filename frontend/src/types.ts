export interface Word {
  word: string;
  start: number;
  end: number;
  score?: number;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  words?: Word[];
}

export interface Project {
  id: number;
  name: string;
  description?: string;
  created_at?: string;
}

export interface Folder {
  id: number;
  project_id: number;
  parent_id?: number | null;
  name: string;
  created_at?: string;
}

export interface Transcription {
  id: number;
  filename: string;
  created_at: string;
  char_count?: number;
  word_count?: number;
  token_estimate?: number;
  chunk_count?: number;
  filepath?: string;
  summary?: string;
  summary_mode?: string;
  is_generating?: boolean;
  segments?: Segment[];
  project_id?: number | null;
  folder_id?: number | null;
}

export interface StatusData {
  is_running?: boolean;
  current_stage?: string;
  current_progress?: string;
  progress?: number;
  progress_text?: string;
  gpu_name?: string;
  device_name?: string;
  llm_model?: string;
  has_hf_token?: boolean;
  vram_allocated_mb?: number;
  vram_reserved_mb?: number;
  cpu_percent?: number;
  ram_process_mb?: number;
  status?: string;
  backend?: string;
  transcribe_device?: string;
  logs?: string[];
}

export interface SearchResult {
  chunk_id?: number;
  transcription_id?: number;
  filename: string;
  text: string;
  similarity: number;
}

export interface WebSource {
  title: string;
  url: string;
  domain: string;
  snippet?: string;
}

export interface CitationItem {
  num: number;
  source_id: number;
  filename: string;
  chunk_id: number;
  snippet: string;
  full_text: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: SearchResult[] | null;
  web_sources?: WebSource[] | null;
  citations?: CitationItem[] | null;
  search_logs?: string[] | null;
}

export interface ChunkItem {
  id: number;
  chunk_index: number;
  text: string;
  char_count: number;
}

export interface ChatSession {
  id: string;
  title: string;
  context_sources?: string;
  created_at?: string;
  message_count?: number;
}

export interface NoteItem {
  id: number;
  title: string;
  content: string;
  source_type: string;
  created_at: string;
}

