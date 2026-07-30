import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeStudioArtifact, recoverFlashcards, recoverQuiz } from '../src/utils/studioArtifacts.ts';


test('recovers legacy flashcards containing unescaped LaTeX commands', () => {
  const innerJson = '[{"id":1,"front":"¿Por qué $1/\\sqrt{d_k}$?","back":"Evita gradientes pequeños."}]';
  const savedNote = JSON.stringify({
    type: 'markdown',
    artifact_type: 'flashcards',
    content: `# 🎴 Flashcards Generadas\n\n${innerJson}`,
  });

  const artifact = normalizeStudioArtifact(savedNote, 'flashcards');

  assert.equal(artifact.type, 'flashcards');
  assert.ok(Array.isArray(artifact.data));
  assert.equal(artifact.data.length, 1);
  assert.equal((artifact.data[0] as { front: string }).front, '¿Por qué $1/\\sqrt{d_k}$?');
});

test('keeps an unrecoverable fallback visible as markdown instead of an empty player', () => {
  const artifact = normalizeStudioArtifact({
    type: 'markdown',
    artifact_type: 'flashcards',
    content: '# Flashcards\n\nRespuesta que no contiene tarjetas estructuradas.',
  }, 'flashcards');

  assert.equal(artifact.type, 'markdown');
  assert.match(String(artifact.content), /Respuesta que no contiene/);
});

test('reads canonical notebook flashcards', () => {
  const cards = recoverFlashcards(JSON.stringify({
    type: 'flashcards',
    artifact_type: 'flashcards',
    data: [{ id: 7, front: 'Anverso', back: 'Reverso' }],
  }));

  assert.deepEqual(cards, [{ id: 1, front: 'Anverso', back: 'Reverso' }]);
});

test('recovers complete quiz questions from a legacy truncated response', () => {
  const raw = '# Examen\n\n{"data":['
    + '{"id":1,"question":"¿Primera?","options":["A","B"],"correct_index":0,"explanation":"A."},'
    + '{"id":2,"question":"¿Segunda?","options":["C","D"],"correct_index":1,"explanation":"D."},'
    + '{"id":3,"question":"Sin terminar","options":["E"';

  const questions = recoverQuiz(raw);

  assert.equal(questions?.length, 2);
  assert.equal(questions?.[0].question, '¿Primera?');
  assert.equal(questions?.[1].correct_index, 1);
});

test('normalizes a saved truncated quiz into an interactive artifact', () => {
  const raw = JSON.stringify({
    type: 'markdown',
    artifact_type: 'quiz',
    content: '# Examen\n\n{"data":[{"id":1,"question":"¿Pregunta?","options":["A","B"],"correct_index":0,"explanation":"A."},{"id":2',
  });

  const artifact = normalizeStudioArtifact(raw, 'quiz');

  assert.equal(artifact.type, 'quiz');
  assert.equal((artifact.data as unknown[])?.length, 1);
});
