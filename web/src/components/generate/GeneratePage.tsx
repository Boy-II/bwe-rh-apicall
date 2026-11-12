import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import api from '@/lib/api';
import { cleanModelPayload } from '@/lib/model-utils';
import { imageField, modelOptions, pickModelKey, requiresReference } from '@/lib/gallery-utils';
import { normalizeOutputs, pollTask, type NormalizedOutput } from '@/lib/task-utils';
import type { ImageModel, ModelValue, TemplateDetail } from '@/lib/types';
import type { GeneratePrefill } from '@/App';
import { ModelParams } from './ModelParams';
import { ReferenceImages } from './ReferenceImages';
import { ResultPanel } from './ResultPanel';
import { TemplateCard } from './TemplateCard';
import { OptimizeDialog } from './OptimizeDialog';
import { SaveTemplateDialog } from './SaveTemplateDialog';

interface Props {
  templateId?: string;
  prefill?: GeneratePrefill;
}

const defaultsOf = (m: ImageModel | undefined) =>
  Object.fromEntries(
    (m?.params || []).filter((p) => p.defaultValue !== undefined).map((p) => [p.fieldKey, p.defaultValue!]),
  ) as Record<string, ModelValue>;

export function GeneratePage({ templateId, prefill }: Props) {
  const [models, setModels] = useState<ImageModel[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [values, setValues] = useState<Record<string, ModelValue>>({});
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [imagesKey, setImagesKey] = useState('init');
  const [uploading, setUploading] = useState(false);
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<NormalizedOutput[]>([]);
  const [lastRun, setLastRun] = useState<{ prompt: string; modelKey: string; hadImages: boolean } | null>(null);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [saveIndex, setSaveIndex] = useState<number | null>(null);
  const [saved, setSaved] = useState<number[]>([]);
  const abort = useRef<AbortController | null>(null);

  const hasImages = images.length > 0;
  const options = useMemo(() => modelOptions(models, hasImages), [models, hasImages]);
  const modelKey = pickModelKey(models, displayName, hasImages) ?? options[0]?.key ?? null;
  const model = models.find((m) => m.key === modelKey);
  // 參考圖上傳用的 i2i 模型：優先同名，否則第一個 i2i 模型
  const uploadModel =
    models.find((m) => m.key === pickModelKey(models, displayName, true)) ??
    models.find((m) => m.mode === 'image-to-image');
  const uploadParam = uploadModel ? imageField(uploadModel.params) : undefined;

  useEffect(() => {
    api.imageModels
      .list()
      .then((list) => {
        setModels(list);
        const fromPrefill = prefill && list.find((m) => m.key === prefill.modelKey);
        const first = fromPrefill || list[0];
        if (!first) return;
        setDisplayName(first.displayName);
        const v = defaultsOf(first);
        if (prefill) {
          for (const n of prefill.nodeInput) {
            const p = first.params.find((x) => x.fieldKey === n.fieldName);
            if (n.fieldName === 'prompt') setPrompt(String(n.fieldValue ?? ''));
            else if (p?.type === 'IMAGE') {
              const urls = Array.isArray(n.fieldValue) ? n.fieldValue.map(String) : n.fieldValue ? [String(n.fieldValue)] : [];
              setImages(urls);
              setImagesKey('prefill');
            } else if (n.fieldValue !== null && n.fieldValue !== undefined) v[n.fieldName] = n.fieldValue as ModelValue;
          }
        }
        setValues(v);
      })
      .catch((e) => setError((e as Error).message));
    return () => abort.current?.abort();
  }, [prefill]);

  useEffect(() => {
    if (!templateId) return;
    api.templates
      .get(templateId)
      .then(setTemplate)
      .catch((e) => toast.error((e as Error).message));
  }, [templateId]);

  // 範本建議的模型（若存在且可用）
  useEffect(() => {
    if (!template?.suggestedModel || !models.length) return;
    const m = models.find((x) => x.key === template.suggestedModel);
    if (m) setDisplayName(m.displayName);
  }, [template, models]);

  // 換模型：保留同名欄位，補上新模型預設值
  const lastModelKey = useRef<string | null>(null);
  useEffect(() => {
    if (!model || lastModelKey.current === model.key) return;
    lastModelKey.current = model.key;
    setValues((prev) => {
      const next = defaultsOf(model);
      for (const p of model.params) if (prev[p.fieldKey] !== undefined && prev[p.fieldKey] !== '') next[p.fieldKey] = prev[p.fieldKey];
      return next;
    });
  }, [model]);

  const needsRef = requiresReference(template?.mode) && !hasImages;

  const submit = async () => {
    if (!model || busy || uploading || needsRef) return;
    if (!prompt.trim()) {
      toast.error('請輸入提示詞');
      return;
    }
    const allowed = new Set(model.params.map((p) => p.fieldKey));
    const payload: Record<string, ModelValue> = Object.fromEntries(
      Object.entries(cleanModelPayload(values)).filter(([k]) => allowed.has(k) && k !== 'prompt'),
    );
    payload.prompt = prompt;
    const img = imageField(model.params);
    if (img && hasImages) payload[img.fieldKey] = img.multipleInputs === false ? images[0] : images;
    setBusy(true);
    setError('');
    setOutputs([]);
    setSaved([]);
    setStatus('正在提交…');
    abort.current = new AbortController();
    try {
      const task = await api.models.submit(model.key, payload, template?.id);
      setTaskId(task.taskId);
      setLastRun({ prompt, modelKey: model.key, hadImages: hasImages });
      setStatus('已提交，等待生成…');
      const data = await pollTask(task.taskId, {
        signal: abort.current.signal,
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

  const cancel = async () => {
    abort.current?.abort();
    if (taskId && model?.provider === 'openai') {
      try {
        await api.proxy.cancelTask(taskId);
      } catch {
        /* 取消失敗不影響停止等待 */
      }
    }
    setStatus('已停止等待；任務可能仍在執行，請到生成紀錄查看');
  };

  const insertPrompt = (text: string) => {
    if (prompt.trim() && prompt !== text && !confirm('要以範本內容取代目前的提示詞嗎？')) return;
    setPrompt(text);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-2xl font-semibold">AI 生圖</h1>
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          {template && (
            <TemplateCard
              template={template}
              onChange={setTemplate}
              onInsert={insertPrompt}
              onClose={() => setTemplate(null)}
            />
          )}
          <ReferenceImages
            uploadModelKey={uploadModel?.key ?? null}
            param={uploadParam}
            images={images}
            resetKey={imagesKey}
            disabled={busy}
            required={requiresReference(template?.mode)}
            onChange={(urls, isBusy) => {
              setImages(urls);
              setUploading(isBusy);
            }}
          />
          <div className="space-y-2">
            <label htmlFor="prompt" className="text-sm font-medium">
              提示詞
            </label>
            <Textarea
              id="prompt"
              rows={8}
              value={prompt}
              disabled={busy}
              maxLength={20000}
              placeholder="描述主體、構圖、風格與需要保留的內容…"
              onChange={(e) => setPrompt(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={busy || !prompt.trim()}
              onClick={() => setOptimizeOpen(true)}
            >
              <Sparkles className="size-4" /> 優化
            </Button>
          </div>
          {model && (
            <ModelParams
              options={options}
              displayName={model.displayName}
              onModel={setDisplayName}
              params={model.params}
              values={values}
              onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))}
              disabled={busy}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span aria-live="polite" className="text-sm text-muted-foreground">
              {uploading ? '參考圖上傳中…' : status}
            </span>
            <div className="flex gap-2">
              {busy && (
                <Button type="button" variant="outline" onClick={cancel}>
                  停止
                </Button>
              )}
              <Button type="button" onClick={submit} disabled={!model || busy || uploading || needsRef}>
                <Send className="size-4" />
                {busy ? '生成中…' : '立即生成'}
              </Button>
            </div>
          </div>
        </div>
        <div className="lg:sticky lg:top-6 lg:self-start">
          <ResultPanel
            taskId={taskId}
            outputs={outputs}
            status={busy ? status : ''}
            onSave={(i) => setSaveIndex(i)}
            savedIndexes={saved}
          />
        </div>
      </div>
      <OptimizeDialog
        open={optimizeOpen}
        prompt={prompt}
        modelKey={model?.key ?? ''}
        onClose={() => setOptimizeOpen(false)}
        onApply={(text) => {
          setPrompt(text);
          setOptimizeOpen(false);
        }}
      />
      {saveIndex !== null && taskId && lastRun && (
        <SaveTemplateDialog
          open
          taskId={taskId}
          resultIndex={saveIndex}
          prompt={lastRun.prompt}
          defaultMode={lastRun.hadImages ? 'i2i' : 't2i'}
          onClose={() => setSaveIndex(null)}
          onSaved={() => {
            setSaved((s) => [...s, saveIndex]);
            setSaveIndex(null);
          }}
        />
      )}
    </div>
  );
}
