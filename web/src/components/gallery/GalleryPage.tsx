import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import api from '@/lib/api';
import type { TemplateCategory, TemplateSummary } from '@/lib/types';
import { TemplateTile } from './TemplateTile';
import { TemplateFilters } from './TemplateFilters';

interface Props {
  favoritesOnly: boolean;
  onUse: (templateId: string) => void;
  onEdit?: (templateId: string, onSaved: () => void) => void;
  refreshKey?: number;
}

export function GalleryPage({ favoritesOnly, onUse, onEdit, refreshKey = 0 }: Props) {
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const [mode, setMode] = useState('');
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<TemplateSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.templates.categories().then(setCategories).catch((e) => toast.error(e.message));
  }, [refreshKey]);

  useEffect(() => {
    api.templates.tags(category).then(setTags).catch(() => setTags([]));
  }, [category, refreshKey]);

  // 搜尋輸入停 300ms 後才查詢
  useEffect(() => {
    const t = setTimeout(() => setQ(input), 300);
    return () => clearTimeout(t);
  }, [input]);

  const load = useCallback(
    async (offset: number, reset: boolean) => {
      const gen = reset ? ++generation.current : generation.current;
      setLoading(true);
      try {
        const page = await api.templates.list({ category, tag, mode, q, favorites: favoritesOnly, offset });
        if (gen !== generation.current) return; // 篩選已變更，丟棄舊結果
        setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
        setTotal(page.total);
        setNextOffset(page.nextOffset);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        if (gen === generation.current) setLoading(false);
      }
    },
    [category, tag, mode, q, favoritesOnly],
  );

  useEffect(() => {
    setItems([]);
    load(0, true);
  }, [load, refreshKey]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !loading && nextOffset !== null && items.length > 0) load(nextOffset, false);
    }, { rootMargin: '600px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [load, loading, nextOffset, items.length]);

  const toggleFavorite = async (t: TemplateSummary) => {
    const on = !t.favorited;
    setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, favorited: on } : x)));
    try {
      await api.templates.favorite(t.id, on);
      if (favoritesOnly && !on) setItems((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, favorited: !on } : x)));
      toast.error((e as Error).message);
    }
  };

  const remove = async (t: TemplateSummary) => {
    if (!confirm(`確定刪除範本「${t.title}」？`)) return;
    try {
      await api.templates.remove(t.id);
      setItems((prev) => prev.filter((x) => x.id !== t.id));
      setTotal((n) => n - 1);
      toast.success('範本已刪除');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{favoritesOnly ? '我的收藏' : '提示詞庫'}</h1>
          <p className="text-sm text-muted-foreground">共 {total.toLocaleString()} 個提示詞</p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="搜尋標題、提示詞、標籤…"
            className="pl-9 pr-9"
          />
          {input && (
            <button type="button" aria-label="清除搜尋" onClick={() => setInput('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>
      <div className="mb-5">
        <TemplateFilters
          categories={categories}
          tags={tags}
          category={category}
          tag={tag}
          mode={mode}
          onCategory={(id) => {
            setCategory(id);
            setTag('');
          }}
          onTag={setTag}
          onMode={setMode}
        />
      </div>
      {items.length === 0 && !loading ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          {favoritesOnly && !q && !category && !tag && !mode
            ? '點範本右上角的 ♡ 收藏常用範本'
            : '沒有符合的範本'}
        </div>
      ) : (
        <div className="columns-2 gap-3 md:columns-3 xl:columns-4">
          {items.map((t) => (
            <TemplateTile
              key={t.id}
              t={t}
              onOpen={() => onUse(t.id)}
              onToggleFavorite={() => toggleFavorite(t)}
              onEdit={onEdit ? () => onEdit(t.id, () => load(0, true)) : undefined}
              onDelete={() => remove(t)}
            />
          ))}
        </div>
      )}
      <div ref={sentinel} className="h-10" />
      {loading && <div className="py-6 text-center text-sm text-muted-foreground">載入中…</div>}
    </div>
  );
}
