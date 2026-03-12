/**
 * nodeRenderer.js — 根據 nodeInfoList 動態渲染表單
 */

import API from './api.js';

const NodeRenderer = (() => {

  /**
   * 根據 nodeInfoList 渲染表單
   * @param {Array} nodeInfoList
   * @param {HTMLElement} container
   */
  function render(nodeInfoList, container) {
    container.innerHTML = '';

    if (!nodeInfoList || nodeInfoList.length === 0) {
      container.innerHTML = '<p class="empty-hint">此工作流沒有可修改的節點</p>';
      return;
    }

    nodeInfoList.forEach((node, index) => {
      const card = document.createElement('div');
      card.className = 'node-card';
      card.dataset.index = index;

      // 標題：優先用中文 description，其次 descriptionEn，最後 fieldName
      const displayLabel = node.description || node.descriptionEn || node.fieldName;

      const header = document.createElement('div');
      header.className = 'node-card-header';
      header.innerHTML = `
        <span class="node-display-label">${escapeHtml(displayLabel)}</span>
        <div class="node-badges">
          <span class="node-id-badge">#${node.nodeId}</span>
          <span class="node-type-badge type-${(node.fieldType || '').toLowerCase()}">${node.fieldType || 'UNKNOWN'}</span>
        </div>
      `;

      const field = createFieldInput(node, index, displayLabel);

      card.appendChild(header);
      card.appendChild(field);
      container.appendChild(card);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  /**
   * 根據 fieldType 建立對應的表單元件
   */
  function createFieldInput(node, index, displayLabel) {
    const wrapper = document.createElement('div');
    wrapper.className = 'node-field-wrapper';

    const type = (node.fieldType || '').toUpperCase();

    switch (type) {
      case 'STRING':
        wrapper.appendChild(createTextInput(node, index));
        break;
      case 'INT':
        wrapper.appendChild(createNumberInput(node, index, true));
        break;
      case 'FLOAT':
        wrapper.appendChild(createNumberInput(node, index, false));
        break;
      case 'IMAGE':
      case 'VIDEO':
      case 'AUDIO':
        wrapper.appendChild(createFileInput(node, index, type.toLowerCase()));
        break;
      case 'LIST':
        wrapper.appendChild(createListInput(node, index));
        break;
      case 'BOOLEAN':
        wrapper.appendChild(createBoolInput(node, index));
        break;
      default:
        wrapper.appendChild(createTextInput(node, index));
    }

    return wrapper;
  }

  function createTextInput(node, index) {
    const el = document.createElement('textarea');
    el.rows = 4;
    el.className = 'node-input';
    el.value = node.fieldValue || '';
    el.placeholder = `輸入 ${node.fieldName}...`;
    el.dataset.nodeIndex = index;
    el.dataset.fieldName = node.fieldName;
    return el;
  }

  function createNumberInput(node, index, isInt) {
    const el = document.createElement('input');
    el.type = 'number';
    el.className = 'node-input';
    el.value = node.fieldValue || '';
    el.step = isInt ? '1' : '0.01';
    el.dataset.nodeIndex = index;
    el.dataset.fieldName = node.fieldName;
    return el;
  }

  function createFileInput(node, index, fileType) {
    const container = document.createElement('div');
    container.className = 'file-upload-area';

    // 當前值顯示
    const current = document.createElement('div');
    current.className = 'file-current';
    current.textContent = node.fieldValue ? `目前: ${node.fieldValue}` : '尚未上傳';
    container.appendChild(current);

    // 檔案選擇
    const input = document.createElement('input');
    input.type = 'file';
    input.className = 'file-input';
    input.id = `file-${index}`;
    input.dataset.nodeIndex = index;
    input.dataset.fieldName = node.fieldName;
    input.dataset.fileType = fileType;

    const acceptMap = {
      image: 'image/*',
      video: 'video/*',
      audio: 'audio/*'
    };
    input.accept = acceptMap[fileType] || '*/*';

    const label = document.createElement('label');
    label.className = 'file-upload-btn';
    label.htmlFor = `file-${index}`;
    label.innerHTML = `<span class="file-icon">📂</span> 選擇${fileType === 'image' ? '圖片' : fileType === 'video' ? '影片' : '音訊'}`;

    // 上傳狀態
    const status = document.createElement('div');
    status.className = 'file-status';
    status.id = `file-status-${index}`;

    // 預覽
    const preview = document.createElement('div');
    preview.className = 'file-preview';
    preview.id = `file-preview-${index}`;

    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // 顯示預覽
      showPreview(preview, file, fileType);

      // 上傳
      status.innerHTML = '<span class="uploading">⏳ 上傳中...</span>';
      try {
        const result = await API.uploadFile(file, fileType);
        status.innerHTML = `<span class="upload-success">✅ 上傳成功</span>`;
        current.textContent = `目前: ${result.fileName}`;
        // 更新 data attribute 以便後續讀取
        input.dataset.uploadedFileName = result.fileName;
      } catch (err) {
        status.innerHTML = `<span class="upload-error">❌ ${err.message}</span>`;
      }
    });

    container.appendChild(input);
    container.appendChild(label);
    container.appendChild(status);
    container.appendChild(preview);
    return container;
  }

  function showPreview(container, file, type) {
    container.innerHTML = '';
    if (type === 'image') {
      const img = document.createElement('img');
      img.className = 'preview-img';
      img.src = URL.createObjectURL(file);
      container.appendChild(img);
    } else if (type === 'video') {
      const vid = document.createElement('video');
      vid.className = 'preview-video';
      vid.src = URL.createObjectURL(file);
      vid.controls = true;
      container.appendChild(vid);
    } else if (type === 'audio') {
      const aud = document.createElement('audio');
      aud.className = 'preview-audio';
      aud.src = URL.createObjectURL(file);
      aud.controls = true;
      container.appendChild(aud);
    }
  }

  function createListInput(node, index) {
    const select = document.createElement('select');
    select.className = 'node-input node-select';
    select.dataset.nodeIndex = index;
    select.dataset.fieldName = node.fieldName;

    // fieldData 格式：[[選項1, 選項2, ...], {"default": "..."}]
    // 取第一個元素（選項陣列），忽略第二個（config 物件）
    let options = [];
    if (node.fieldData) {
      try {
        const parsed = typeof node.fieldData === 'string'
          ? JSON.parse(node.fieldData)
          : node.fieldData;
        if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
          options = parsed[0]; // ← 正確格式：[[...], {config}]
        } else if (Array.isArray(parsed)) {
          options = parsed.filter(o => typeof o === 'string' || typeof o === 'number');
        }
      } catch {
        options = node.fieldValue ? [node.fieldValue] : [];
      }
    }

    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      if (String(opt) === String(node.fieldValue)) option.selected = true;
      select.appendChild(option);
    });

    return select;
  }

  function createBoolInput(node, index) {
    const container = document.createElement('div');
    container.className = 'bool-toggle';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'bool-checkbox';
    input.id = `bool-${index}`;
    input.checked = node.fieldValue === true || node.fieldValue === 'true';
    input.dataset.nodeIndex = index;
    input.dataset.fieldName = node.fieldName;

    const label = document.createElement('label');
    label.className = 'bool-label';
    label.htmlFor = `bool-${index}`;
    label.textContent = input.checked ? '啟用' : '停用';

    input.addEventListener('change', () => {
      label.textContent = input.checked ? '啟用' : '停用';
    });

    container.appendChild(input);
    container.appendChild(label);
    return container;
  }

  /**
   * 從渲染的表單中收集修改後的 nodeInfoList
   * @param {Array} originalList - 原始 nodeInfoList
   * @param {HTMLElement} container - 表單容器
   * @returns {Array} 修改後的 nodeInfoList
   */
  function collectValues(originalList, container) {
    const updated = JSON.parse(JSON.stringify(originalList));

    // 文字/數值欄位
    container.querySelectorAll('.node-input').forEach(input => {
      const idx = parseInt(input.dataset.nodeIndex);
      if (isNaN(idx)) return;
      if (input.tagName === 'SELECT') {
        updated[idx].fieldValue = input.value;
      } else {
        updated[idx].fieldValue = input.value;
      }
    });

    // 布林欄位
    container.querySelectorAll('.bool-checkbox').forEach(input => {
      const idx = parseInt(input.dataset.nodeIndex);
      if (isNaN(idx)) return;
      updated[idx].fieldValue = input.checked;
    });

    // 檔案上傳欄位（已上傳的）
    container.querySelectorAll('.file-input').forEach(input => {
      const idx = parseInt(input.dataset.nodeIndex);
      if (isNaN(idx)) return;
      if (input.dataset.uploadedFileName) {
        updated[idx].fieldValue = input.dataset.uploadedFileName;
      }
    });

    return updated;
  }

  return { render, collectValues };
})();

export default NodeRenderer;
