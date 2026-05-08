import { Pencil, Trash2, Plus, GripVertical } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CardWithUsage } from '@/lib/card-utils';

interface Props {
  cards: CardWithUsage[];
  isAdmin: boolean;
  onSelect: (card: CardWithUsage) => void;
  onEdit?: (card: CardWithUsage) => void;
  onDelete?: (card: CardWithUsage) => void;
  onCreate?: () => void;
  onReorder?: (newOrderIds: string[]) => void;
}

function relativeTime(iso: string | null) {
  if (!iso) return '尚未使用';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '尚未使用';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '剛剛使用';
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString();
}

export function CardGrid({ cards, isAdmin, onSelect, onEdit, onDelete, onCreate, onReorder }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = cards.findIndex((c) => c.id === active.id);
    const newIndex = cards.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(cards, oldIndex, newIndex);
    onReorder?.(reordered.map((c) => c.id));
  };

  if (cards.length === 0 && !isAdmin) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
        目前沒有可用的應用卡片
      </div>
    );
  }

  const grid = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((card) => (
        <CardItem
          key={card.id}
          card={card}
          isAdmin={isAdmin}
          onSelect={onSelect}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
      {isAdmin && (
        <button
          type="button"
          onClick={onCreate}
          className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-card/40 p-5 text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-6" />
          <span className="text-sm font-medium">新增卡片</span>
        </button>
      )}
    </div>
  );

  if (!isAdmin) return grid;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={cards.map((c) => c.id)} strategy={rectSortingStrategy}>
        {grid}
      </SortableContext>
    </DndContext>
  );
}

interface CardItemProps {
  card: CardWithUsage;
  isAdmin: boolean;
  onSelect: (card: CardWithUsage) => void;
  onEdit?: (card: CardWithUsage) => void;
  onDelete?: (card: CardWithUsage) => void;
}

function CardItem({ card, isAdmin, onSelect, onEdit, onDelete }: CardItemProps) {
  const sortable = useSortable({ id: card.id, disabled: !isAdmin });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const themeColor = card.color || '#02dba3';

  return (
    <div
      ref={isAdmin ? setNodeRef : undefined}
      style={isAdmin ? style : undefined}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
        isDragging && 'shadow-2xl',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(card)}
        className="flex flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div
          className="aspect-[4/3] w-full overflow-hidden"
          style={card.coverUrl ? undefined : { backgroundColor: themeColor }}
        >
          {card.coverUrl ? (
            <img
              src={card.coverUrl}
              alt={card.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-3xl font-semibold text-white/90">
                {card.title.slice(0, 2)}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-4">
          <h3 className="text-base font-semibold leading-tight">{card.title}</h3>
          {card.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{card.description}</p>
          )}
          <div className="mt-auto pt-2 text-xs text-muted-foreground">
            {relativeTime(card.lastUsedAt)}
          </div>
        </div>
      </button>

      {isAdmin && (
        <div
          className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="inline-flex size-7 cursor-grab items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm hover:text-foreground active:cursor-grabbing"
            aria-label="拖曳排序"
            title="拖曳排序"
          >
            <GripVertical className="size-3.5" />
          </button>
          <Button
            variant="secondary"
            size="icon"
            className="size-7 shadow-sm"
            onClick={() => onEdit?.(card)}
            aria-label="編輯卡片"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="size-7 text-destructive shadow-sm hover:text-destructive"
            onClick={() => onDelete?.(card)}
            aria-label="刪除卡片"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
