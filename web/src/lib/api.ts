import type {
  AccountStatusData,
  AccessSettings,
  AdminImageModel,
  ImageModel,
  ModelLabel,
  SaveTemplateBody,
  TemplateCategory,
  TemplateDetail,
  TemplateMeta,
  TemplatePage,
  ModelValue,
  AiConfigResponse,
  AiConfigSavePayload,
  AppListResponse,
  AppSort,
  Card,
  ChatRequest,
  ConfigStatus,
  LoginResponse,
  NodeInfo,
  RhEnvelope,
  TaskHistoryItem,
  TaskQueryData,
  TaskSubmitData,
  UploadResult,
  UserSummary,
  UserUsage,
  VerifyResponse,
  InstanceType,
} from './types';
import { templateQuery, type TemplateFilters } from './gallery-utils';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let userToken: string | null = null;
let adminToken: string | null = null;

export function setUserToken(token: string | null) {
  userToken = token;
}
export function setAdminToken(token: string | null) {
  adminToken = token;
}
export function getUserToken() {
  return userToken;
}

interface RequestOptions extends RequestInit {
  admin?: boolean;
  user?: boolean;
}

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const { admin, user, headers, ...rest } = init;
  const finalHeaders: Record<string, string> = {
    ...((headers as Record<string, string>) || {}),
  };
  if (rest.body && typeof rest.body === 'string') {
    finalHeaders['Content-Type'] ||= 'application/json';
  }
  if (admin && adminToken) finalHeaders['X-Admin-Token'] = adminToken;
  if (user && userToken) finalHeaders['X-User-Token'] = userToken;

  const res = await fetch(path, { ...rest, headers: finalHeaders });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      res.status === 502
        ? '網路不穩定，稍後再試'
        : (data &&
            typeof data === 'object' &&
            'detail' in data &&
            (data as { detail: string }).detail) ||
          `HTTP ${res.status}`;
    throw new ApiError(String(msg), res.status);
  }
  return data as T;
}

const json = (b: unknown) => JSON.stringify(b);

function unwrapRh<T>(env: RhEnvelope<T>): T {
  if (env.code !== 0) {
    throw new ApiError(env.msg || `上游服務錯誤（code=${env.code}）`, 400);
  }
  return env.data;
}

