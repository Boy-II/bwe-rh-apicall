import api, { ApiError } from './api';
import type { NodeInfo, TaskOutputResult, TaskQueryData } from './types';

export interface NormalizedOutput {
  fileUrl: string;
  fileType: string;
  taskCostTime?: number;
}

const POLL_INTERVAL = 3000;
const DEFAULT_MAX_RETRIES = 200; // 600 秒（10 分鐘）

export interface PollCallbacks {
  onProgress?: (status: string, data: TaskQueryData) => void;
  signal?: AbortSignal;
  /** 卡片自訂最長秒數；0 或未提供 → 用全域預設 */
  maxDurationSeconds?: number;
}

export async function pollTask(taskId: string, cb: PollCallbacks = {}): Promise<TaskQueryData> {
  const maxRetries =
    cb.maxDurationSeconds && cb.maxDurationSeconds > 0
      ? Math.ceil((cb.maxDurationSeconds * 1000) / POLL_INTERVAL)
      : DEFAULT_MAX_RETRIES;

  for (let i = 0; i < maxRetries; i++) {
    if (cb.signal?.aborted) throw new ApiError('已取消', 0);
    const result = await api.proxy.queryTaskOutputs(taskId);
    const status = result.status || result.taskStatus || '';
    cb.onProgress?.(status, result);
    if (status === 'SUCCESS') return result;
    if (status === 'TIMEOUT' || status === 'FAILED') {
      const code = (result as { errorCode?: string }).errorCode || '';
      const msg = result.errorMessage || (typeof result.failedReason === 'string' ? result.failedReason : '') || (status === 'TIMEOUT' ? '上游回報 TIMEOUT' : '未知錯誤');
      const label = status === 'TIMEOUT' ? '任務逾時' : '任務失敗';
      throw new Error(code ? `[${code}] ${label}：${msg}` : `${label}：${msg}`);
    }
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, POLL_INTERVAL);
      cb.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new ApiError('已取消', 0));
      });
    });
  }
  // 本地輪詢用盡（10 分鐘）— RH 平台單任務最長 60 分鐘，仍可能在跑
  // 通知 backend 把這筆標 TIMEOUT 避免永遠卡在 QUEUED；下次 query 拿到 SUCCESS 仍會覆寫回去
  try {
    await api.tasks.markTimeout(taskId);
  } catch {
    /* 標記失敗不阻擋錯誤回報 */
  }
  const minutes = Math.round((maxRetries * POLL_INTERVAL) / 60000);
  throw new Error(
    `本地輪詢逾時：超過 ${minutes} 分鐘，任務可能仍在執行（RH 平台允許 60 分鐘），請稍後到歷史頁面查看`,
  );
}

export function normalizeOutputs(result: TaskQueryData): NormalizedOutput[] {
  const cost = result.usage?.taskCostTime ?? result.taskCostTime;
  if (Array.isArray(result.results) && result.results.length > 0) {
    return result.results.map((r: TaskOutputResult) => ({
      fileUrl: r.url,
      fileType: r.outputType || r.fileType || '',
      taskCostTime: cost,
    }));
  }
  if (result.fileUrl) {
    return [{ fileUrl: result.fileUrl, fileType: result.fileType || '', taskCostTime: cost }];
  }
  return [];
}

export function detectMediaType(o: NormalizedOutput): 'image' | 'video' | 'audio' | 'file' {
  const t = (o.fileType || '').toLowerCase();
  const url = o.fileUrl || '';
  if (/png|jpe?g|webp|gif|image/.test(t) || /\.(png|jpe?g|webp|gif)/i.test(url)) return 'image';
  if (/mp4|webm|mov|video/.test(t) || /\.(mp4|webm|mov)/i.test(url)) return 'video';
  if (/mp3|wav|ogg|audio/.test(t) || /\.(mp3|wav|ogg)/i.test(url)) return 'audio';
  return 'file';
}

export function findPromptNodeError(result: { promptTips?: string }): string | null {
  if (!result.promptTips) return null;
  try {
    const tips =
      typeof result.promptTips === 'string' ? JSON.parse(result.promptTips) : result.promptTips;
    if (tips.node_errors && Object.keys(tips.node_errors).length > 0) {
      return `節點錯誤：${JSON.stringify(tips.node_errors)}`;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export interface DraftNode extends NodeInfo {
  /** override file name returned by /uploadFile */
  uploadedFileName?: string | null;
  /** 本地預覽（dataURL/blob URL），mask 編輯器載入底圖用 */
  localImageUrl?: string;
  /** mask 編輯後的 dataURL（重新編輯時帶回繼續畫） */
  localMaskDataUrl?: string;
}

export function applyEdits(original: NodeInfo[], drafts: DraftNode[]): NodeInfo[] {
  return original.map((node, i) => {
    const draft = drafts[i] || {};
    const out = { ...node };
    if (draft.uploadedFileName) {
      out.fieldValue = draft.uploadedFileName;
    } else if (draft.fieldValue !== undefined) {
      out.fieldValue = draft.fieldValue;
    }
    return out;
  });
}
