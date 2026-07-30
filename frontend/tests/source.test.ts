import assert from 'node:assert/strict';
import test from 'node:test';

import { getDescendantFolderIds } from '../src/utils/source.ts';


test('collects a folder and all nested descendants without unrelated folders', () => {
  const folders = [
    { id: 1, project_id: 10, parent_id: null, name: 'raíz' },
    { id: 2, project_id: 10, parent_id: 1, name: 'hija' },
    { id: 3, project_id: 10, parent_id: 2, name: 'nieta' },
    { id: 4, project_id: 10, parent_id: null, name: 'otra' },
  ];

  assert.deepEqual([...getDescendantFolderIds(folders, 1)].sort(), [1, 2, 3]);
});
