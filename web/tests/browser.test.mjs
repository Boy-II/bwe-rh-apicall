import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';

const catalog = JSON.parse(
  fs.readFileSync(new URL('../../app/data/image_models.json', import.meta.url), 'utf8'),
).models;
const cards = catalog.map((m, i) => ({
  id: 'model:' + m.key,
  cardType: 'model',
  modelKey: m.key,
  promptProfile: m.profile,
  category: 'image',
  imageMode: m.mode,
  title: m.title,
  description: '測試圖片模型',
  tags: [],
  webappId: '',
  workflowId: '',
  llmNote: '',
  icon: '🎨',
  color: '#6C5CE7',
  coverUrl: '',
  editableFields: [],
  instanceType: 'default',
  maxDurationSeconds: 0,
  enableMaskEditor: false,
  sortOrder: i,
}));
cards.push(
  {
    ...cards[0],
    id: 'video',
    title: '影片測試',
    category: 'video',
    imageMode: '',
    cardType: 'webapp',
  },
  {
    ...cards[0],
    id: 'audio',
    title: '音源測試',
    category: 'audio',
    imageMode: '',
    cardType: 'webapp',
  },
);
let browser, server, mediaBackend;
const coverBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const origin = 'http://127.0.0.1:5187';
before(async () => {
  mediaBackend = createServer((req, res) => {
    if (req.url === '/covers/proxy-check.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(coverBytes);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => mediaBackend.listen(0, '127.0.0.1', resolve));
  server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5187', '--strictPort'],
    {
      cwd: new URL('..', import.meta.url),
      stdio: 'ignore',
      env: { ...process.env, RHAPI_DEV_API_URL: `http://127.0.0.1:${mediaBackend.address().port}` },
    },
  );
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(origin);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({
    headless: true,
    ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}),
  });
});
after(async () => {
  await browser?.close();
  server?.kill();
  await new Promise((resolve) => mediaBackend?.close(resolve));
});

test('cover uploads load as images through the development server', async () => {
  const response = await fetch(origin + '/covers/proxy-check.png');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^image\/png/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), coverBytes);
});

async function pageFixture(handler) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
  await context.addInitScript(() =>
    localStorage.setItem(
      'rhapi-auth',
      JSON.stringify({
        state: {
          userToken: 'test-user',
          adminToken: 'test-admin',
          user: { username: 'admin', name: '管理員', isAdmin: true },
        },
        version: 0,
      }),
    ),
  );
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (handler) {
      const custom = await handler(route, path);
      if (custom) return;
    }
    if (path === '/api/auth/verify') body = { valid: true, username: 'admin', name: '管理員' };
    else if (path === '/api/admin/verify') body = { valid: true };
    else if (path === '/api/cards') body = { cards };
    else if (path === '/api/admin/account-status')
      body = { code: 0, data: { remainMoney: '100', remainCoins: '0', currency: 'CNY' } };
    else if (path === '/api/admin/users') body = { users: [] };
    else if (path === '/api/admin/access')
      body = {
        divisions: ['健康事業處', '編輯處'],
        allowedDivisions: ['健康事業處'],
        lastSync: null,
      };
    else if (path.startsWith('/api/models/')) body = catalog.find((m) => path.endsWith(m.key));
    else body = {};
    await route.fulfill({ json: body });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(origin);
  await page.getByRole('navigation', { name: '應用分類' }).waitFor();
  return { page, context };
}

test('category filters and image modes show only the matching cards', async () => {
  const { page, context } = await pageFixture();
  try {
    await page.getByRole('button', { name: '圖片', exact: true }).click();
    await page.getByRole('button', { name: '圖生圖', exact: true }).click();
    assert.equal(await page.locator('h3').count(), 5);
    assert.equal(await page.getByRole('button', { name: '拖曳排序' }).count(), 0);
    await page.getByRole('button', { name: '音源', exact: true }).click();
    assert.equal(await page.locator('h3').count(), 1);
    assert.equal(await page.locator('h3').textContent(), '音源測試');
    await page.getByRole('button', { name: '圖片', exact: true }).click();
    await page.getByRole('button', { name: '文生圖', exact: true }).click();
    await page.screenshot({ path: '/tmp/rhapi-categories.png', fullPage: true });
  } finally {
    await context.close();
  }
});

