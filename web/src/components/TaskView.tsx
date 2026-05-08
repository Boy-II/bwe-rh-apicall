import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Send, Download, Cpu, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { NodeRenderer } from './NodeRenderer';
import { ChatSidebar } from './ChatSidebar';
import { ThemeToggle } from './ThemeToggle';
import api from '@/lib/api';
import {
  applyEdits,
  detectMediaType,
  findPromptNodeError,
  normalizeOutputs,
  pollTask,
  type DraftNode,
  type NormalizedOutput,
} from '@/lib/task-utils';
import { markCardUsed } from '@/lib/card-utils';
import { ensurePermission as ensureNotifyPermission, notify } from '@/lib/notify';
import type { Card, NodeInfo, TaskHistoryResult } from '@/lib/types';
import type { RerunPrefill } from '@/App';

interface Props {
  card: Card;
  onBack: () => void;
  /** 從歷史頁重跑時傳入：原任務輸入 + 前次生成 meta */
  prefill?: RerunPrefill;
}

type Phase = 'idle' | 'submitting' | 'polling' | 'success' | 'failed';

function fieldKey(n: { nodeId: string; fieldName: string }) {
  return `${n.nodeId}::${n.fieldName}`;
}

// ComfyUI 一般 seed 為 0..2^53 內整數（JS Number safe）
function randomSeed(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

export function TaskView({ card, onBack, prefill }: Props) {
  const [allNodes, setAllNodes] = useState<NodeInfo[]>([]); // workflow 載入的完整節點
  const [drafts, setDrafts] = useState<DraftNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [statusText, setStatusText] = useState('');
  const [outputs, setOutputs] = useState<NormalizedOutput[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isWorkflow = card.cardType === 'workflow';

  // workflow 模式下只顯示白名單裡的節點
  const visibleNodes = useMemo(() => {
    if (!isWorkflow) return allNodes;
    const allowed = new Set((card.editableFields || []).map(fieldKey));
    return allNodes.filter((n) => allowed.has(fieldKey(n)));
  }, [allNodes, isWorkflow, card.editableFields]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = isWorkflow
        ? await api.proxy.getWorkflowJson(card.workflowId)
        : await api.proxy.getNodeInfo(card.webappId);
      setAllNodes(list);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isWorkflow, card.webappId, card.workflowId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // 重置 drafts 對齊 visibleNodes 長度；若有 prefill，依 nodeId+fieldName 對齊填入
  useEffect(() => {
    if (visibleNodes.length === 0) {
      setDrafts([]);
      return;
    }
    const prefillMap = new Map<string, NodeInfo>();
    (prefill?.nodeInput || []).forEach((p) => prefillMap.set(`${p.nodeId}::${p.fieldName}`, p));
    setDrafts(
      visibleNodes.map((n) => {
        const key = `${n.nodeId}::${n.fieldName}`;
        const hit = prefillMap.get(key);
        if (!hit) return {} as DraftNode;

        // seed 欄位重跑時自動換新值（避免結果完全一樣）
        const isSeed = /seed/i.test(n.fieldName);
        const fieldValue = isSeed ? randomSeed() : hit.fieldValue;

        const draft: DraftNode = { ...n, fieldValue };
        const ft = (n.fieldType || '').toUpperCase();
        if (ft === 'IMAGE' || ft === 'VIDEO' || ft === 'AUDIO') {
          if (typeof hit.fieldValue === 'string') draft.uploadedFileName = hit.fieldValue;
        }
        return draft;
      }),
    );
  }, [visibleNodes, prefill]);

  const submit = async () => {
    setPhase('submitting');
    setStatusText('提交中…');
    setOutputs([]);
    setActiveTaskId(null);
    abortRef.current = new AbortController();
    void ensureNotifyPermission();
    try {
      let submitRes;
      if (isWorkflow) {
        // workflow: 只送出白名單欄位的使用者修改
        const finalNodes = applyEdits(visibleNodes, drafts);
        submitRes = await api.proxy.submitWorkflowTask(
          card.workflowId,
          finalNodes,
          card.instanceType || 'default',
          card.id,
          card.title,
          60,
        );
      } else {
        const finalNodes = applyEdits(allNodes, drafts);
        submitRes = await api.proxy.submitTask(
          card.webappId,
          finalNodes,
          card.id,
          card.title,
        );
      }

      const nodeError = findPromptNodeError(submitRes);
      if (nodeError) throw new Error(nodeError);

      markCardUsed(card.id);
      setActiveTaskId(submitRes.taskId);
      setPhase('polling');
      setStatusText('排隊中…');

      const final = await pollTask(submitRes.taskId, {
        onProgress: (status) => setStatusText(`狀態：${status}`),
        maxDurationSeconds: card.maxDurationSeconds || 0,
        signal: abortRef.current?.signal,
      });
      const list = normalizeOutputs(final);
      setOutputs(list);
      setPhase('success');
      setStatusText('完成');
      setActiveTaskId(null);
      notify(`✅ ${card.title} 已完成`, {
        onlyWhenHidden: true,
        body: list.length > 0 ? `${list.length} 個結果，點此返回查看` : '任務完成',
        tag: `bwe-task-${submitRes.taskId}`,
        icon: card.coverUrl || undefined,
      });
    } catch (e) {
      setPhase('failed');
      setStatusText((e as Error).message);
      setActiveTaskId(null);
      toast.error((e as Error).message);
      notify(`❌ ${card.title} 失敗`, {
        onlyWhenHidden: true,
        body: (e as Error).message,
        tag: `bwe-task-fail`,
        icon: card.coverUrl || undefined,
      });
    }
  };

  const cancel = async () => {
    if (!activeTaskId) return;
    if (!confirm('確定取消這個任務？已扣除的 coin/money 無法回退')) return;
    try {
      await api.proxy.cancelTask(activeTaskId);
      abortRef.current?.abort();
      setPhase('failed');
      setStatusText('已取消');
      setActiveTaskId(null);
      toast.success('任務已取消');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const isBusy = phase === 'submitting' || phase === 'polling';
  const noEditable = isWorkflow && visibleNodes.length === 0 && !loading;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="size-4" /> 返回
            </Button>
            <div>
              <h1 className="text-lg font-semibold">{card.title}</h1>
              {card.description && (
                <p className="text-xs text-muted-foreground">{card.description}</p>
              )}
            </div>
            {isWorkflow && card.instanceType === 'plus' && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                <Cpu className="size-3" /> 4090 48G
              </span>
            )}
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-6">
        {loading ? (
          <div className="text-center text-muted-foreground py-12">載入節點中…</div>
        ) : noEditable ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              此 workflow 沒有設定可編輯欄位。將直接以 workflow 預設值送出。
            </p>
            <Button className="mt-4" onClick={submit} disabled={isBusy}>
              <Send className="size-4" /> {isBusy ? '處理中…' : '直接送出（使用預設）'}
            </Button>
            {statusText && <p className="mt-2 text-xs text-muted-foreground">{statusText}</p>}
          </div>
        ) : (
          <>
            {prefill?.prevResults && prefill.prevResults.length > 0 && (
              <PrevRunSummary
                results={prefill.prevResults}
                costTime={prefill.prevCostTime}
                createdAt={prefill.prevCreatedAt}
              />
            )}
            <NodeRenderer nodes={visibleNodes} drafts={drafts} onChange={setDrafts} />
            <div className="mt-6 flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{statusText}</span>
              <div className="flex gap-2">
                {phase === 'polling' && activeTaskId && (
                  <Button variant="outline" onClick={cancel}>
                    <XIcon className="size-4" /> 取消
                  </Button>
                )}
                <Button onClick={submit} disabled={isBusy || visibleNodes.length === 0}>
                  <Send className="size-4" /> {isBusy ? '處理中…' : '送出任務'}
                </Button>
              </div>
            </div>
            {outputs.length > 0 && (
              <section className="mt-8">
                <h2 className="mb-3 text-base font-semibold">生成結果</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {outputs.map((o, i) => (
                    <ResultCard key={`${o.fileUrl}-${i}`} output={o} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <ChatSidebar
        context={{
          cardTitle: card.title,
          cardLlmNote: card.llmNote,
          nodeInfoList: visibleNodes,
        }}
        onApplyPrompt={(text) => {
          const idx = visibleNodes.findIndex(
            (n) => (n.fieldType || '').toUpperCase() === 'STRING',
          );
          if (idx === -1) return;
          const next = drafts.slice();
          next[idx] = { ...next[idx], fieldValue: text };
          setDrafts(next);
          toast.success('提示詞已套用');
        }}
      />
    </div>
  );
}

function PrevRunSummary({
  results,
  costTime,
  createdAt,
}: {
  results: TaskHistoryResult[];
  costTime: number | null | undefined;
  createdAt: string | null | undefined;
}) {
  const ts = createdAt ? new Date(createdAt).toLocaleString() : '';
  return (
    <section className="mb-6 rounded-lg border border-border bg-muted/30 p-4">
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground">📋 上次生成（重跑參考）</span>
        <span>
          {ts}
          {costTime ? ` · ${costTime.toFixed(1)}s` : ''}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {results.map((r, i) => (
          <a
            key={i}
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-md border border-border bg-background"
          >
            {/\.(png|jpe?g|webp|gif)/i.test(r.url) || /image/.test(r.fileType || '') ? (
              <img src={r.url} alt="prev" loading="lazy" className="h-24 w-full object-cover" />
            ) : /\.(mp4|webm|mov)/i.test(r.url) || /video/.test(r.fileType || '') ? (
              <video src={r.url} className="h-24 w-full object-cover" muted />
            ) : (
              <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                {r.fileType || '檔案'}
              </div>
            )}
          </a>
        ))}
      </div>
    </section>
  );
}

function ResultCard({ output }: { output: NormalizedOutput }) {
  const kind = detectMediaType(output);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      {kind === 'image' && (
        <img src={output.fileUrl} alt="result" loading="lazy" className="w-full" />
      )}
      {kind === 'video' && <video src={output.fileUrl} controls className="w-full" />}
      {kind === 'audio' && <audio src={output.fileUrl} controls className="w-full p-2" />}
      {kind === 'file' && (
        <div className="p-4 text-sm">
          <a href={output.fileUrl} target="_blank" rel="noreferrer" className="text-primary underline">
            {output.fileUrl}
          </a>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <span>{output.taskCostTime ? `⏱️ ${output.taskCostTime}s` : ''}</span>
        <a
          href={output.fileUrl}
          download
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <Download className="size-3" /> 下載
        </a>
      </div>
    </div>
  );
}
