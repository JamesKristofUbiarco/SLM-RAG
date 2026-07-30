import type { CitationItem, WebSource } from '../types';

export const DISCLOSURE_CHARACTER_LIMIT = 1000;

export function isDisclosureInitiallyOpen(content: string): boolean {
  return Array.from(content).length <= DISCLOSURE_CHARACTER_LIMIT;
}

export function researchLogsText(logs: string[] | null | undefined): string {
  return (logs ?? []).join('\n');
}

export function sourcesText(
  webSources: WebSource[] | null | undefined,
  citations: CitationItem[] | null | undefined,
): string {
  const webText = (webSources ?? []).map(source => [
    `W${source.num ?? ''}`,
    source.domain,
    source.title,
    source.url,
    source.snippet ?? '',
  ].join(' '));
  const localText = (citations ?? []).map(citation => [
    `L${citation.num}`,
    citation.filename,
    citation.snippet,
  ].join(' '));
  return [...webText, ...localText].join('\n');
}
