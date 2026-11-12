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

const u = await sourceModule('../src/lib/gallery-utils.ts');

const models = [
  { key: 'gp-t', displayName: 'Gemini Pro', mode: 'text-to-image', params: [] },
  { key: 'gp-i', displayName: 'Gemini Pro', mode: 'image-to-image', params: [] },
  { key: 'gpt-t', displayName: 'GPT Image 2', mode: 'text-to-image', params: [] },
  { key: 'omni-t', displayName: 'Omni', mode: 'text-to-image', params: [] },
  { key: 'gpt-i', displayName: 'GPT Image 2', mode: 'image-to-image', params: [] },
];

test('modelOptions dedupes by name and filters by image presence', () => {
  assert.deepEqual(
    u.modelOptions(models, false).map((o) => [o.displayName, o.key]),
    [['Gemini Pro', 'gp-t'], ['GPT Image 2', 'gpt-t'], ['Omni', 'omni-t']],
  );
  assert.deepEqual(u.modelOptions(models, true).map((o) => o.key), ['gp-i', 'gpt-i']);
});

test('pickModelKey resolves name + mode, null when missing', () => {
  assert.equal(u.pickModelKey(models, 'GPT Image 2', true), 'gpt-i');
  assert.equal(u.pickModelKey(models, 'Omni', true), null);
});

test('splitParams keeps common fields visible and the rest advanced', () => {
  const params = [
    { fieldKey: 'prompt', type: 'STRING' },
    { fieldKey: 'imageUrls', type: 'IMAGE' },
    { fieldKey: 'resolution', type: 'LIST' },
    { fieldKey: 'aspectRatio', type: 'LIST' },
    { fieldKey: 'quality', type: 'LIST' },
    { fieldKey: 'size', type: 'LIST' },
  ];
  const { common, advanced } = u.splitParams(params);
  assert.deepEqual(common.map((p) => p.fieldKey), ['resolution', 'aspectRatio', 'size']);
  assert.deepEqual(advanced.map((p) => p.fieldKey), ['quality']);
});

test('languageAction insert / generate / none', () => {
  assert.equal(u.languageAction({ promptEn: 'a', promptZh: '' }, 'en'), 'insert');
  assert.equal(u.languageAction({ promptEn: 'a', promptZh: '' }, 'zh'), 'generate');
  assert.equal(u.languageAction({ promptEn: '', promptZh: '' }, 'zh'), 'none');
});

test('requiresReference only for i2i/edit', () => {
  assert.equal(u.requiresReference('i2i'), true);
  assert.equal(u.requiresReference('edit'), true);
  assert.equal(u.requiresReference('t2i'), false);
  assert.equal(u.requiresReference(undefined), false);
});

test('templateQuery omits empty values', () => {
  assert.equal(u.templateQuery({ category: 'ad-kv', tag: '', q: '貓', favorites: false, offset: 0 }), 'category=ad-kv&q=%E8%B2%93&offset=0');
  assert.equal(u.templateQuery({ favorites: true }), 'favorites=1');
});

test('isCjk matches backend rule', () => {
  assert.equal(u.isCjk('竖版 9:16 等距剖面信息图'), true);
  assert.equal(u.isCjk('A neon poster that says "營業中"'), false);
  assert.equal(u.isCjk(''), false);
});

test('imageField picks first IMAGE param', () => {
  assert.equal(u.imageField([{ fieldKey: 'prompt', type: 'STRING' }, { fieldKey: 'image', type: 'IMAGE', maxInputNum: 4 }])?.fieldKey, 'image');
  assert.equal(u.imageField([{ fieldKey: 'prompt', type: 'STRING' }]), undefined);
});
