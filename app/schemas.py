"""Pydantic 請求/回應模型（路由共用）。"""

from typing import Optional

from pydantic import BaseModel, Field


# ===== Auth =====


class AdminLoginRequest(BaseModel):
    password: str


class UserRegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)


class UserLoginRequest(BaseModel):
    username: str
    password: str


# ===== Cards =====


class EditableField(BaseModel):
    nodeId: str
    fieldName: str
    fieldType: Optional[str] = None  # admin 指定的渲染類型；None=用 parser 推斷
    displayName: Optional[str] = None  # admin 自訂顯示名稱（user 端標籤）


class CardCreate(BaseModel):
    cardType: str = "webapp"  # webapp / workflow
    webappId: str = ""
    workflowId: str = ""
    title: str
    description: str = ""  # 使用者可見的卡片描述
    llmNote: str = ""  # 給 LLM 看的功能說明（不對使用者顯示）
    icon: str = "🎨"
    color: str = "#6C5CE7"
    coverUrl: str = ""
    tags: list[str] = []
    editableFields: list[EditableField] = []
    instanceType: str = "default"  # default(24G) / plus(48G 4090)
    maxDurationSeconds: int = 0  # 0=用全域預設；>0=本卡片輪詢上限
    enableMaskEditor: bool = False  # 啟用遮罩編輯器（約定：欄位 1=source、欄位 2=mask）


class CardUpdate(BaseModel):
    title: str
    description: str = ""
    llmNote: str = ""
    icon: str = "🎨"
    color: str = "#6C5CE7"
    coverUrl: str = ""
    tags: Optional[list[str]] = None  # None = 不更動
    editableFields: Optional[list[EditableField]] = None  # None = 不更動
    instanceType: Optional[str] = None  # None = 不更動
    maxDurationSeconds: Optional[int] = None  # None = 不更動
    enableMaskEditor: Optional[bool] = None  # None = 不更動


class CardReorderRequest(BaseModel):
    ids: list[str]


# ===== AI =====


class AIChatRequest(BaseModel):
    message: str
    history: list = []
    context: dict = {}
    image: str = ""  # base64 data URL（單張，舊版相容）
    images: list[str] = []  # base64 data URLs（多張，最多 2）


class AIConfigRequest(BaseModel):
    aiBaseUrl: str = ""
    aiApiKey: str = ""
    aiModel: str = ""
    aiSystemPrompt: Optional[str] = None  # None = 不更動現值；空字串 = 清除
    costCurrency: Optional[str] = None  # consumeMoney 顯示幣別；None = 不更動


class AIModelsRequest(BaseModel):
    aiBaseUrl: str
    aiApiKey: str = ""


# ===== RunningHub Proxy =====


class NodeInfoRequest(BaseModel):
    webappId: str


class SubmitTaskRequest(BaseModel):
    webappId: str
    nodeInfoList: list
    cardId: Optional[str] = None
    cardTitle: Optional[str] = ""


class WorkflowFormatRequest(BaseModel):
    workflowId: str


class SubmitWorkflowRequest(BaseModel):
    workflowId: str
    nodeInfoList: list
    cardId: Optional[str] = None
    cardTitle: Optional[str] = ""
    retainSeconds: int = 60
    instanceType: str = "default"  # default / plus(48G 4090)


class TaskQueryRequest(BaseModel):
    taskId: str


# ===== Admin RunningHub =====


class AppListRequest(BaseModel):
    sort: str = "RECOMMEND"  # RECOMMEND / HOTTEST / NEWEST
    size: int = 10
    page: int = 1
    days: int = 7  # 僅 HOTTEST 使用
