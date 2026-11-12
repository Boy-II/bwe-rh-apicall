import type { TemplateCategory } from '@/lib/types';

const chip = (active: boolean) =>
  'rounded-full border px-3 py-1 text-sm transition-colors ' +
  (active
    ? 'border-primary bg-primary text-primary-foreground'
    : 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground');

const MODES = [
  ['', '全部模式'],
  ['t2i', '文生圖'],
  ['i2i', '圖生圖'],
  ['edit', '編輯'],
] as const;

interface Props {
  categories: TemplateCategory[];
  tags: { tag: string; count: number }[];
  category: string;
  tag: string;
  mode: string;
  onCategory: (id: string) => void;
  onTag: (tag: string) => void;
  onMode: (mode: string) => void;
}

export function TemplateFilters({ categories, tags, category, tag, mode, onCategory, onTag, onMode }: Props) {
  const total = categories.reduce((n, c) => n + c.count, 0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="分類">
        <span className="mr-1 text-xs text-muted-foreground">分類</span>
        <button type="button" className={chip(!category)} onClick={() => onCategory('')}>
          全部 <span className="opacity-70">{total}</span>
        </button>
        {categories.map((c) => (
          <button key={c.id} type="button" className={chip(category === c.id)} onClick={() => onCategory(c.id)}>
            {c.name} <span className="opacity-70">{c.count}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="標籤">
        <span className="mr-1 text-xs text-muted-foreground">標籤</span>
        {tags.map((t) => (
          <button key={t.tag} type="button" className={chip(tag === t.tag)} onClick={() => onTag(tag === t.tag ? '' : t.tag)}>
            #{t.tag}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        {MODES.map(([key, label]) => (
          <button key={key} type="button" className={chip(mode === key)} onClick={() => onMode(key)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
