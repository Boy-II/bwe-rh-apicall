import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import { isCjk } from '@/lib/gallery-utils';
import type { TemplateCategory, TemplateMode } from '@/lib/types';

interface Props {
  open: boolean;
  taskId: string;
  resultIndex: number;
  prompt: string;
  defaultMode: TemplateMode;
  onClose: () => void;
  onSaved: () => void;
}

export function SaveTemplateDialog({ open, taskId, resultIndex, prompt, defaultMode, onClose, onSaved }: Props) {
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('creative');
  const [tags, setTags] = useState('');
  const [mode, setMode] = useState<TemplateMode>(defaultMode);
  const [text, setText] = useState(prompt);
  const [suggesting, setSuggesting] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.templates.categories().then(setCategories).catch(() => setCategories([]));
    api.prompt
      .suggestMeta(prompt)
      .then((m) => {
        setTitle((t) => t || m.title);
        setCategoryId(m.categoryId);
        setTags(m.tags.join('、'));
        // 介面只分文生圖／圖生圖；有參考圖就是圖生圖
        setMode(defaultMode === 'i2i' || m.mode !== 't2i' ? 'i2i' : 't2i');
      })
      .catch(() => {
        /* 建議失敗就讓使用者自己填 */
      })
      .finally(() => setSuggesting(false));
  }, [prompt, defaultMode]);

  const save = async () => {
    if (!title.trim()) {
      toast.error('請填標題');
      return;
    }
    setSaving(true);
    const zh = isCjk(text);
    try {
      await api.templates.save({
        taskId,
        resultIndex,
        title: title.trim(),
        categoryId,
        tags: tags.split(/[、,，\s]+/).map((t) => t.trim()).filter(Boolean),
        mode,
        promptEn: zh ? '' : text,
        promptZh: zh ? text : '',
      });
      toast.success('已存進範本庫');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>保存進範本庫</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {suggesting && <p className="text-xs text-muted-foreground">AI 正在建議標題與分類…</p>}
          <label className="block space-y-1">
            <span className="font-medium">標題</span>
            <Input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="flex gap-3">
            <label className="block flex-1 space-y-1">
              <span className="font-medium">分類</span>
              <select className="h-9 w-full rounded-md border border-input bg-background px-2" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1 space-y-1">
              <span className="font-medium">模式</span>
              <select className="h-9 w-full rounded-md border border-input bg-background px-2" value={mode} onChange={(e) => setMode(e.target.value as TemplateMode)}>
                <option value="t2i">文生圖</option>
                <option value="i2i">圖生圖</option>
              </select>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="font-medium">標籤（以頓號或逗號分隔）</span>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="font-medium">提示詞</span>
            <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving || !text.trim()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
