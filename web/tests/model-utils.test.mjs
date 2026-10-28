import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

async function sourceModule(path) {
  const text = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  return import(
    'data:text/javascript;base64,' +
      Buffer.from(
        ts.transpileModule(text, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText,
      ).toString('base64')
  );
}

test('category, mode and search intersect without losing hidden cards', async () => {
  const { filterModelCards } = await sourceModule('../src/lib/model-utils.ts');
  const cards = [
    { id: '1', title: 'Gemini', category: 'image', imageMode: 'text-to-image', tags: ['商業'] },
    { id: '2', title: 'Gemini', category: 'image', imageMode: 'image-to-image' },
    { id: '3', title: 'Video', category: 'video' },
  ];
  assert.deepEqual(
    filterModelCards(cards, 'image', 'image-to-image', 'gemini').map((x) => x.id),
    ['2'],
  );
  assert.deepEqual(
    filterModelCards(cards, 'all', '', '商業').map((x) => x.id),
    ['1'],
  );
  assert.equal(cards.length, 3);
});

test('model payload removes empty values but preserves false and zero', async () => {
  const { cleanModelPayload } = await sourceModule('../src/lib/model-utils.ts');
  assert.deepEqual(
    cleanModelPayload({ prompt: 'cat', raw: false, chaos: 0, negativePrompt: '', imageUrls: [] }),
    { prompt: 'cat', raw: false, chaos: 0 },
  );
});
