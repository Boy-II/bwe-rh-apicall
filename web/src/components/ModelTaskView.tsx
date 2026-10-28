import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Send } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { ChatSidebar } from './ChatSidebar';
import { MultiImageInput } from './MultiImageInput';
import { ThemeToggle } from './ThemeToggle';
import { cleanModelPayload, FIELD_LABELS } from '@/lib/model-utils';
import { markCardUsed } from '@/lib/card-utils';
import { pollTask, normalizeOutputs } from '@/lib/task-utils';
import api from '@/lib/api';
import type { Card, ModelSchema, ModelValue } from '@/lib/types';
import type { RerunPrefill } from '@/App';

export function ModelTaskView({
  card,
  onBack,
  prefill,
}: {
  card: Card;
  onBack: () => void;
  prefill?: RerunPrefill;
}) {
  const [schema, setSchema] = useState<ModelSchema | null>(null);
  const [values, setValues] = useState<Record<string, ModelValue>>({});
  const [uploads, setUploads] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [outputs, setOutputs] = useState<ReturnType<typeof normalizeOutputs>>([]);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    let alive = true;
    api.models
      .schema(card.modelKey || '')
      .then((s) => {
        if (!alive) return;
        setSchema(s);
        const initial = Object.fromEntries(
          s.params
            .filter((p) => p.defaultValue !== undefined)
            .map((p) => [p.fieldKey, p.defaultValue!]),
        ) as Record<string, ModelValue>;
        for (const n of prefill?.nodeInput || [])
          if (n.fieldValue !== null && n.fieldValue !== undefined)
            initial[n.fieldName] = n.fieldValue;
        setValues(initial);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, [card.modelKey, prefill]);
  const change = (key: string, value: ModelValue) =>
    setValues((prev) => ({ ...prev, [key]: value }));
  const submit = async () => {
    if (!schema || busy || Object.values(uploads).some(Boolean)) return;
    setBusy(true);
    setError('');
    setOutputs([]);
    setStatus('正在提交…');
    abort.current = new AbortController();
    try {
      const task = await api.models.submit(card.id, cleanModelPayload(values));
      markCardUsed(card.id);
      setStatus('已提交，正在等待模型生成…');
      const data = await pollTask(task.taskId, {
        signal: abort.current.signal,
        maxDurationSeconds: card.maxDurationSeconds,
        onProgress: (s) => setStatus(s === 'QUEUED' ? '排隊中…' : s === 'RUNNING' ? '生成中…' : s),
      });
      setOutputs(normalizeOutputs(data));
      setStatus('完成');
    } catch (e) {
      setError((e as Error).message);
      setStatus('');
    } finally {
      setBusy(false);
    }
  };
  const pending = Object.values(uploads).some(Boolean);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="size-4" />
              返回
            </Button>
            <div>
              <h1 className="text-lg font-semibold">{card.title}</h1>
              <p className="text-xs text-muted-foreground">{card.description}</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-5 px-6 py-6">
        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {!schema && !error && <p>載入模型設定…</p>}
        {schema && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <p className="text-sm text-muted-foreground">
              {schema.mode === 'text-to-image'
                ? '文生圖：描述想要的畫面'
                : '圖生圖：上傳參考圖片，並描述要修改與保留的部分'}
            </p>
            {schema.params.map((p) => (
              <div key={p.fieldKey} className="space-y-2 rounded-lg border bg-card p-4">
                <Label htmlFor={`model-${p.fieldKey}`}>
                  {FIELD_LABELS[p.fieldKey] || p.fieldKey}
                  {p.required ? ' *' : ''}
                </Label>
                {p.type === 'IMAGE' ? (
                  <MultiImageInput
                    key={`${schema.key}-${p.fieldKey}`}
                    cardId={card.id}
                    param={p}
                    initial={
                      Array.isArray(values[p.fieldKey])
                        ? (values[p.fieldKey] as string[])
                        : values[p.fieldKey]
                          ? [String(values[p.fieldKey])]
                          : []
                    }
                    disabled={busy}
                    onChange={(urls, isBusy) => {
                      change(p.fieldKey, p.multipleInputs ? urls : urls[0] || '');
                      setUploads((u) => ({ ...u, [p.fieldKey]: isBusy }));
                    }}
                  />
                ) : p.type === 'LIST' ? (
                  <select
                    id={`model-${p.fieldKey}`}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    disabled={busy}
                    value={String(values[p.fieldKey] ?? '')}
                    onChange={(e) => change(p.fieldKey, e.target.value)}
                    required={p.required}
                  >
                    <option value="">請選擇</option>
                    {p.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.value === 'empty'
                          ? schema.profile === 'seedream'
                            ? '自訂寬高'
                            : '自動'
                          : o.value}
                      </option>
                    ))}
                  </select>
                ) : p.type === 'BOOLEAN' ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      id={`model-${p.fieldKey}`}
                      type="checkbox"
                      disabled={busy}
                      checked={values[p.fieldKey] === true}
                      onChange={(e) => change(p.fieldKey, e.target.checked)}
                    />
                    啟用
                  </label>
                ) : ['INT', 'FLOAT'].includes(p.type) ? (
                  <Input
                    id={`model-${p.fieldKey}`}
                    type="number"
                    disabled={
                      busy ||
                      (schema.profile === 'seedream' &&
                        ['width', 'height'].includes(p.fieldKey) &&
                        values.resolution !== 'empty')
                    }
                    value={String(values[p.fieldKey] ?? '')}
                    min={p.min}
                    max={p.max}
                    step={p.type === 'INT' ? 1 : p.step || 0.01}
                    required={p.required}
                    onChange={(e) =>
                      change(p.fieldKey, e.target.value === '' ? '' : Number(e.target.value))
                    }
                  />
                ) : (
                  <Textarea
                    id={`model-${p.fieldKey}`}
                    rows={p.fieldKey === 'prompt' ? 5 : 3}
                    disabled={busy}
                    value={String(values[p.fieldKey] ?? '')}
                    required={p.required}
                    maxLength={p.maxLength || 20000}
                    placeholder={
                      p.fieldKey === 'prompt' ? '描述主體、構圖、風格與需要保留的內容…' : ''
                    }
                    onChange={(e) => change(p.fieldKey, e.target.value)}
                  />
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span aria-live="polite" className="text-sm text-muted-foreground">
                {pending ? '圖片處理尚未完成；失敗圖片請重試或移除' : status}
              </span>
              <div className="flex gap-2">
                {busy && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      abort.current?.abort();
                      setStatus('已停止等待；上游任務可能仍在執行，請到歷史頁查看');
                    }}
                  >
                    停止等待
                  </Button>
                )}
                <Button type="submit" disabled={busy || pending}>
                  <Send className="size-4" />
                  {busy ? '處理中…' : '送出任務'}
                </Button>
              </div>
            </div>
          </form>
        )}
        {outputs.length > 0 && (
          <section>
            <h2 className="mb-3 font-semibold">生成結果</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {outputs.map((o) => (
                <div key={o.fileUrl} className="overflow-hidden rounded-lg border">
                  <img src={o.fileUrl} alt="生成結果" className="w-full" />
                  <a
                    href={o.fileUrl}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="block p-3 text-sm text-primary underline"
                  >
                    下載圖片
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      <ChatSidebar
        context={{
          cardId: card.id,
          promptProfile: card.promptProfile,
          nodeInfoList: schema?.params.map((p) => ({
            nodeId: schema.key,
            fieldName: p.fieldKey,
            fieldType: p.type,
            fieldValue: values[p.fieldKey],
          })),
        }}
        onApplyPrompt={(text) => {
          change('prompt', text);
          toast.success('提示詞已套用');
        }}
      />
    </div>
  );
}
