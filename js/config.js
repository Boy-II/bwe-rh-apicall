/**
 * config.js — 前端設定模組
 * API Key 由後端 config.json / 環境變數管理，前端不涉及
 */

import API from './api.js';

const Config = (() => {
  let _config = {
    pollingInterval: 3000,
    maxPollingRetries: 200
  };

  async function init() {
    try {
      const status = await API.getConfigStatus();
      if (status.pollingInterval) _config.pollingInterval = status.pollingInterval;
      if (status.maxPollingRetries) _config.maxPollingRetries = status.maxPollingRetries;
    } catch (e) {
      console.warn('[Config] 無法取得後端狀態:', e);
    }
  }

  function get() {
    return { ..._config };
  }

  return { init, get };
})();

export default Config;
