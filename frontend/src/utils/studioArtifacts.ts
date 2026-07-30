import type { StudioResumePayload } from '../types';

export interface FlashcardItem {
  id: number;
  front: string;
  back: string;
}

export interface QuizItem {
  id: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

type ArtifactRecord = StudioResumePayload & Record<string, unknown>;

function repairJsonBackslashes(value: string): string {
  return value
    .replace(/(?<!\\)\\(?=[A-Za-z]{2,})/g, '\\\\')
    .replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, '\\\\');
}

function stripCodeFence(value: string): string {
  let text = value.trim();
  if (text.startsWith('```')) {
    const firstNewline = text.indexOf('\n');
    text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
  }
  if (text.trimEnd().endsWith('```')) {
    text = text.trimEnd().slice(0, -3);
  }
  return text.trim();
}

function parseModelJson(value: string): unknown | null {
  const text = stripCodeFence(value);
  const candidates = [text];

  // Prefer the complete item array over an individual object nested inside it.
  for (const [opening, closing] of [['[', ']'], ['{', '}']] as const) {
    const start = text.indexOf(opening);
    const end = text.lastIndexOf(closing);
    if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  }

  for (const candidate of [...new Set(candidates)]) {
    for (const attempt of [candidate, repairJsonBackslashes(candidate)]) {
      try {
        return JSON.parse(attempt);
      } catch {
        // Try the next candidate or repaired representation.
      }
    }
  }
  return null;
}

function recoverCompleteObjects(value: string): Record<string, unknown>[] {
  const text = stripCodeFence(value);
  const starts: number[] = [];
  const recovered: Record<string, unknown>[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      starts.push(index);
    } else if (character === '}' && starts.length > 0) {
      const start = starts.pop();
      if (start === undefined) continue;
      const fragment = text.slice(start, index + 1);
      for (const attempt of [fragment, repairJsonBackslashes(fragment)]) {
        try {
          const parsed = JSON.parse(attempt);
          const record = asRecord(parsed);
          if (record) recovered.push(record);
          break;
        } catch {
          // An outer object can still be incomplete; retain only valid inner objects.
        }
      }
    }
  }
  return recovered;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function unwrapArtifactItems(value: unknown, artifactType: 'flashcards' | 'quiz'): unknown {
  const record = asRecord(value);
  if (!record) return value;
  return record.data ?? record[artifactType] ?? record.items;
}

export function recoverFlashcards(value: unknown): FlashcardItem[] | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    candidate = parseModelJson(candidate);
  }

  const record = asRecord(candidate);
  if (record) {
    const direct = unwrapArtifactItems(record, 'flashcards');
    if (direct !== undefined) candidate = direct;
    if (!Array.isArray(candidate) && typeof record.content === 'string') {
      candidate = unwrapArtifactItems(parseModelJson(record.content), 'flashcards');
    }
  }

  if (!Array.isArray(candidate) || candidate.length === 0) return null;

  const cards: FlashcardItem[] = [];
  for (const [index, item] of candidate.entries()) {
    const itemRecord = asRecord(item);
    const front = typeof itemRecord?.front === 'string' ? itemRecord.front.trim() : '';
    const back = typeof itemRecord?.back === 'string' ? itemRecord.back.trim() : '';
    if (!front || !back) return null;
    cards.push({ id: index + 1, front, back });
  }
  return cards;
}

export function recoverQuiz(value: unknown): QuizItem[] | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    candidate = parseModelJson(candidate) ?? recoverCompleteObjects(candidate);
  }

  const record = asRecord(candidate);
  if (record) {
    const direct = unwrapArtifactItems(record, 'quiz');
    if (direct !== undefined) candidate = direct;
    if (!Array.isArray(candidate) && typeof record.content === 'string') {
      const parsedContent = parseModelJson(record.content) ?? recoverCompleteObjects(record.content);
      candidate = unwrapArtifactItems(parsedContent, 'quiz');
    }
  }
  if (!Array.isArray(candidate) || candidate.length === 0) return null;

  const questions: QuizItem[] = [];
  for (const item of candidate) {
    const itemRecord = asRecord(item);
    const question = typeof itemRecord?.question === 'string' ? itemRecord.question.trim() : '';
    const options = Array.isArray(itemRecord?.options)
      ? itemRecord.options.map(option => typeof option === 'string' ? option.trim() : '')
      : [];
    const correctIndex = itemRecord?.correct_index;
    const explanation = typeof itemRecord?.explanation === 'string' ? itemRecord.explanation.trim() : '';
    if (
      !question || options.length < 2 || options.some(option => !option)
      || !Number.isInteger(correctIndex) || Number(correctIndex) < 0 || Number(correctIndex) >= options.length
    ) continue;
    questions.push({
      id: questions.length + 1,
      question,
      options,
      correct_index: Number(correctIndex),
      explanation,
    });
  }
  return questions.length > 0 ? questions : null;
}

export function normalizeStudioArtifact(value: unknown, fallbackArtifactType = 'briefing'): ArtifactRecord {
  const parsedValue = typeof value === 'string' ? parseModelJson(value) : value;
  const record = asRecord(parsedValue) ?? { content: typeof value === 'string' ? value : '' };
  const artifactType = typeof record.artifact_type === 'string'
    ? record.artifact_type
    : fallbackArtifactType;

  if (artifactType === 'flashcards' || record.type === 'flashcards') {
    const cards = recoverFlashcards(record);
    if (cards) {
      return { ...record, type: 'flashcards', artifact_type: 'flashcards', data: cards };
    }
  }

  if (artifactType === 'quiz' || record.type === 'quiz') {
    const questions = recoverQuiz(record);
    if (questions) {
      return { ...record, type: 'quiz', artifact_type: 'quiz', data: questions };
    }
  }

  return {
    ...record,
    type: 'markdown',
    artifact_type: artifactType,
    content: typeof record.content === 'string'
      ? record.content
      : typeof value === 'string' ? value : '',
  };
}