// --- Auth ---
export const auth = {
  register: (username: string, password: string) =>
    request<{ message: string }>('/api/auth/register', {
      method: 'POST',
      body: json({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: json({ username, password }),
    }),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST', user: true }),
  verify: () => request<VerifyResponse>('/api/auth/verify', { user: true }),
  adminLogout: () =>
    request<{ success: boolean }>('/api/admin/logout', { method: 'POST', admin: true }),
  adminVerify: () => request<{ valid: boolean }>('/api/admin/verify', { admin: true }),
};

// --- Cards ---
export const cards = {
  list: async (): Promise<Card[]> => {
    const res = await request<{ cards: Card[] }>('/api/cards', { user: true, admin: true });
    return res.cards || [];
  },
  comfyWorkflow: (id: string) =>
    request<{ workflow: Record<string, unknown> }>(`/api/admin/cards/${encodeURIComponent(id)}/comfy-workflow`, {
      admin: true,
    }),
  create: (
    card: Partial<
      Pick<
        Card,
        | 'webappId'
        | 'workflowId'
        | 'icon'
        | 'color'
        | 'editableFields'
        | 'instanceType'
        | 'cardType'
        | 'maxDurationSeconds'
        | 'llmNote'
        | 'tags'
        | 'enableMaskEditor'
        | 'category'
        | 'imageMode'
        | 'promptProfile'
      >
    > &
      Pick<Card, 'title' | 'description' | 'coverUrl'> & { comfyWorkflow?: Record<string, unknown> },
  ) => request<Card>('/api/admin/cards', { method: 'POST', body: json(card), admin: true }),
  update: (
    id: string,
    card: Pick<Card, 'title' | 'description' | 'coverUrl'> &
      Partial<
        Pick<
          Card,
          | 'icon'
          | 'color'
          | 'editableFields'
          | 'instanceType'
          | 'maxDurationSeconds'
          | 'llmNote'
          | 'tags'
          | 'enableMaskEditor'
          | 'hidden'
          | 'category'
          | 'imageMode'
          | 'promptProfile'
        >
      > & { comfyWorkflow?: Record<string, unknown> },
  ) =>
    request<Card>(`/api/admin/cards/${id}`, {
      method: 'PUT',
      body: json(card),
      admin: true,
    }),
  remove: (id: string) =>
    request<{ success: boolean }>(`/api/admin/cards/${id}`, { method: 'DELETE', admin: true }),
  reorder: (ids: string[]) =>
    request<{ success: boolean }>('/api/admin/cards/reorder', {
      method: 'POST',
      body: json({ ids }),
      admin: true,
    }),
  uploadCover: async (file: File): Promise<{ coverUrl: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    const headers: Record<string, string> = {};
    if (adminToken) headers['X-Admin-Token'] = adminToken;
    const res = await fetch('/api/admin/cards/upload-cover', {
      method: 'POST',
      body: fd,
      headers,
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg =
        res.status === 502
          ? '網路不穩定，稍後再試'
          : (data &&
              typeof data === 'object' &&
              'detail' in data &&
              (data as { detail: string }).detail) ||
            `HTTP ${res.status}`;
      throw new ApiError(String(msg), res.status);
    }
    return data as { coverUrl: string };
  },
};

// --- Users (admin) ---
export const users = {
  access: () => request<AccessSettings>('/api/admin/access', { admin: true }),
  saveAccess: (allowedDivisions: string[]) =>
    request<{ success: boolean }>('/api/admin/access', {
      method: 'PUT',
      admin: true,
      body: json({ allowedDivisions }),
    }),
  list: async (): Promise<UserSummary[]> => {
    const res = await request<{ users: UserSummary[] }>('/api/admin/users', { admin: true });
    return res.users || [];
  },
  updateNote: (userId: string, note: string) =>
    request<{ success: boolean }>(`/api/admin/users/${userId}/note`, {
      method: 'PUT',
      body: json({ note }),
      admin: true,
    }),
  approve: (userId: string) =>
    request<{ success: boolean }>(`/api/admin/users/${userId}/approve`, {
      method: 'POST',
      admin: true,
    }),
  reject: (userId: string) =>
    request<{ success: boolean }>(`/api/admin/users/${userId}/reject`, {
      method: 'POST',
      admin: true,
    }),
  remove: (userId: string) =>
    request<{ success: boolean }>(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      admin: true,
    }),
};

// --- Admin AI config ---
export const adminAi = {
  get: () => request<AiConfigResponse>('/api/admin/ai-config', { admin: true }),
  save: (cfg: AiConfigSavePayload) =>
    request<{ success: boolean }>('/api/admin/ai-config', {
      method: 'POST',
      body: json(cfg),
      admin: true,
    }),
  listModels: (aiBaseUrl: string, aiApiKey: string) =>
    request<{ models: string[] }>('/api/admin/ai-models', {
      method: 'POST',
      body: json({ aiBaseUrl, aiApiKey }),
      admin: true,
    }),
};

// --- Admin RunningHub: balance + app browser ---
export const adminRh = {
  accountStatus: async (): Promise<AccountStatusData> => {
    const env = await request<RhEnvelope<AccountStatusData>>('/api/admin/account-status', {
      method: 'POST',
      admin: true,
    });
    return unwrapRh(env);
  },
  appList: async (
    sort: AppSort,
    page: number,
    size: number,
    days = 7,
  ): Promise<AppListResponse> => {
    const env = await request<RhEnvelope<AppListResponse>>('/api/admin/aiapp-list', {
      method: 'POST',
      body: json({ sort, page, size, days }),
      admin: true,
    });
    return unwrapRh(env);
  },
};

// --- Tasks ---
export const tasks = {
  myHistory: async (limit = 50, days = 30): Promise<TaskHistoryItem[]> => {
    const res = await request<{ tasks: TaskHistoryItem[] }>(
      `/api/users/me/tasks?limit=${limit}&days=${days}`,
      { user: true },
    );
    return res.tasks || [];
  },
  userUsage: (userId: string) =>
    request<UserUsage>(`/api/admin/users/${userId}/usage`, { admin: true }),
  markTimeout: (rhTaskId: string) =>
    request<{ success: boolean }>('/api/users/me/tasks/mark-timeout', {
      method: 'POST',
      body: json({ rhTaskId }),
      user: true,
    }),
};

// --- RunningHub proxy ---
export const models = {
  schema: (key: string) =>
    request<ImageModel>(`/api/models/${encodeURIComponent(key)}`, { user: true }),
  submit: (modelKey: string, payload: Record<string, ModelValue>, templateId?: string) =>
    request<TaskSubmitData>('/api/models/submit', {
      method: 'POST',
      user: true,
      body: json({ modelKey, payload, templateId }),
    }),
  upload: (modelKey: string, fieldKey: string, file: File) => {
    const fd = new FormData();
    fd.append('modelKey', modelKey);
    fd.append('fieldKey', fieldKey);
    fd.append('file', file);
    return request<{ url: string }>('/api/models/upload', { method: 'POST', user: true, body: fd });
  },
  resultDownloadUrl: (taskId: string, index: number) =>
    `/api/models/tasks/${encodeURIComponent(taskId)}/results/${index}`,
  /** 帶 token 取回結果圖並觸發瀏覽器下載。 */
  download: async (taskId: string, index: number) => {
    const res = await fetch(models.resultDownloadUrl(taskId, index), {
      headers: userToken ? { 'X-User-Token': userToken } : {},
    });
    if (!res.ok) throw new ApiError(res.status === 502 ? '結果圖片已無法取得' : `下載失敗（HTTP ${res.status}）`, res.status);
    const name =
      /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] ||
      `bwe-${taskId}-${index}.png`;
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  },
};

export const imageModels = {
  list: () => request<ImageModel[]>('/api/image-models', { user: true }),
};

export const templates = {
  list: (filters: TemplateFilters) =>
    request<TemplatePage>(`/api/templates?${templateQuery(filters)}`, { user: true, admin: true }),
  get: (id: string) =>
    request<TemplateDetail>(`/api/templates/${encodeURIComponent(id)}`, { user: true, admin: true }),
  categories: () => request<TemplateCategory[]>('/api/template-categories', { user: true }),
  tags: (category = '') =>
    request<{ tag: string; count: number }[]>(
      `/api/template-tags${category ? `?category=${encodeURIComponent(category)}` : ''}`,
      { user: true },
    ),
  favorite: (id: string, on: boolean) =>
    request<{ favorited: boolean }>(`/api/templates/${encodeURIComponent(id)}/favorite`, {
      method: on ? 'PUT' : 'DELETE',
      user: true,
    }),
  save: (body: SaveTemplateBody) =>
    request<TemplateDetail>('/api/templates', { method: 'POST', user: true, admin: true, body: json(body) }),
  update: (id: string, body: Partial<Omit<SaveTemplateBody, 'taskId' | 'resultIndex'> & { modelLabel: ModelLabel }>) =>
    request<TemplateDetail>(`/api/templates/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      user: true,
      admin: true,
      body: json(body),
    }),
  remove: (id: string) =>
    request<{ success: boolean }>(`/api/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      user: true,
      admin: true,
    }),
  fillLanguage: (id: string, lang: 'en' | 'zh') =>
    request<{ text: string; generated: boolean }>(
      `/api/templates/${encodeURIComponent(id)}/fill-language`,
      { method: 'POST', user: true, body: json({ lang }) },
    ),
};

