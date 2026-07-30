const EXPLICIT_WEB_PATTERN = /\[(?:fuente\s+)?web\s*#?\s*(\d+)\]/gi;
const EXPLICIT_LOCAL_PATTERN = /\[(?:fuente\s+)?(?:local|cita)\s*#?\s*(\d+)\]/gi;
const GROUPED_CITATION_PATTERN = /\[((?:[LW]\s*)?\d+(?:\s*[,;]\s*(?:[LW]\s*)?\d+)+)\](?!\s*\()/gi;
const NAMESPACED_CITATION_PATTERN = /\[([LW])(\d+)\]/gi;
const SINGLE_CITATION_PATTERN = /\[(\d+)\]/g;


/** Turn grouped model citations into one marker per source. */
export function normalizeCitationGroups(text: string): string {
  if (!text) return text;
  const normalizedAliases = text
    .replace(EXPLICIT_WEB_PATTERN, '[W$1]')
    .replace(EXPLICIT_LOCAL_PATTERN, '[L$1]');

  return normalizedAliases.replace(GROUPED_CITATION_PATTERN, (_match, group: string) => {
    const tokens = [...group.matchAll(/([LW]?)\s*(\d+)/gi)];
    const inheritedNamespace = tokens.find(token => token[1])?.[1].toUpperCase() || '';
    const uniqueMarkers = [...new Set(tokens.map(token => `${token[1].toUpperCase() || inheritedNamespace}${token[2]}`))];
    return uniqueMarkers.map(marker => `[${marker}]`).join('');
  });
}


/** Replace normalized citation markers in parsed Markdown with clickable controls. */
export function renderCitationBadgesInHtml(html: string): string {
  const namespaced = normalizeCitationGroups(html).replace(
    NAMESPACED_CITATION_PATTERN,
    (_match, rawNamespace: string, number: string) => {
      const namespace = rawNamespace.toUpperCase();
      const isWeb = namespace === 'W';
      const kind = isWeb ? 'web' : 'local';
      const classes = isWeb
        ? 'text-sky-950 bg-sky-400 hover:bg-sky-300'
        : 'text-zinc-950 bg-amber-400 hover:bg-amber-300';
      const label = `[${namespace}${number}]`;
      return `<button type="button" data-citation="${number}" data-citation-kind="${kind}" class="citation-badge inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 text-[10px] font-bold ${classes} rounded cursor-pointer transition-all shadow-sm active:scale-95" title="Ver ${isWeb ? 'Fuente Web' : 'Fuente Local'} ${label}">${label}</button>`;
    },
  );

  return namespaced.replace(
    SINGLE_CITATION_PATTERN,
    '<button type="button" data-citation="$1" data-citation-kind="legacy" class="citation-badge inline-flex items-center justify-center px-1.5 py-0.5 mx-0.5 text-[10px] font-bold text-zinc-950 bg-zinc-300 hover:bg-zinc-200 rounded cursor-pointer transition-all shadow-sm active:scale-95" title="Ver cita antigua [$1]">[$1]</button>',
  );
}
