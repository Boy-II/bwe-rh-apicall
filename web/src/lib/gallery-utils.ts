import type { ImageModel, ModelParam, TemplateDetail, TemplateMode } from './types';

export const COMMON_FIELDS = ['resolution', 'aspectRatio', 'size', 'outputFormat', 'output_format'];

const modeFor = (hasImages: boolean) => (hasImages ? 'image-to-image' : 'text-to-image');

/** 下拉選單選項：依是否有參考圖取對應模式，依顯示名稱去重並保持清單順序。 */
export function modelOptions(
  models: Pick<ImageModel, 'key' | 'displayName' | 'mode'>[],
  hasImages: boolean,
): { displayName: string; key: string }[] {
  const seen = new Set<string>();
  const out: { displayName: string; key: string }[] = [];
  for (const m of models) {
    if (m.mode !== modeFor(hasImages) || seen.has(m.displayName)) continue;
    seen.add(m.displayName);
    out.push({ displayName: m.displayName, key: m.key });
  }
  return out;
}

export function pickModelKey(
  models: Pick<ImageModel, 'key' | 'displayName' | 'mode'>[],
  displayName: string,
  hasImages: boolean,
): string | null {
  return models.find((m) => m.displayName === displayName && m.mode === modeFor(hasImages))?.key ?? null;
}

export function splitParams(params: ModelParam[]): { common: ModelParam[]; advanced: ModelParam[] } {
  const rest = params.filter((p) => p.fieldKey !== 'prompt' && p.type !== 'IMAGE');
  return {
    common: rest.filter((p) => COMMON_FIELDS.includes(p.fieldKey)),
    advanced: rest.filter((p) => !COMMON_FIELDS.includes(p.fieldKey)),
  };
}

export function imageField(params: ModelParam[]): ModelParam | undefined {
  return params.find((p) => p.type === 'IMAGE');
}

export function languageAction(
  t: Pick<TemplateDetail, 'promptEn' | 'promptZh'>,
  lang: 'en' | 'zh',
): 'insert' | 'generate' | 'none' {
  const mine = lang === 'en' ? t.promptEn : t.promptZh;
  const other = lang === 'en' ? t.promptZh : t.promptEn;
  if (mine) return 'insert';
  return other ? 'generate' : 'none';
}

export function requiresReference(mode: TemplateMode | undefined): boolean {
  return mode === 'i2i' || mode === 'edit';
}

export interface TemplateFilters {
  category?: string;
  tag?: string;
  mode?: string;
  q?: string;
  favorites?: boolean;
  offset?: number;
}

export function templateQuery(f: TemplateFilters): string {
  const p = new URLSearchParams();
  if (f.category) p.set('category', f.category);
  if (f.tag) p.set('tag', f.tag);
  if (f.mode) p.set('mode', f.mode);
  if (f.q?.trim()) p.set('q', f.q.trim());
  if (f.favorites) p.set('favorites', '1');
  if (f.offset !== undefined) p.set('offset', String(f.offset));
  return p.toString();
}

const CJK = /[㐀-鿿豈-﫿]/g;

/** 與後端 template_import.is_cjk 同規則：CJK 字元佔非空白字元 ≥ 30%。 */
export function isCjk(text: string): boolean {
  const chars = text.replace(/\s/g, '');
  if (!chars) return false;
  return (text.match(CJK)?.length ?? 0) / chars.length >= 0.3;
}