export const prompt = {
  optimize: (promptText: string, requestText: string, modelKey: string) =>
    request<{ prompt: string }>('/api/prompt/optimize', {
      method: 'POST',
      user: true,
      body: json({ prompt: promptText, request: requestText, modelKey }),
    }),
  suggestMeta: (promptText: string) =>
    request<TemplateMeta>('/api/prompt/suggest-meta', {
      method: 'POST',
      user: true,
      body: json({ prompt: promptText }),
    }),
};

export const adminModels = {
  list: () => request<AdminImageModel[]>('/api/admin/image-models', { admin: true }),
  create: (m: AdminImageModel) =>
    request<AdminImageModel>('/api/admin/image-models', { method: 'POST', admin: true, body: json(m) }),
  update: (key: string, m: Partial<AdminImageModel>) =>
    request<AdminImageModel>(`/api/admin/image-models/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      admin: true,
      body: json(m),
    }),
  remove: (key: string) =>
    request<{ success: boolean }>(`/api/admin/image-models/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      admin: true,
    }),
  getRoute: () => request<{ baseUrl: string; hasApiKey: boolean }>('/api/admin/openai-route', { admin: true }),
  saveRoute: (baseUrl: string, apiKey: string) =>
    request<{ success: boolean }>('/api/admin/openai-route', {
      method: 'POST',
      admin: true,
      body: json({ baseUrl, apiKey }),
    }),
  routeModels: () =>
    request<{ models: string[] }>('/api/admin/openai-route/models', { method: 'POST', admin: true }),
};

