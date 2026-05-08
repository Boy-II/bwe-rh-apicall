import type {
  AccountStatusData,
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
} from './types';

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
      (data && typeof data === 'object' && 'detail' in data && (data as { detail: string }).detail) ||
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
    const res = await request<{ cards: Card[] }>('/api/cards', { user: true });
    return res.cards || [];
  },
  create: (
    card: Partial<
      Pick<
        Card,
        'webappId' | 'workflowId' | 'icon' | 'color' | 'editableFields' |
        'instanceType' | 'cardType' | 'maxDurationSeconds' | 'llmNote' | 'tags' | 'enableMaskEditor'
      >
    > &
      Pick<Card, 'title' | 'description' | 'coverUrl'>,
  ) =>
    request<Card>('/api/admin/cards', { method: 'POST', body: json(card), admin: true }),
  update: (
    id: string,
    card: Pick<Card, 'title' | 'description' | 'coverUrl'> &
      Partial<
        Pick<
          Card,
          'icon' | 'color' | 'editableFields' | 'instanceType' | 'maxDurationSeconds' |
          'llmNote' | 'tags' | 'enableMaskEditor'
        >
      >,
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
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) {
      const msg = (data && typeof data === 'object' && 'detail' in data && (data as { detail: string }).detail) || `HTTP ${res.status}`;
      throw new ApiError(String(msg), res.status);
    }
    return data as { coverUrl: string };
  },
};

// --- Users (admin) ---
export const users = {
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
    const env = await request<RhEnvelope<AccountStatusData>>(
      '/api/admin/account-status',
      { method: 'POST', admin: true },
    );
    return unwrapRh(env);
  },
  appList: async (sort: AppSort, page: number, size: number, days = 7): Promise<AppListResponse> => {
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
export const proxy = {
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
  getWorkflowJson: async (workflowId: string): Promise<NodeInfo[]> => {
    const env = await request<RhEnvelope<NodeInfo[] | { nodeInfoList?: NodeInfo[] }>>(
      '/api/proxy/getWorkflowJson',
      { method: 'POST', body: json({ workflowId }), user: true },
    );
    const data = unwrapRh(env);
    if (Array.isArray(data)) return data;
    return data.nodeInfoList || [];
  },
  submitWorkflowTask: async (
    workflowId: string,
    nodeInfoList: NodeInfo[],
    instanceType: 'default' | 'plus',
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
    const env = await request<RhEnvelope<unknown> & { msg?: string }>(
      '/api/proxy/cancelTask',
      { method: 'POST', body: json({ taskId }), user: true },
    );
    if (env.code !== 0) {
      throw new ApiError(env.msg || `取消失敗（code=${env.code}）`, 400);
    }
    return { code: env.code, msg: env.msg };
  },
  queryTaskOutputs: async (taskId: string): Promise<TaskQueryData> => {
    // RH /openapi/v2/query 回應為 flat shape（{taskId, status, results, ...}）
    // 不像 submit 帶 {code, msg, data} 包裝；只在出現 code 欄位且非 0 時當作錯誤
    const resp = await request<TaskQueryData & { code?: number; msg?: string; data?: TaskQueryData }>(
      '/api/proxy/queryTaskOutputs',
      { method: 'POST', body: json({ taskId }), user: true },
    );
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
  uploadFile: async (file: File): Promise<UploadResult> => {
    const fd = new FormData();
    fd.append('file', file);
    const headers: Record<string, string> = {};
    if (userToken) headers['X-User-Token'] = userToken;
    const res = await fetch('/api/proxy/uploadFile', { method: 'POST', body: fd, headers });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg =
        (data && typeof data === 'object' && 'detail' in data && (data as { detail: string }).detail) ||
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

export const api = { auth, cards, users, adminAi, adminRh, tasks, proxy };
export { ApiError };
export default api;
