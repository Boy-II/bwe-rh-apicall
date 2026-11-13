"""本地 ComfyUI 代理：透過 Cloudflare Tunnel（Access Service Token）呼叫工作站的 ComfyUI。

流程：上傳圖片 /upload/image → 送出 /prompt → 查 /history、/queue → 下載 /view 存到自有媒體。
"""

import copy
import logging
import secrets
from pathlib import PurePosixPath

import httpx
from fastapi import HTTPException

from app.core import config
from app.services import media, runninghub

logger = logging.getLogger(__name__)

CLIENT_ID = "bwe-rhapi"
_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=60.0, pool=10.0)
_DOWNLOAD_TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=60.0, pool=10.0)
_OUTPUT_KEYS = ("images", "gifs", "videos", "video", "audio")


def configured() -> bool:
    return bool(config.COMFYUI_BASE_URL)


def _headers() -> dict[str, str]:
    h = {}
    if config.COMFYUI_CF_ACCESS_CLIENT_ID:
        h["CF-Access-Client-Id"] = config.COMFYUI_CF_ACCESS_CLIENT_ID
        h["CF-Access-Client-Secret"] = config.COMFYUI_CF_ACCESS_CLIENT_SECRET
    return h


async def _request(method: str, path: str, *, timeout=_TIMEOUT, **kw) -> httpx.Response:
    if not configured():
        raise HTTPException(status_code=503, detail="本地 ComfyUI 未設定（COMFYUI_BASE_URL）")
    try:
        resp = await runninghub.client().request(
            method, f"{config.COMFYUI_BASE_URL}{path}", headers=_headers(),
            timeout=timeout, follow_redirects=False, **kw,
        )
    except httpx.HTTPError as e:
        logger.warning("ComfyUI %s %s 失敗: %s", method, path, e)
        raise HTTPException(status_code=502, detail="本地 ComfyUI 無法連線，請確認工作站與 ComfyUI 已開啟") from None
    if resp.status_code in (301, 302, 303, 307, 401, 403):
        raise HTTPException(status_code=502, detail="本地 ComfyUI 存取被 Cloudflare Access 拒絕，請檢查 Service Token")
    if resp.status_code in (502, 503, 504, 530):
        raise HTTPException(status_code=502, detail="本地 ComfyUI 離線（Tunnel 未連線或 ComfyUI 未啟動）")
    return resp


# ===== workflow =====


def validate_workflow(wf) -> dict:
    """確認是 API 格式（{node_id: {class_type, inputs}}）；UI 格式給出明確提示。"""
    if not isinstance(wf, dict) or not wf:
        raise HTTPException(status_code=400, detail="ComfyUI workflow 必須是 JSON 物件")
    if "nodes" in wf and "links" in wf:
        raise HTTPException(
            status_code=400,
            detail="這是 ComfyUI 的 UI 格式；請在 ComfyUI 選單用「Export (API)」匯出 API 格式 JSON",
        )
    for node_id, node in wf.items():
        if not isinstance(node, dict) or "class_type" not in node or not isinstance(node.get("inputs"), dict):
            raise HTTPException(status_code=400, detail=f"節點 {node_id} 不是 API 格式（缺 class_type / inputs）")
    return wf


def _coerce(value, original):
    if isinstance(original, bool):
        return value if isinstance(value, bool) else str(value).strip().lower() in ("1", "true", "yes", "on")
    if isinstance(original, int):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"欄位值需為整數：{value}") from None
    if isinstance(original, float):
        try:
            return float(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"欄位值需為數字：{value}") from None
    return "" if value is None else str(value)


SEED_FIELDS = ("seed", "noise_seed")
_MAX_SEED = 2**50


def build_prompt(workflow: dict, editable_fields: list, node_info_list: list) -> dict:
    """套用使用者輸入；只允許卡片白名單內的欄位，其餘用管理端設定的 workflow 值。

    不公開的 seed / noise_seed 欄位每次執行都隨機產生。
    """
    prompt = copy.deepcopy(workflow)
    allowed = {(str(e.get("nodeId")), str(e.get("fieldName"))) for e in editable_fields or []}
    for node_id, node in prompt.items():
        for field in SEED_FIELDS:
            value = node.get("inputs", {}).get(field)
            if isinstance(value, int) and not isinstance(value, bool) and (node_id, field) not in allowed:
                node["inputs"][field] = secrets.randbelow(_MAX_SEED)
    for item in node_info_list or []:
        if not isinstance(item, dict):
            continue
        key = (str(item.get("nodeId")), str(item.get("fieldName")))
        node = prompt.get(key[0])
        if key not in allowed or not isinstance(node, dict) or key[1] not in node.get("inputs", {}):
            continue
        original = node["inputs"][key[1]]
        if isinstance(original, list):  # 連線不可改
            continue
        node["inputs"][key[1]] = _coerce(item.get("fieldValue"), original)
    return prompt


