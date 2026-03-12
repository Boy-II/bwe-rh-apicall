/**
 * taskManager.js — 任務提交與狀態管理
 */

import API from './api.js';

const TaskManager = (() => {
  const HISTORY_KEY = 'rh_task_history';

  /** 取得任務歷史 */
  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch {
      return [];
    }
  }

  /** 儲存任務到歷史 */
  function saveToHistory(task) {
    const history = getHistory();
    history.unshift(task); // 最新在前
    if (history.length > 50) history.pop(); // 最多保留 50 筆
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  /** 更新歷史中的任務 */
  function updateHistory(taskId, updates) {
    const history = getHistory();
    const idx = history.findIndex(t => t.taskId === taskId);
    if (idx !== -1) {
      Object.assign(history[idx], updates);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }
  }

  /**
   * 提交任務並開始追蹤
   * @param {string} webappId
   * @param {string} cardTitle - 卡片標題（用於歷史記錄）
   * @param {Array} nodeInfoList
   * @param {object} callbacks - { onSubmitted, onProgress, onSuccess, onFailed, onError }
   */
  async function submitAndTrack(webappId, cardTitle, nodeInfoList, callbacks = {}) {
    const { onSubmitted, onProgress, onSuccess, onFailed, onError } = callbacks;

    try {
      // 1. 提交任務
      const submitResult = await API.submitTask(webappId, nodeInfoList);
      const taskId = submitResult.taskId;

      // 檢查 promptTips 中的 node_errors
      if (submitResult.promptTips) {
        try {
          const tips = typeof submitResult.promptTips === 'string'
            ? JSON.parse(submitResult.promptTips)
            : submitResult.promptTips;
          if (tips.node_errors && Object.keys(tips.node_errors).length > 0) {
            const errorMsg = `節點錯誤: ${JSON.stringify(tips.node_errors)}`;
            if (onError) onError(errorMsg);
            return;
          }
        } catch { /* 忽略解析錯誤 */ }
      }

      // 儲存到歷史
      const historyEntry = {
        taskId,
        webappId,
        cardTitle,
        status: 'QUEUED',
        submittedAt: new Date().toISOString(),
        completedAt: null,
        results: null
      };
      saveToHistory(historyEntry);

      if (onSubmitted) onSubmitted(taskId);

      // 2. 開始輪詢
      const result = await API.pollTask(taskId, (status, data) => {
        updateHistory(taskId, { status });
        if (onProgress) onProgress(status, data);
      });

      // 3. 成功
      // v2 query: {status, results: [{url, outputType}], usage: {taskCostTime}}
      // 舊版 API:  {taskStatus, fileUrl, fileType, taskCostTime}
      const costTime = result.usage?.taskCostTime || result.taskCostTime;
      let outputs;
      if (result.results && Array.isArray(result.results) && result.results.length > 0) {
        outputs = result.results.map(r => ({
          fileUrl: r.url,
          fileType: r.outputType || r.fileType || '',
          taskCostTime: costTime
        }));
      } else if (result.fileUrl) {
        outputs = [{ fileUrl: result.fileUrl, fileType: result.fileType, taskCostTime: costTime }];
      } else {
        outputs = [];
      }

      updateHistory(taskId, {
        status: 'SUCCESS',
        completedAt: new Date().toISOString(),
        results: outputs
      });

      if (onSuccess) onSuccess(outputs, taskId);

    } catch (err) {
      if (onFailed) onFailed(err.message);
      if (onError) onError(err.message);
    }
  }

  /**
   * 渲染結果到容器
   * @param {Array} outputs - [{fileUrl, fileType, taskCostTime}]
   * @param {HTMLElement} container
   */
  function renderResults(outputs, container) {
    container.innerHTML = '';

    if (!outputs || outputs.length === 0) {
      container.innerHTML = '<p class="empty-hint">沒有生成結果</p>';
      return;
    }

    const list = Array.isArray(outputs) ? outputs : [outputs];

    list.forEach(output => {
      const item = document.createElement('div');
      item.className = 'result-item';

      const fileUrl = output.fileUrl;
      const fileType = (output.fileType || '').toLowerCase();

      if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'image'].some(t => fileType.includes(t)) || fileUrl?.match(/\.(png|jpg|jpeg|webp|gif)/i)) {
        item.innerHTML = `
          <img src="${fileUrl}" class="result-image" alt="生成結果" loading="lazy" />
          <div class="result-meta">
            ${output.taskCostTime ? `<span>⏱️ ${output.taskCostTime}s</span>` : ''}
            <a href="${fileUrl}" target="_blank" class="result-download" download>⬇️ 下載</a>
          </div>
        `;
      } else if (['mp4', 'webm', 'mov', 'video'].some(t => fileType.includes(t)) || fileUrl?.match(/\.(mp4|webm|mov)/i)) {
        item.innerHTML = `
          <video src="${fileUrl}" class="result-video" controls></video>
          <div class="result-meta">
            ${output.taskCostTime ? `<span>⏱️ ${output.taskCostTime}s</span>` : ''}
            <a href="${fileUrl}" target="_blank" class="result-download" download>⬇️ 下載</a>
          </div>
        `;
      } else if (['mp3', 'wav', 'ogg', 'audio'].some(t => fileType.includes(t)) || fileUrl?.match(/\.(mp3|wav|ogg)/i)) {
        item.innerHTML = `
          <audio src="${fileUrl}" class="result-audio" controls></audio>
          <div class="result-meta">
            ${output.taskCostTime ? `<span>⏱️ ${output.taskCostTime}s</span>` : ''}
            <a href="${fileUrl}" target="_blank" class="result-download" download>⬇️ 下載</a>
          </div>
        `;
      } else {
        item.innerHTML = `
          <div class="result-file">
            <span class="file-icon-large">📄</span>
            <a href="${fileUrl}" target="_blank">${fileUrl}</a>
          </div>
        `;
      }

      container.appendChild(item);
    });
  }

  return { submitAndTrack, renderResults, getHistory };
})();

export default TaskManager;