export interface MediaResultItem {
  name: string;
  url: string;
  size: number;
  savedAt: string;
  expiresAt: string;
  task: { id: string; cardTitle: string; provider: string; userName: string; createdAt: string } | null;
}

export interface MediaResultPage {
  items: MediaResultItem[];
  total: number;
  totalSize: number;
  retentionDays: number;
  nextOffset: number | null;
}

export const adminMedia = {
  list: (offset = 0, limit = 60) =>
    request<MediaResultPage>(`/api/admin/media/results?offset=${offset}&limit=${limit}`, { admin: true }),
  remove: (names: string[]) =>
    request<{ success: boolean; deleted: number }>('/api/admin/media/results/delete', {
      method: 'POST',
      admin: true,
      body: json({ names }),
    }),
};

export const adminTemplates = {
  create: (body: { file: File; promptZh: string; promptEn: string; title: string; categoryId: string; mode: string; modelLabel: string }) => {
    const fd = new FormData();
    fd.append('file', body.file);
    for (const k of ['promptZh', 'promptEn', 'title', 'categoryId', 'mode', 'modelLabel'] as const) fd.append(k, body[k]);
    return request<TemplateDetail>('/api/admin/templates', { method: 'POST', admin: true, body: fd });
  },
  replaceImage: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ imageUrl: string; thumbUrl: string }>(
      `/api/admin/templates/${encodeURIComponent(id)}/image`,
      { method: 'POST', admin: true, user: true, body: fd },
    );
  },
  batchDelete: (ids: string[]) =>
    request<{ success: boolean; deleted: number }>('/api/admin/templates/batch-delete', {
      method: 'POST',
      admin: true,
      body: json({ ids }),
    }),
  createCategory: (id: string, name: string) =>
    request<{ id: string }>('/api/admin/template-categories', {
      method: 'POST',
      admin: true,
      user: true,
      body: json({ id, name }),
    }),
  updateCategory: (id: string, body: { name?: string; sortOrder?: number }) =>
    request<{ success: boolean }>(`/api/admin/template-categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      admin: true,
      user: true,
      body: json(body),
    }),
  deleteCategory: (id: string) =>
    request<{ success: boolean }>(`/api/admin/template-categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      admin: true,
      user: true,
    }),
};