test('real browser resizing preserves transparent PNG and never enlarges images', async () => {
  const { page, context } = await pageFixture();
  try {
    const result = await page.evaluate(async () => {
      const { prepareModelImage } = await import('/src/lib/image-compress.ts');
      const canvas = document.createElement('canvas');
      canvas.width = 4096;
      canvas.height = 1000;
      canvas.getContext('2d').fillStyle = 'rgba(255,0,0,0.5)';
      canvas.getContext('2d').fillRect(0, 0, 2048, 1000);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const output = await prepareModelImage(
        new File([blob], 'alpha.png', { type: 'image/png' }),
        10 * 1024 * 1024,
      );
      const bitmap = await createImageBitmap(output.file);
      const check = document.createElement('canvas');
      check.width = 1024;
      check.height = 250;
      check.getContext('2d').drawImage(bitmap, 0, 0);
      const alpha = check.getContext('2d').getImageData(1000, 100, 1, 1).data[3];
      const partial = check.getContext('2d').getImageData(100, 100, 1, 1).data[3];
      return { width: output.width, height: output.height, mime: output.file.type, alpha, partial };
    });
    assert.deepEqual(result, {
      width: 1024,
      height: 250,
      mime: 'image/png',
      alpha: 0,
      partial: 128,
    });
  } finally {
    await context.close();
  }
});

