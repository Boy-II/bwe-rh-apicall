import { useState } from 'react';
import { Check, Heart, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { TemplateSummary } from '@/lib/types';

const MODE_LABEL: Record<string, string> = { t2i: '文生圖', i2i: '圖生圖', edit: '圖生圖' };

interface Props {
  t: TemplateSummary;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** 批次選取模式：有傳入時點卡片改為切換選取 */
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function TemplateTile({ t, onOpen, onToggleFavorite, onEdit, onDelete, selected, onToggleSelect }: Props) {
  const [menu, setMenu] = useState(false);
  const selecting = !!onToggleSelect;
  return (
    <div
      className={
        'group relative mb-3 break-inside-avoid overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md ' +
        (selected ? 'border-destructive ring-2 ring-destructive' : 'border-border')
      }
    >
      <button
        type="button"
        onClick={selecting ? onToggleSelect : onOpen}
        aria-pressed={selecting ? !!selected : undefined}
        className="block w-full text-left"
      >
        <img src={t.thumbUrl} alt={t.title} loading="lazy" className="block w-full bg-muted" />
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="line-clamp-2 flex-1 text-sm font-medium">{t.title}</span>
          {t.mode !== 't2i' && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {MODE_LABEL[t.mode]}
            </span>
          )}
        </div>
        <div className="px-3 pb-2 font-mono text-[10px] leading-tight text-muted-foreground" aria-label={`卡片編號：${t.id}`}>
          #{t.id}
        </div>
      </button>
      {t.modelLabel && (
        <span
          aria-label={`使用模型：${t.modelLabel}`}
          className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm"
        >
          {t.modelLabel}
        </span>
      )}
      {selecting && (
        <span
          aria-hidden
          className={
            'pointer-events-none absolute right-2 top-2 flex size-6 items-center justify-center rounded-full border-2 border-white shadow ' +
            (selected ? 'bg-destructive text-white' : 'bg-black/30')
          }
        >
          {selected && <Check className="size-4" />}
        </span>
      )}
      <div className={'absolute right-2 top-2 flex gap-1 ' + (selecting ? 'hidden' : '')}>
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
