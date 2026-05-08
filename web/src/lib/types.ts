// Shared API types — mirrors app/routers/*

export type UserStatus = 'pending' | 'approved' | 'rejected';

export interface UserSummary {
  id: string;
  username: string;
  status: UserStatus;
  note: string;
  createdAt: string;
}

export interface SessionUser {
  username: string;
  isAdmin: boolean;
}

export interface LoginResponse {
  token: string;
  username: string;
  adminToken?: string;
}

export interface VerifyResponse {
  valid: boolean;
  username?: string;
}

export type CardType = 'webapp' | 'workflow';
export type InstanceType = 'default' | 'plus'; // default=24G, plus=4090 48G

export interface EditableField {
  nodeId: string;
  fieldName: string;
}

export interface Card {
  id: string;
  cardType: CardType;
  webappId: string;
  workflowId: string;
  title: string;
  description: string; // user-facing 卡片描述
  llmNote: string; // admin 專為 AI 助手撰寫的功能說明（user 不顯示）
  icon: string;
  color: string;
  coverUrl: string;
  editableFields: EditableField[];
  instanceType: InstanceType;
  maxDurationSeconds: number; // 0 = 用全域預設（10 分鐘）
  sortOrder?: number;
  createdAt?: string;
}

export type NodeFieldType =
  | 'STRING'
  | 'INT'
  | 'FLOAT'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'LIST'
  | 'BOOLEAN'
  | string;

export interface NodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue?: string | number | boolean | null;
  fieldType?: NodeFieldType;
  description?: string;
  descriptionEn?: string;
  fieldData?: unknown;
}

export interface AiConfigResponse {
  aiBaseUrl: string;
  aiModel: string;
  hasApiKey: boolean;
  aiSystemPrompt: string;
  costCurrency: string;
}

export interface AiConfigSavePayload {
  aiBaseUrl: string;
  aiApiKey: string; // empty = keep existing
  aiModel: string;
  aiSystemPrompt?: string; // null/undefined = 不更動
  costCurrency?: string;
}

export interface AccountStatusData {
  remainCoins: string;
  currentTaskCounts: string;
  remainMoney: string;
  currency: string;
  apiType: string;
}

export interface AppListItem {
  webappId: string;
  title: string;
  description: string;
  cover: string;
}

export interface AppListResponse {
  items: AppListItem[];
  page: number | string;
  size: number | string;
  total: number | string;
}

export type AppSort = 'RECOMMEND' | 'HOTTEST' | 'NEWEST';

export interface TaskHistoryResult {
  url: string;
  fileType?: string;
}

export interface TaskHistoryItem {
  id: string;
  cardId: string | null;
  cardTitle: string;
  cardType: CardType;
  webappId: string;
  workflowId: string;
  rhTaskId: string;
  status: string;
  costTime: number | null;
  consumeCoins: number | null;
  consumeMoney: number | null;
  thirdPartyConsumeMoney: number | null;
  results: TaskHistoryResult[];
  errorMessage: string | null;
  nodeInput: NodeInfo[];
  createdAt: string | null;
  completedAt: string | null;
}

export interface UserUsage {
  monthTotal: number;
  monthSuccess: number;
  monthFailed: number;
  monthCostTime: number;
  monthCoins: number;
  monthMoney: number;
  monthThirdPartyMoney: number;
  costCurrency: string;
}

export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  history?: ChatHistoryEntry[];
  context?: Record<string, unknown>;
  /** 單張（舊欄位，保留相容） */
  image?: string;
  /** 多張（最多 2，base64 data URL） */
  images?: string[];
}

export interface UploadResult {
  fileName: string;
  fileType?: string;
}

export interface TaskSubmitData {
  taskId: string;
  promptTips?: string;
  [k: string]: unknown;
}

export interface TaskOutputResult {
  url: string;
  outputType?: string;
  fileType?: string;
}

export interface TaskQueryData {
  status?: string;
  taskStatus?: string;
  results?: TaskOutputResult[];
  fileUrl?: string;
  fileType?: string;
  taskCostTime?: number;
  errorMessage?: string;
  failedReason?: string;
  usage?: { taskCostTime?: number };
  [k: string]: unknown;
}

export interface RhEnvelope<T> {
  code: number;
  msg?: string;
  data: T;
}

export interface ConfigStatus {
  hasApiKey: boolean;
  baseUrl: string;
  pollingInterval: number;
  maxPollingRetries: number;
}