# ===== API =====


async def upload_image(filename: str, content: bytes, content_type: str) -> str:
    resp = await _request(
        "POST", "/upload/image",
        files={"image": (filename or "upload.png", content, content_type or "application/octet-stream")},
        data={"type": "input", "overwrite": "false"},
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"上傳到 ComfyUI 失敗（HTTP {resp.status_code}）")
    data = resp.json()
    name = data.get("name") or ""
    return f"{data['subfolder']}/{name}" if data.get("subfolder") else name


async def submit(prompt: dict) -> str:
    resp = await _request("POST", "/prompt", json={"prompt": prompt, "client_id": CLIENT_ID})
    data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    if resp.status_code != 200 or not data.get("prompt_id"):
        err = data.get("error") or {}
        msg = err.get("message") if isinstance(err, dict) else str(err)
        node_errors = data.get("node_errors") or {}
        details = []
        for nid, ne in node_errors.items():
            for e in (ne or {}).get("errors", [])[:2]:
                details.append(f"節點 {nid}（{ne.get('class_type', '')}）：{e.get('message', '')} {e.get('details', '')}".strip())
        detail = "；".join([msg or f"HTTP {resp.status_code}", *details])
        raise HTTPException(status_code=400, detail=f"ComfyUI 拒絕此任務：{detail}")
    return data["prompt_id"]


def _error_text(status: dict) -> str:
    for kind, msg in status.get("messages") or []:
        if kind == "execution_error" and isinstance(msg, dict):
            return f"{msg.get('node_type', '')}：{msg.get('exception_message', '').strip()}".strip("：")
        if kind == "execution_interrupted":
            return "任務已被中斷"
    return "ComfyUI 執行失敗"


async def query(prompt_id: str) -> dict:
    """回傳 {status, outputs, error}；status ∈ QUEUED/RUNNING/SUCCESS/FAILED。"""
    resp = await _request("GET", f"/history/{prompt_id}")
    hist = (resp.json() or {}).get(prompt_id) if resp.status_code == 200 else None
    if hist:
        st = hist.get("status") or {}
        if st.get("status_str") == "error":
            return {"status": "FAILED", "outputs": [], "error": _error_text(st)}
        if st.get("completed", True):
            outputs = []
            for node_out in (hist.get("outputs") or {}).values():
                for key in _OUTPUT_KEYS:
                    for f in node_out.get(key) or []:
                        if isinstance(f, dict) and f.get("filename") and f.get("type", "output") == "output":
                            outputs.append(f)
            return {"status": "SUCCESS", "outputs": outputs, "error": None}
    q = (await _request("GET", "/queue")).json()
    if any(len(x) > 1 and x[1] == prompt_id for x in q.get("queue_running") or []):
        return {"status": "RUNNING", "outputs": [], "error": None}
    if any(len(x) > 1 and x[1] == prompt_id for x in q.get("queue_pending") or []):
        return {"status": "QUEUED", "outputs": [], "error": None}
    return {"status": "FAILED", "outputs": [], "error": "ComfyUI 找不到此任務（工作站可能已重啟）"}


async def cancel(prompt_id: str) -> None:
    q = (await _request("GET", "/queue")).json()
    if any(len(x) > 1 and x[1] == prompt_id for x in q.get("queue_running") or []):
        await _request("POST", "/interrupt", json={"prompt_id": prompt_id})
    await _request("POST", "/queue", json={"delete": [prompt_id]})


async def save_output(f: dict) -> dict:
    """下載一個輸出檔存到自有媒體，回傳 {url, fileType}。"""
    resp = await _request(
        "GET", "/view",
        params={"filename": f["filename"], "subfolder": f.get("subfolder", ""), "type": f.get("type", "output")},
        timeout=_DOWNLOAD_TIMEOUT,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"下載 ComfyUI 結果失敗（HTTP {resp.status_code}）")
    ext = PurePosixPath(f["filename"]).suffix.lower().lstrip(".")
    if ext not in media.EXTS:
        try:
            ext = media.image_ext(resp.content)
        except media.MediaError:
            raise HTTPException(status_code=502, detail=f"不支援的輸出格式：{f['filename']}") from None
    return {"url": media.save_bytes("results", resp.content, ext), "fileType": ext}
