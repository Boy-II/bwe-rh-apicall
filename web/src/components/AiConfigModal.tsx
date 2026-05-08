import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import api from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AiConfigModal({ open, onClose }: Props) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [costCurrency, setCostCurrency] = useState('USD');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.adminAi
      .get()
      .then((cfg) => {
        setBaseUrl(cfg.aiBaseUrl || '');
        setModel(cfg.aiModel || '');
        setHasApiKey(!!cfg.hasApiKey);
        setApiKey('');
        setModels(cfg.aiModel ? [cfg.aiModel] : []);
        setSystemPrompt(cfg.aiSystemPrompt || '');
        setCostCurrency(cfg.costCurrency || 'USD');
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [open]);

  const test = async () => {
    if (!baseUrl) {
      toast.error('請先填寫 Base URL');
      return;
    }
    if (!apiKey && !hasApiKey) {
      toast.error('請先填寫 API Key');
      return;
    }
    setTesting(true);
    try {
      const res = await api.adminAi.listModels(baseUrl, apiKey);
      setModels(res.models);
      if (res.models.length === 0) {
        toast.warning('連線成功但無模型清單');
      } else {
        toast.success(`連線成功，找到 ${res.models.length} 個模型`);
        if (!model && res.models[0]) setModel(res.models[0]);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseUrl || !model) {
      toast.error('請填寫 Base URL 與選擇模型');
      return;
    }
    setSaving(true);
    try {
      await api.adminAi.save({
        aiBaseUrl: baseUrl,
        aiApiKey: apiKey,
        aiModel: model,
        aiSystemPrompt: systemPrompt,
        costCurrency: costCurrency,
      });
      toast.success('AI 設定已儲存');
      onClose();
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
          <DialogTitle>🤖 AI 助手設定</DialogTitle>
          <DialogDescription>
            設定 OpenAI 相容 API（Base URL + API Key + 模型）。未設定時將使用 Gemini fallback。
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-6 text-center text-muted-foreground">載入中…</div>
        ) : (
          <form className="space-y-4" onSubmit={save}>
            <div className="space-y-2">
              <Label htmlFor="baseUrl">Base URL</Label>
              <Input
                id="baseUrl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiKey">
                API Key{' '}
                {hasApiKey && (
                  <span className="ml-1 inline-flex items-center gap-1 text-xs text-primary">
                    <CheckCircle2 className="size-3" /> 已儲存（留空保留）
                  </span>
                )}
              </Label>
              <Input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasApiKey ? '••••••（留空保留現有）' : 'sk-...'}
                autoComplete="off"
              />
            </div>
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={test} disabled={testing}>
                {testing ? '測試中…' : '測試連線並拉模型'}
              </Button>
            </div>
            {models.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="model">模型</Label>
                <select
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
                >
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="systemPrompt">
                System Prompt
                <span className="ml-1 text-xs text-muted-foreground">
                  （全域基礎 prompt，每次聊天會自動加上目前卡片的 context）
                </span>
              </Label>
              <Textarea
                id="systemPrompt"
                rows={6}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="例：你是 BWE AI 應用平台的助手，協助使用者選擇 AI 應用並撰寫提示詞，回覆請使用繁體中文…"
              />
              <p className="text-xs text-muted-foreground">
                留空則使用內建預設 prompt。當建議提示詞時請保留 ```prompt 區塊格式以利使用者套用。
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="costCurrency">金額顯示幣別</Label>
              <select
                id="costCurrency"
                value={costCurrency}
                onChange={(e) => setCostCurrency(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                <option value="USD">USD ($)</option>
                <option value="CNY">CNY (¥)</option>
                <option value="TWD">TWD (NT$)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                用戶管理頁顯示金額時的幣別符號。實際金額由 RunningHub 任務回傳的 consumeMoney + thirdPartyConsumeMoney 加總得到。
              </p>
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? '儲存中…' : '儲存'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
