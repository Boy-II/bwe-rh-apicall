/**
 * api.js — 透過本地 Python 後端代理呼叫 RunningHub API
 */

const API = (() => {

  /** 通用 JSON POST 請求（呼叫本地後端） */
  async function postJSON(endpoint, body = {}, headers = {}) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.code !== undefined && data.code !== 0) {
      throw new Error(`[${data.msg}] ${JSON.stringify(data)}`);
    }
    return data;
  }

  // ===== RunningHub 代理 API =====

  async function getNodeInfo(webappId) {
    const data = await postJSON('/api/proxy/getNodeInfo', { webappId });
    if (data.data && data.data.nodeInfoList) return data.data.nodeInfoList;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }

  async function uploadFile(file, fileType = 'image') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('fileType', fileType);
    const res = await fetch('/api/proxy/uploadFile', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `上傳失敗: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.code !== 0) throw new Error(`上傳失敗: ${data.msg}`);
    return data.data;
  }

  async function submitTask(webappId, nodeInfoList) {
    const data = await postJSON('/api/proxy/submitTask', { webappId, nodeInfoList });
    return data.data || data;
  }

  async function queryTaskOutputs(taskId) {
    const data = await postJSON('/api/proxy/queryTaskOutputs', { taskId });
    return data.data || data;
  }

  async function pollTask(taskId, onProgress = () => {}, options = {}) {
    const interval = options.interval || 3000;
    const maxRetries = options.maxRetries || 200;
    for (let i = 0; i < maxRetries; i++) {
      const result = await queryTaskOutputs(taskId);
      const status = result.status || result.taskStatus;
      onProgress(status, result);
      if (status === 'SUCCESS') return result;
      if (status === 'FAILED' || status === 'TIMEOUT') {
        throw new Error(`任務失敗: ${result.errorMessage || result.failedReason || '未知錯誤'}`);
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error('輪詢逾時：超過最大重試次數');
  }

  async function getConfigStatus() {
    const res = await fetch('/api/config/status');
    return await res.json();
  }

  // ===== 管理員認證 API =====

  async function adminLogin(password) {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || '密碼錯誤');
    }
    return await res.json();
  }

  async function adminLogout(token) {
    await fetch('/api/admin/logout', {
      method: 'POST',
      headers: { 'X-Admin-Token': token }
    });
  }

  async function adminVerify(token) {
    const res = await fetch('/api/admin/verify', {
      headers: { 'X-Admin-Token': token }
    });
    return await res.json();
  }

  // ===== 卡片管理 API =====

  async function getCards() {
    const res = await fetch('/api/cards');
    const data = await res.json();
    return data.cards || [];
  }

  async function adminAddCard(token, cardData) {
    const res = await fetch('/api/admin/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify(cardData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return await res.json();
  }

  async function adminUpdateCard(token, id, updates) {
    const res = await fetch(`/api/admin/cards/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return await res.json();
  }

  async function adminDeleteCard(token, id) {
    const res = await fetch(`/api/admin/cards/${id}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': token }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return await res.json();
  }

  // ===== AI 設定 API =====

  async function adminGetAIConfig(token) {
    const res = await fetch('/api/admin/ai-config', {
      headers: { 'X-Admin-Token': token }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return await res.json();
  }

  async function adminSaveAIConfig(token, cfg) {
    const res = await fetch('/api/admin/ai-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify(cfg)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return await res.json();
  }

  async function adminFetchAIModels(token, aiBaseUrl, aiApiKey) {
    const res = await fetch('/api/admin/ai-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify({ aiBaseUrl, aiApiKey })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return await res.json();
  }

  return {
    getNodeInfo, uploadFile, submitTask, queryTaskOutputs, pollTask, getConfigStatus,
    adminLogin, adminLogout, adminVerify,
    getCards, adminAddCard, adminUpdateCard, adminDeleteCard,
    adminGetAIConfig, adminSaveAIConfig, adminFetchAIModels
  };
})();

export default API;
