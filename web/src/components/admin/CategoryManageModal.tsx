import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import type { TemplateCategory } from '@/lib/types';

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `cat-${Date.now().toString(36)}`;

export function CategoryManageModal({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [cats, setCats] = useState<TemplateCategory[]>([]);
  const [name, setName] = useState('');
  const [id, setId] = useState('');

  const reload = () => api.templates.categories().then(setCats).catch((e) => toast.error(e.message));
  useEffect(() => {
    if (open) reload();
  }, [open]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await reload();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= cats.length) return;
    const next = [...cats];
    [next[i], next[j]] = [next[j], next[i]];
    act(() => Promise.all(next.map((c, k) => api.adminTemplates.updateCategory(c.id, { sortOrder: k }))));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>分類管理</DialogTitle>
        </DialogHeader>
        <ul className="space-y-1">
          {cats.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2">
              <Input
                defaultValue={c.name}
                className="h-8"
                onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && act(() => api.adminTemplates.updateCategory(c.id, { name: e.target.value.trim() }))}
              />
              <span className="w-10 text-right text-xs text-muted-foreground">{c.count}</span>
              <Button size="sm" variant="ghost" aria-label="上移" onClick={() => move(i, -1)}>
                <ArrowUp className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" aria-label="下移" onClick={() => move(i, 1)}>
                <ArrowDown className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="刪除"
                onClick={() => confirm(`刪除「${c.name}」？刪除後該分類的範本會變成未分類`) && act(() => api.adminTemplates.deleteCategory(c.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 border-t border-border pt-3">
          <Input
            placeholder="新分類名稱"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setId(slug(e.target.value));
            }}
          />
          <Input placeholder="id" value={id} className="w-36" onChange={(e) => setId(e.target.value)} />
          <Button
            disabled={!name.trim() || !id}
            onClick={() =>
              act(async () => {
                await api.adminTemplates.createCategory(id, name.trim());
                setName('');
                setId('');
              })
            }
          >
            新增
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
