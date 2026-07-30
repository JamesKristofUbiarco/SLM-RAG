import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCitationGroups, renderCitationBadgesInHtml } from '../src/utils/citations.ts';


test('normalizes grouped citations from existing conversations', () => {
  assert.equal(
    normalizeCitationGroups('Datos [2, 3, 5] y [1; 3].'),
    'Datos [2][3][5] y [1][3].',
  );
});

test('renders every grouped source as an independent clickable badge', () => {
  const html = renderCitationBadgesInHtml('<p>Mbappé marcó diez [2, 3, 5].</p>');

  assert.equal((html.match(/data-citation=/g) || []).length, 3);
  assert.match(html, /data-citation="2"/);
  assert.match(html, /data-citation="3"/);
  assert.match(html, /data-citation="5"/);
});

test('distinguishes local and web citations in labels and click metadata', () => {
  const html = renderCitationBadgesInHtml('<p>Interna [Local 2], externa [Web 1] y grupo [W2, 3].</p>');

  assert.match(html, /data-citation="2" data-citation-kind="local"/);
  assert.match(html, /data-citation="1" data-citation-kind="web"/);
  assert.match(html, />\[L2\]<\/button>/);
  assert.match(html, />\[W1\]<\/button>/);
  assert.match(html, />\[W3\]<\/button>/);
});
