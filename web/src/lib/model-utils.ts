import type { Card, Category, ImageMode, ModelValue } from './types';

export const PROMPT_PROFILES = [
  ['generic', '一般／自動'],
  ['gemini-pro', 'Gemini Pro'],
  ['gemini-flash', 'Gemini Flash'],
  ['midjourney-v7', 'Midjourney v7'],
  ['gpt-image-2', 'GPT Image 2'],
  ['seedream', 'Seedream（即夢）'],
  ['krea2', 'Krea2（開源）'],
  ['moss-image', 'MOSS-Image（開源）'],
] as const;

export function filterModelCards<
  T extends Pick<Card, 'title' | 'description' | 'tags' | 'category' | 'imageMode'>,
>(cards: T[], category: Category | 'all', mode: ImageMode, search: string): T[] {
  const q = search.trim().toLowerCase();
  return cards.filter(
    (c) =>
      (category === 'all' || (c.category || 'image') === category) &&
      (!mode || c.imageMode === mode) &&
      (!q ||
        [c.title, c.description, ...(c.tags || [])].some((v) =>
          (v || '').toLowerCase().includes(q),
        )),
  );
}

export function cleanModelPayload(values: Record<string, ModelValue>): Record<string, ModelValue> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== '' && !(Array.isArray(v) && v.length === 0)),
  );
}

export const FIELD_LABELS: Record<string, string> = {
  prompt: '提示詞',
  negativePrompt: '負向提示詞',
  imageUrls: '參考圖片',
  imageUrl: '底圖',
  sref: '風格參考圖',
  oref: '角色參考圖',
  resolution: '解析度',
  aspectRatio: '圖片比例',
  width: '寬度（px）',
  height: '高度（px）',
  quality: '品質',
  outputFormat: '輸出格式',
  chaos: '變化程度',
  stylize: '風格化強度',
  weird: '創意程度',
  raw: '原始模式',
  iw: '底圖權重',
  sw: '風格權重',
  sv: '風格版本',
  ow: '角色權重',
  tile: '無縫圖案',
};
