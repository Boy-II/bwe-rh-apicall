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


class CardCreate(BaseModel):
    webappId: str
    title: str
    description: str = ""
    icon: str = "🎨"
    color: str = "#6C5CE7"


class CardUpdate(BaseModel):
    title: str
    description: str = ""
    icon: str
    color: str


# ===== AI =====


class AIChatRequest(BaseModel):
    message: str
    history: list = []
    context: dict = {}
    image: str = ""  # base64 data URL


class AIConfigRequest(BaseModel):
    aiBaseUrl: str = ""
    aiApiKey: str = ""
    aiModel: str = ""


class AIModelsRequest(BaseModel):
    aiBaseUrl: str
    aiApiKey: str = ""


# ===== RunningHub Proxy =====


class NodeInfoRequest(BaseModel):
    webappId: str


class SubmitTaskRequest(BaseModel):
    webappId: str
    nodeInfoList: list


class TaskQueryRequest(BaseModel):
    taskId: str
