import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import { useAuth, isAdmin } from '@/lib/auth-store';
import { MODEL_LABELS, type ModelLabel, type TemplateCategory, type TemplateDetail, type TemplateMode } from '@/lib/types';

interface Props {
  templateId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function TemplateEditDialog({ templateId, onClose, onSaved }: Props) {
  const admin = isAdmin(useAuth((s) => s.user));
  const [t, setT] = useState<TemplateDetail | null>(null);
  const [cats, setCats] = useState<TemplateCategory[]>([]);
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!templateId) return;
    setT(null);
    api.templates.categories().then(setCats).catch(() => setCats([]));
    api.templates
      .get(templateId)
      .then((d) => {
        setT(d);
        setTags(d.tags.join('、'));
      })
      .catch((e) => toast.error((e as Error).message));
  }, [templateId]);

  const save = async () => {
    if (!t) return;
    setSaving(true);
    try {
      await api.templates.update(t.id, {
        title: t.title,
        categoryId: t.categoryId,
        tags: tags.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean),
        mode: t.mode,
        promptEn: t.promptEn,
        promptZh: t.promptZh,
        modelLabel: t.modelLabel,
      });
      toast.success('範本已更新');
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const replaceImage = async (file: File | undefined) => {
    if (!file || !t) return;
    try {
      const r = await api.adminTemplates.replaceImage(t.id, file);
      setT({ ...t, imageUrl: r.imageUrl, thumbUrl: r.thumbUrl });
      toast.success('圖片已更換');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={!!templateId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>編輯範本</DialogTitle>
        </DialogHeader>
        {!t ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <img src={t.thumbUrl} alt={t.title} className="w-24 rounded" />
              {admin && (
                <label className="cursor-pointer text-xs text-primary underline">
                  更換圖片
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => replaceImage(e.target.files?.[0])} />
                </label>
              )}
            </div>
            <label className="block space-y-1">
              <span className="font-medium">標題</span>
              <Input value={t.title} maxLength={60} onChange={(e) => setT({ ...t, title: e.target.value })} />
            </label>
            <div className="flex gap-3">
              <label className="block flex-1 space-y-1">
                <span className="font-medium">分類</span>
                <select className="h-9 w-full rounded-md border border-input bg-background px-2" value={t.categoryId || ''} onChange={(e) => setT({ ...t, categoryId: e.target.value || null })}>
                  <option value="">未分類</option>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block flex-1 space-y-1">
                <span className="font-medium">模式</span>
                <select className="h-9 w-full rounded-md border border-input bg-background px-2" value={t.mode === 'edit' ? 'i2i' : t.mode} onChange={(e) => setT({ ...t, mode: e.target.value as TemplateMode })}>
                  <option value="t2i">文生圖</option>
                  <option value="i2i">圖生圖</option>
                  <option value="edit">編輯</option>
                </select>
              </label>
            </div>
            <label className="block space-y-1">
              <span className="font-medium">使用模型</span>
              <select className="h-9 w-full rounded-md border border-input bg-background px-2" value={t.modelLabel} onChange={(e) => setT({ ...t, modelLabel: e.target.value as ModelLabel })}>
                  <option value="">{'不標示'}</option>
                  {MODEL_LABELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
            </label>
            <label className="block space-y-1">
              <span className="font-medium">標籤（以頓號或逗號分隔）</span>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="font-medium">英文提示詞</span>
              <Textarea rows={5} value={t.promptEn} onChange={(e) => setT({ ...t, promptEn: e.target.value })} />
            </label>
            <label className="block space-y-1">
              <span className="font-medium">中文提示詞</span>
              <Textarea rows={5} value={t.promptZh} onChange={(e) => setT({ ...t, promptZh: e.target.value })} />
            </label>
          </div>
        )}
        <DialogFooter>
          <Button onClick={save} disabled={!t || saving}>
            {saving ? '儲存中…' : '儲存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
