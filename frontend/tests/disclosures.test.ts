import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DISCLOSURE_CHARACTER_LIMIT,
  isDisclosureInitiallyOpen,
  researchLogsText,
  sourcesText,
} from '../src/utils/disclosures.ts';


test('opens content with at most one thousand characters', () => {
  assert.equal(DISCLOSURE_CHARACTER_LIMIT, 1000);
  assert.equal(isDisclosureInitiallyOpen('a'.repeat(999)), true);
  assert.equal(isDisclosureInitiallyOpen('a'.repeat(1000)), true);
});

test('closes content with more than one thousand characters', () => {
  assert.equal(isDisclosureInitiallyOpen('a'.repeat(1001)), false);
});

test('counts Unicode characters instead of UTF-16 code units', () => {
  assert.equal(isDisclosureInitiallyOpen('🕷'.repeat(600)), true);
  assert.equal(isDisclosureInitiallyOpen('🕷'.repeat(1001)), false);
});

test('builds measurable text for research logs and both source namespaces', () => {
  assert.equal(researchLogsText(['primero', 'segundo']), 'primero\nsegundo');
  const content = sourcesText(
    [{ num: 1, domain: 'example.com', title: 'Fuente web', url: 'https://example.com', snippet: 'dato' }],
    [{ num: 1, source_id: 1, filename: 'local.mp3', chunk_id: 2, snippet: 'fragmento', full_text: 'texto' }],
  );

  assert.match(content, /W1 example\.com Fuente web/);
  assert.match(content, /L1 local\.mp3 fragmento/);
});