test('dynamic upload can remove a pending image without late response resurrection', async () => {
  let release;
  const delay = new Promise((r) => (release = r));
  let requests = 0;
  const { page, context } = await pageFixture(async (route, path) => {
    if (path === '/api/models/upload') {
      requests++;
      await delay;
      await route.fulfill({ json: { url: 'https://example.test/upload.png' } });
      return true;
    }
  });
  try {
    await page.getByRole('button', { name: /全能图片PRO（Gemini Pro） · 圖生圖/ }).click();
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.locator('main input[type=file]').setInputFiles([
      { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
      { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
    ]);
    await page.getByRole('button', { name: '移除參考圖片 2' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '送出任務' }).isDisabled(), true);
    await page.getByRole('button', { name: '移除參考圖片 1' }).click();
    release();
    await page.getByText('已上傳', { exact: true }).waitFor();
    assert.equal(await page.locator('img[alt^="參考圖片"]').count(), 1);
    assert.ok(requests >= 1);
    await page.screenshot({ path: '/tmp/rhapi-multi-image.png', fullPage: true });
  } finally {
    release();
    await context.close();
  }
});

test('assistant model target and MOSS compilation produce an applicable prompt', async () => {
  const draft = {
    width: 1024,
    height: 1024,
    bbox_coord_space: 'abs',
    bbox_format: 'xyxy',
    summary: { caption: 'cup' },
    items: [{ label: 'object', caption: 'cup', bbox: [0, 0, 100, 100] }],
  };
  const compiled =
    '{"summary":{"caption":"cup"},"items":[{"label":"object","caption":"cup","bbox":[-512,-512,-412,-412]}],"bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}';
  const { page, context } = await pageFixture(async (route, path) => {
    if (path === '/api/proxy/chat') {
      assert.equal(route.request().postDataJSON().context.promptProfile, 'moss-image');
      await route.fulfill({ json: { text: '```moss-layout\n' + JSON.stringify(draft) + '\n```' } });
      return true;
    }
    if (path === '/api/proxy/compile-moss-layout') {
      assert.deepEqual(route.request().postDataJSON().draft, draft);
      await route.fulfill({ json: { prompt: compiled, width: 1024, height: 1024 } });
      return true;
    }
  });
  try {
    await page.getByRole('button', { name: '開啟 AI 助手' }).click();
    await page.getByLabel('提示詞目標').selectOption('moss-image');
    await page.getByRole('button', { name: '生成提示詞', exact: true }).click();
    await page.locator('aside textarea').press('Enter');
    await page.getByText('畫布需設為 1024 × 1024 px；請確認工作流尺寸一致。').waitFor();
    assert.ok((await page.locator('aside').textContent()).includes('abs_centralized'));
  } finally {
    await context.close();
  }
});

test('removing an uploaded image never submits a generation form', async () => {
  let submissions = 0;
  const { page, context } = await pageFixture(async (route, path) => {
    if (path === '/api/models/upload') {
      await route.fulfill({ json: { url: 'https://example.test/upload.png' } });
      return true;
    }
    if (path === '/api/models/submit') {
      submissions++;
      await route.fulfill({ json: { taskId: 'unexpected-task' } });
      return true;
    }
    if (path === '/api/proxy/queryTaskOutputs') {
      await route.fulfill({ json: { status: 'SUCCESS', results: [] } });
      return true;
    }
  });
  try {
    await page.getByRole('button', { name: /全能图片PRO（Gemini Pro） · 圖生圖/ }).click();
    await page.getByLabel('提示詞 *').fill('保持杯子外型，只修改背景');
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.locator('main input[type=file]').setInputFiles([
      { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
      { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
    ]);
    await page.getByText('已上傳', { exact: true }).nth(1).waitFor();
    await page.getByRole('button', { name: '移除參考圖片 1' }).click();
    await page.waitForTimeout(150);
    assert.equal(submissions, 0, 'removing reference media must not start a charged task');
    assert.equal(await page.locator('img[alt^="參考圖片"]').count(), 1);
  } finally {
    await context.close();
  }
});

test('history retrieves completed outputs from a task whose polling was stopped', async () => {
  let completed = false;
  const history = {
    id: 'history-task',
    cardId: cards[0].id,
    cardTitle: '等待中的圖片',
    cardType: 'model',
    rhTaskId: 'task-history',
    status: 'QUEUED',
    results: [],
    nodeInput: [],
    createdAt: null,
  };
  const { page, context } = await pageFixture(async (route, path) => {
    if (path === '/api/users/me/tasks') {
      await route.fulfill({
        json: {
          tasks: [
            {
              ...history,
              status: completed ? 'SUCCESS' : 'QUEUED',
              results: completed
                ? [{ url: 'https://example.test/result.png', fileType: 'image' }]
                : [],
            },
          ],
        },
      });
      return true;
    }
    if (path === '/api/proxy/queryTaskOutputs') {
      assert.equal(route.request().postDataJSON().taskId, 'task-history');
      completed = true;
      await route.fulfill({
        json: {
          status: 'SUCCESS',
          results: [{ url: 'https://example.test/result.png', outputType: 'image' }],
        },
      });
      return true;
    }
  });
  try {
    await page.getByRole('button', { name: '我的歷史', exact: true }).click();
    await page.getByRole('button', { name: '更新任務狀態', exact: true }).click();
    await page.getByRole('link', { name: '下載', exact: true }).waitFor();
    assert.equal(completed, true);
  } finally {
    await context.close();
  }
});

test('MOSS draft inside an ordinary prompt fence cannot bypass compilation', async () => {
  const { page, context } = await pageFixture(async (route, path) => {
    if (path === '/api/proxy/chat') {
      await route.fulfill({
        json: {
          text: '```prompt\n{"width":1024,"height":1024,"summary":{"caption":"cup"},"items":[{"label":"object","caption":"cup","bbox":[0,0,9000,9000]}]}\n```',
        },
      });
      return true;
    }
  });
  try {
    await page.getByRole('button', { name: '開啟 AI 助手' }).click();
    await page.getByLabel('提示詞目標').selectOption('moss-image');
    await page.getByRole('button', { name: '生成提示詞', exact: true }).click();
    await page.locator('aside textarea').press('Enter');
    await page.waitForFunction(() => !document.querySelector('aside textarea')?.disabled);
    assert.equal(await page.locator('aside pre').count(), 0);
    assert.equal(
      await page
        .getByText(
          'MOSS 結構化提示詞尚未通過 Layout 編譯，請要求助手以 moss-layout 格式重新提供。',
          { exact: true },
        )
        .count(),
      1,
    );
  } finally {
    await context.close();
  }
});
