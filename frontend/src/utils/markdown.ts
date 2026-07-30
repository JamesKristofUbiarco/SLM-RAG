import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const marked = new Marked({ breaks: true, gfm: true });

/** Convert untrusted Markdown from models or documents to inert HTML. */
export function markdownToSafeHtml(
  source: string,
  transform?: (html: string) => string,
): string {
  const parsed = marked.parse(source || '') as string;
  const transformed = transform ? transform(parsed) : parsed;
  return DOMPurify.sanitize(transformed, {
    USE_PROFILES: { html: true },
    ALLOW_DATA_ATTR: true,
  });
}
