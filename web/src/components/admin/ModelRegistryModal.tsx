import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import type { AdminImageModel } from '@/lib/types';

const PROFILES = [
  ['generic', '一般／自動'],
  ['gemini-pro', 'Gemini Pro'],
  ['gemini-flash', 'Gemini Flash'],
  ['gpt-image-2', 'GPT Image 2'],
] as const;

const EMPTY: AdminImageModel = {
  key: '',
  displayName: '',
  mode: 'text-to-image',
  provider: 'openai',
  upstream: '',
  profile: 'generic',
  params: [{ fieldKey: 'prompt', type: 'STRING', required: true }],
  enabled: true,
  sortOrder: 100,
};

export function ModelRegistryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [models, setModels] = useState<AdminImageModel[]>([]);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [upstreamIds, setUpstreamIds] = useState<string[]>([]);
  const [edit, setEdit] = useState<{ m: AdminImageModel; params: string; isNew: boolean } | null>(null);

  const reload = async () => {
    try {
      const [list, route] = await Promise.all([api.adminModels.list(), api.adminModels.getRoute()]);
      setModels(list);
      setBaseUrl(route.baseUrl);
      setHasKey(route.hasApiKey);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  useEffect(() => {
    if (open) reload();
  }, [open]);

  const saveRoute = async () => {
    try {
      await api.adminModels.saveRoute(baseUrl, apiKey);
      setApiKey('');
      toast.success('路由設定已儲存');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const testRoute = async () => {
    try {
      setUpstreamIds((await api.adminModels.routeModels()).models);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const toggle = async (m: AdminImageModel) => {
    try {
      await api.adminModels.update(m.key, { enabled: !m.enabled });
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveModel = async () => {
    if (!edit) return;
    let params;
    try {
      params = JSON.parse(edit.params);
    } catch {
      toast.error('params 不是有效的 JSON');
      return;
    }
    const body = { ...edit.m, params };
    try {
      if (edit.isNew) await api.adminModels.create(body);
      else await api.adminModels.update(body.key, body);
      toast.success('模型已儲存');
      setEdit(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (m: AdminImageModel) => {
    if (!confirm(`確定刪除模型「${m.displayName}（${m.key}）」？`)) return;
    try {
      await api.adminModels.remove(m.key);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const set = <K extends keyof AdminImageModel>(k: K, v: AdminImageModel[K]) =>
    setEdit((e) => (e ? { ...e, m: { ...e.m, [k]: v } } : e));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>模型管理</DialogTitle>
        </DialogHeader>
        <section className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="text-sm font-semibold">OpenAI 圖片路由（OmniRoute）</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://omniroute:20128" />
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasKey ? '已設定（留空＝保留）' : 'API Key'}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={saveRoute}>
              儲存
            </Button>
            <Button size="sm" variant="outline" onClick={testRoute}>
              測試連線
            </Button>
          </div>
          {upstreamIds.length > 0 && (
            <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
              {upstreamIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
                  onClick={() => (edit ? set('upstream', id) : navigator.clipboard?.writeText(id))}
                  title={edit ? '填入上游模型 ID' : '複製'}
                >
                  {id}
                </button>
              ))}
            </div>
          )}
        </section>
        {!edit ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">模型清單</h3>
              <Button size="sm" onClick={() => setEdit({ m: EMPTY, params: JSON.stringify(EMPTY.params, null, 2), isNew: true })}>
                <Plus className="size-4" /> 新增
              </Button>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">排序</th>
                  <th>顯示名稱</th>
                  <th>模式</th>
                  <th>路由</th>
                  <th>啟用</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.key} className="border-t border-border">
                    <td className="py-1.5">{m.sortOrder}</td>
                    <td>
                      <button type="button" className="text-left hover:underline" onClick={() => setEdit({ m, params: JSON.stringify(m.params, null, 2), isNew: false })}>
                        {m.displayName}
                        <div className="text-xs text-muted-foreground">{m.key}</div>
                      </button>
                    </td>
                    <td>{m.mode === 'text-to-image' ? '文生圖' : '圖生圖'}</td>
                    <td>{m.provider === 'openai' ? 'OpenAI' : 'RunningHub'}</td>
                    <td>
                      <input type="checkbox" checked={m.enabled} onChange={() => toggle(m)} aria-label="啟用" />
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => remove(m)} aria-label="刪除">
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          <section className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">key（英數小寫與連字號）</span>
                <Input value={edit.m.key} disabled={!edit.isNew} onChange={(e) => set('key', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">顯示名稱（同名的文生圖／圖生圖會合併為一個選項）</span>
                <Input value={edit.m.displayName} onChange={(e) => set('displayName', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">模式</span>
                <select className="h-9 w-full rounded-md border border-input bg-background px-2" value={edit.m.mode} onChange={(e) => set('mode', e.target.value as AdminImageModel['mode'])}>
                  <option value="text-to-image">文生圖</option>
                  <option value="image-to-image">圖生圖／編輯</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">路由</span>
                <select className="h-9 w-full rounded-md border border-input bg-background px-2" value={edit.m.provider} onChange={(e) => set('provider', e.target.value as AdminImageModel['provider'])}>
                  <option value="openai">OpenAI 格式（OmniRoute）</option>
                  <option value="runninghub">RunningHub</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">上游模型 ID／RH endpoint</span>
                <Input value={edit.m.upstream} onChange={(e) => set('upstream', e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">提示詞規則</span>
                <select className="h-9 w-full rounded-md border border-input bg-background px-2" value={edit.m.profile} onChange={(e) => set('profile', e.target.value)}>
                  {PROFILES.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">排序</span>
                <Input type="number" value={edit.m.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value) || 0)} />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">
                params（JSON；fieldKey 就是送給上游的欄位名，例如 OpenAI 的 size／quality；圖生圖需要一個 type 為 IMAGE 的欄位）
              </span>
              <Textarea rows={14} className="font-mono text-xs" value={edit.params} onChange={(e) => setEdit({ ...edit, params: e.target.value })} />
            </label>
            <div className="flex gap-2">
              <Button onClick={saveModel}>儲存</Button>
              <Button variant="outline" onClick={() => setEdit(null)}>
                取消
              </Button>
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