export const proxy = {
  compileMoss: (draft: object) =>
    request<{ prompt: string; width: number; height: number }>('/api/proxy/compile-moss-layout', {
      method: 'POST',
      user: true,
      body: json({ draft }),
    }),
  getNodeInfo: async (webappId: string): Promise<NodeInfo[]> => {
    const env = await request<RhEnvelope<NodeInfo[] | { nodeInfoList?: NodeInfo[] }>>(
      '/api/proxy/getNodeInfo',
      { method: 'POST', body: json({ webappId }), user: true },
    );
    const data = unwrapRh(env);
    if (Array.isArray(data)) return data;
    return data.nodeInfoList || [];
  },
  submitTask: async (
    webappId: string,
    nodeInfoList: NodeInfo[],
    cardId?: string,
    cardTitle?: string,
  ): Promise<TaskSubmitData> => {
    const env = await request<RhEnvelope<TaskSubmitData>>('/api/proxy/submitTask', {
      method: 'POST',
      body: json({ webappId, nodeInfoList, cardId, cardTitle }),
      user: true,
    });
    return unwrapRh(env);
  },
  /** cardId：本地 ComfyUI 卡片用卡片內存的 workflow */
  getWorkflowJson: async (workflowId: string, cardId?: string): Promise<NodeInfo[]> => {
    const env = await request<RhEnvelope<NodeInfo[] | { nodeInfoList?: NodeInfo[] }>>(
      '/api/proxy/getWorkflowJson',
      { method: 'POST', body: json({ workflowId, cardId }), user: true },
    );
    const data = unwrapRh(env);
    if (Array.isArray(data)) return data;
    return data.nodeInfoList || [];
  },
  submitWorkflowTask: async (
    workflowId: string,
    nodeInfoList: NodeInfo[],
    instanceType: InstanceType,
    cardId?: string,
    cardTitle?: string,
    retainSeconds = 60,
  ): Promise<TaskSubmitData> => {
    const env = await request<RhEnvelope<TaskSubmitData>>('/api/proxy/submitWorkflowTask', {
      method: 'POST',
      body: json({ workflowId, nodeInfoList, instanceType, cardId, cardTitle, retainSeconds }),
      user: true,
    });
    return unwrapRh(env);
  },
  cancelTask: async (taskId: string): Promise<{ code: number; msg?: string }> => {
    const env = await request<RhEnvelope<unknown> & { msg?: string }>('/api/proxy/cancelTask', {
      method: 'POST',
      body: json({ taskId }),
      user: true,
    });
    if (env.code !== 0) {
      throw new ApiError(env.msg || `取消失敗（code=${env.code}）`, 400);
    }
    return { code: env.code, msg: env.msg };
  },
  queryTaskOutputs: async (taskId: string): Promise<TaskQueryData> => {
    // RH /openapi/v2/query 回應為 flat shape（{taskId, status, results, ...}）
    // 不像 submit 帶 {code, msg, data} 包裝；只在出現 code 欄位且非 0 時當作錯誤
    const resp = await request<
      TaskQueryData & { code?: number; msg?: string; data?: TaskQueryData }
    >('/api/proxy/queryTaskOutputs', { method: 'POST', body: json({ taskId }), user: true });
    if (typeof resp.code === 'number' && resp.code !== 0) {
      throw new ApiError(resp.msg || `上游服務錯誤（code=${resp.code}）`, 400);
    }
    if (resp.data && typeof resp.data === 'object') return resp.data;
    return resp;
  },
  getAccountStatus: async (): Promise<unknown> => {
    const env = await request<RhEnvelope<unknown>>('/api/proxy/getAccountStatus', {
      method: 'POST',
      user: true,
    });
    return unwrapRh(env);
  },
  /** target='comfyui'：上傳到本地 ComfyUI（否則上傳到 RunningHub） */
  uploadFile: async (file: File, target?: 'comfyui'): Promise<UploadResult> => {
    const fd = new FormData();
    fd.append('file', file);
    const headers: Record<string, string> = {};
    if (userToken) headers['X-User-Token'] = userToken;
    const url = target ? `/api/proxy/uploadFile?target=${target}` : '/api/proxy/uploadFile';
    const res = await fetch(url, { method: 'POST', body: fd, headers });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg =
        res.status === 502
          ? '網路不穩定，稍後再試'
          : (data &&
              typeof data === 'object' &&
              'detail' in data &&
              (data as { detail: string }).detail) ||
            `HTTP ${res.status}`;
      throw new ApiError(String(msg), res.status);
    }
    const env = data as RhEnvelope<UploadResult>;
    if (env.code !== 0) throw new ApiError(env.msg || '上傳失敗', 400);
    return env.data;
  },
  chat: async (req: ChatRequest): Promise<string> => {
    const res = await request<{ text: string }>('/api/proxy/chat', {
      method: 'POST',
      body: json(req),
      user: true,
    });
    return res.text;
  },
  configStatus: () => request<ConfigStatus>('/api/config/status'),
};

export const api = {
  auth,
  cards,
  users,
  adminAi,
  adminRh,
  tasks,
  proxy,
  models,
  imageModels,
  templates,
  prompt,
  adminModels,
  adminTemplates,
  adminMedia,
};
export { ApiError };
export default api;
