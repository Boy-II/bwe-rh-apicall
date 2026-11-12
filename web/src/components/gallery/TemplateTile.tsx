import { useState } from 'react';
import { Heart, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { TemplateSummary } from '@/lib/types';

const MODE_LABEL: Record<string, string> = { t2i: '文生圖', i2i: '圖生圖', edit: '圖生圖' };

interface Props {
  t: TemplateSummary;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function TemplateTile({ t, onOpen, onToggleFavorite, onEdit, onDelete }: Props) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="group relative mb-3 break-inside-avoid overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <img src={t.thumbUrl} alt={t.title} loading="lazy" className="block w-full bg-muted" />
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="line-clamp-2 flex-1 text-sm font-medium">{t.title}</span>
          {t.mode !== 't2i' && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {MODE_LABEL[t.mode]}
            </span>
          )}
        </div>
      </button>
      <div className="absolute right-2 top-2 flex gap-1">
        {t.canEdit && (onEdit || onDelete) && (
          <div className="relative">
            <button
              type="button"
              aria-label="更多操作"
              onClick={() => setMenu((v) => !v)}
              className="rounded-full bg-black/45 p-1.5 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </button>
            {menu && (
              <div
                className="absolute right-0 z-10 mt-1 w-28 overflow-hidden rounded-md border border-border bg-popover text-sm shadow-lg"
                onMouseLeave={() => setMenu(false)}
              >
                {onEdit && (
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted" onClick={() => { setMenu(false); onEdit(); }}>
                    <Pencil className="size-3.5" /> 編輯
                  </button>
                )}
                {onDelete && (
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-destructive hover:bg-muted" onClick={() => { setMenu(false); onDelete(); }}>
                    <Trash2 className="size-3.5" /> 刪除
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          aria-label={t.favorited ? '取消收藏' : '收藏'}
          aria-pressed={t.favorited}
          onClick={onToggleFavorite}
          className="rounded-full bg-black/45 p-1.5 text-white backdrop-blur-sm"
        >
          <Heart className={'size-4 ' + (t.favorited ? 'fill-rose-500 text-rose-500' : '')} />
        </button>
      </div>
    </div>
  );
}
