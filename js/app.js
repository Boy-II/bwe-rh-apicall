/**
 * app.js — 應用入口：路由、事件、管理員權限控制
 */

import Config from './config.js';
import CardManager from './cardManager.js';
import NodeRenderer from './nodeRenderer.js';
import TaskManager from './taskManager.js';
import API from './api.js';
import ChatModule from './chatModule.js';

// ===== 全域狀態 =====
const state = {
  currentView: 'home',
  currentCard: null,
  nodeInfoList: null,
  // 管理員狀態
  isAdmin: false,
  adminToken: null,
  // 卡片快取
  cards: [],
  // 編輯中的卡片 (null = 新增)
  editingCardId: null
};

const ADMIN_TOKEN_KEY = 'rh_admin_token';

// ===== DOM 快取 =====
const dom = {};

function cacheDom() {
  dom.viewHome        = document.getElementById('viewHome');
  dom.viewTask        = document.getElementById('viewTask');
  dom.navHome         = document.getElementById('navHome');
  dom.cardGrid        = document.getElementById('cardGrid');
  // 導航列管理員控制
  dom.btnAdminLogin   = document.getElementById('btnAdminLogin');
  dom.adminBadge      = document.getElementById('adminBadge');
  dom.btnAdminLogout  = document.getElementById('btnAdminLogout');
  // 任務頁
  dom.btnBack         = document.getElementById('btnBack');
  dom.taskTitle       = document.getElementById('taskTitle');
  dom.taskWebappId    = document.getElementById('taskWebappId');
  dom.nodeList        = document.getElementById('nodeList');
  dom.btnLoadNodes    = document.getElementById('btnLoadNodes');
  dom.btnRefreshNodes = document.getElementById('btnRefreshNodes');
  dom.btnSubmitTask   = document.getElementById('btnSubmitTask');
  dom.statusBar       = document.getElementById('statusBar');
  dom.statusText      = document.getElementById('statusText');
  dom.resultArea      = document.getElementById('resultArea');
  dom.resultContainer = document.getElementById('resultContainer');
  // 管理員登入 Modal
  dom.adminModalOverlay     = document.getElementById('adminModalOverlay');
  dom.inputAdminPassword    = document.getElementById('inputAdminPassword');
  dom.btnCloseAdminModal    = document.getElementById('btnCloseAdminModal');
  dom.btnCancelAdminModal   = document.getElementById('btnCancelAdminModal');
  dom.btnDoAdminLogin       = document.getElementById('btnDoAdminLogin');
  // 卡片 Modal（管理員）
  dom.cardModalOverlay      = document.getElementById('cardModalOverlay');
  dom.cardModalTitle        = document.getElementById('cardModalTitle');
  dom.cardModalWebappId     = document.getElementById('cardModalWebappId');
  dom.cardModalTitleInput   = document.getElementById('cardModalTitleInput');
  dom.cardModalDescription  = document.getElementById('cardModalDescription');
  dom.iconPicker            = document.getElementById('iconPicker');
  dom.colorPicker           = document.getElementById('colorPicker');
  dom.btnCloseCardModal     = document.getElementById('btnCloseCardModal');
  dom.btnCancelCardModal    = document.getElementById('btnCancelCardModal');
  dom.btnSaveCardModal      = document.getElementById('btnSaveCardModal');
  // Toast
  dom.toastContainer  = document.getElementById('toastContainer');
}

// ===== Toast =====
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// ===== 檢視切換 =====
function switchView(view) {
  state.currentView = view;
  dom.viewHome.classList.toggle('active', view === 'home');
  dom.viewTask.classList.toggle('active', view === 'task');
}

// ===== 管理員狀態 UI =====
function updateAdminUI() {
  if (state.isAdmin) {
    dom.btnAdminLogin.style.display  = 'none';
    dom.adminBadge.style.display     = 'inline-flex';
    dom.btnAdminLogout.style.display = 'inline-flex';
  } else {
    dom.btnAdminLogin.style.display  = 'inline-flex';
    dom.adminBadge.style.display     = 'none';
    dom.btnAdminLogout.style.display = 'none';
  }
}

// ===== 卡片渲染 =====
async function loadAndRenderCards() {
  try {
    const serverCards = await API.getCards();
    state.cards = CardManager.mergeLastUsed(serverCards);
  } catch (e) {
    state.cards = [];
    showToast('無法載入應用列表', 'error');
  }
  renderCards();
  ChatModule.setContext({ cards: state.cards });
}

function renderCards() {
  dom.cardGrid.innerHTML = '';

  if (state.cards.length === 0 && !state.isAdmin) {
    dom.cardGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">🎯</div>
        <p class="empty-state-text">目前沒有可用的 AI 應用<br/>請聯絡管理員新增</p>
      </div>
    `;
    return;
  }

  state.cards.forEach(card => {
    const el = document.createElement('div');
    el.className = 'app-card';
    el.style.setProperty('--card-accent', card.color);
    el.innerHTML = `
      <span class="app-card-icon">${card.icon}</span>
      <div class="app-card-title">${escapeHtml(card.title)}</div>
      <div class="app-card-id">ID: ${card.webappId}</div>
      <div class="app-card-desc">${escapeHtml(card.description) || '<span style="color:var(--text-muted);font-style:italic;">尚未添加說明</span>'}</div>
      <div class="app-card-footer">
        <span class="app-card-time">${card.lastUsedAt ? '最後使用: ' + formatTime(card.lastUsedAt) : '尚未使用'}</span>
        ${state.isAdmin ? `
        <div class="app-card-actions">
          <button class="btn card-edit-btn" data-id="${card.id}" title="編輯">✏️</button>
          <button class="btn btn-danger card-delete-btn" data-id="${card.id}" title="刪除">🗑️</button>
        </div>` : ''}
      </div>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('.card-edit-btn') || e.target.closest('.card-delete-btn')) return;
      openTask(card);
    });

    dom.cardGrid.appendChild(el);
  });

  // 新增按鈕（僅管理員）
  if (state.isAdmin) {
    const addBtn = document.createElement('div');
    addBtn.className = 'add-card';
    addBtn.innerHTML = `<span class="add-card-icon">＋</span><span class="add-card-text">新增 AI 應用</span>`;
    addBtn.addEventListener('click', () => openCardModal());
    dom.cardGrid.appendChild(addBtn);
  }

  // 綁定管理員操作按鈕
  dom.cardGrid.querySelectorAll('.card-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = state.cards.find(c => c.id === btn.dataset.id);
      if (card) openCardModal(card);
    });
  });

  dom.cardGrid.querySelectorAll('.card-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('確定要刪除這個應用嗎？')) return;
      try {
        await API.adminDeleteCard(state.adminToken, btn.dataset.id);
        showToast('已刪除應用', 'info');
        await loadAndRenderCards();
      } catch (err) {
        showToast(`刪除失敗: ${err.message}`, 'error');
      }
    });
  });
}

// ===== 管理員登入 Modal =====
function openAdminModal() {
  dom.inputAdminPassword.value = '';
  dom.adminModalOverlay.classList.add('active');
  setTimeout(() => dom.inputAdminPassword.focus(), 100);
}

function closeAdminModal() {
  dom.adminModalOverlay.classList.remove('active');
}

async function doAdminLogin() {
  const pw = dom.inputAdminPassword.value.trim();
  if (!pw) { showToast('請輸入密碼', 'error'); return; }

  dom.btnDoAdminLogin.disabled = true;
  try {
    const { token } = await API.adminLogin(pw);
    state.isAdmin    = true;
    state.adminToken = token;
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    closeAdminModal();
    updateAdminUI();
    renderCards();
    showToast('管理員登入成功', 'success');
  } catch (err) {
    showToast(err.message, 'error');
    dom.inputAdminPassword.select();
  } finally {
    dom.btnDoAdminLogin.disabled = false;
  }
}

async function doAdminLogout() {
  try { await API.adminLogout(state.adminToken); } catch (_) {}
  state.isAdmin    = false;
  state.adminToken = null;
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  updateAdminUI();
  renderCards();
  showToast('已登出管理員', 'info');
}

// ===== 卡片 Modal（管理員）=====
let selectedIcon  = '🎨';
let selectedColor = '#6C5CE7';

function openCardModal(card = null) {
  state.editingCardId       = card ? card.id : null;
  dom.cardModalTitle.textContent = card ? '編輯 AI 應用' : '新增 AI 應用';

  dom.cardModalWebappId.value      = card ? card.webappId : '';
  dom.cardModalWebappId.disabled   = !!card;
  dom.cardModalTitleInput.value    = card ? card.title : '';
  dom.cardModalDescription.value   = card ? card.description : '';
  selectedIcon  = card ? card.icon  : '🎨';
  selectedColor = card ? card.color : CardManager.PALETTE[state.cards.length % CardManager.PALETTE.length];

  renderIconPicker();
  renderColorPicker();
  dom.cardModalOverlay.classList.add('active');
}

function closeCardModal() {
  dom.cardModalOverlay.classList.remove('active');
  state.editingCardId = null;
}

function renderIconPicker() {
  dom.iconPicker.innerHTML = '';
  CardManager.ICONS.forEach(icon => {
    const el = document.createElement('div');
    el.className = `icon-option ${icon === selectedIcon ? 'selected' : ''}`;
    el.textContent = icon;
    el.addEventListener('click', () => { selectedIcon = icon; renderIconPicker(); });
    dom.iconPicker.appendChild(el);
  });
}

function renderColorPicker() {
  dom.colorPicker.innerHTML = '';
  CardManager.PALETTE.forEach(color => {
    const el = document.createElement('div');
    el.className = `color-option ${color === selectedColor ? 'selected' : ''}`;
    el.style.background = color;
    el.addEventListener('click', () => { selectedColor = color; renderColorPicker(); });
    dom.colorPicker.appendChild(el);
  });
}

async function saveCardModal() {
  const webappId    = dom.cardModalWebappId.value.trim();
  const title       = dom.cardModalTitleInput.value.trim();
  const description = dom.cardModalDescription.value.trim();

  if (!webappId) { showToast('請輸入 Webapp ID', 'error'); return; }

  dom.btnSaveCardModal.disabled = true;
  try {
    if (state.editingCardId) {
      await API.adminUpdateCard(state.adminToken, state.editingCardId, {
        title: title || `應用 ${webappId}`,
        description,
        icon: selectedIcon,
        color: selectedColor
      });
      showToast('已更新應用', 'success');
    } else {
      await API.adminAddCard(state.adminToken, {
        webappId,
        title: title || `應用 ${webappId}`,
        description,
        icon: selectedIcon,
        color: selectedColor
      });
      showToast('已新增應用', 'success');
    }
    closeCardModal();
    await loadAndRenderCards();
  } catch (err) {
    showToast(`儲存失敗: ${err.message}`, 'error');
  } finally {
    dom.btnSaveCardModal.disabled = false;
  }
}

// ===== 任務頁 =====
function openTask(card) {
  state.currentCard = card;
  state.nodeInfoList = null;

  dom.taskTitle.textContent    = `${card.icon} ${card.title}`;
  dom.taskWebappId.textContent = `webappId: ${card.webappId}`;
  dom.nodeList.innerHTML       = '<div class="empty-hint">點擊「載入節點」以獲取可修改的節點列表</div>';
  dom.btnSubmitTask.disabled   = true;
  dom.statusBar.className      = 'status-bar';
  dom.resultArea.style.display = 'none';
  dom.resultContainer.innerHTML = '';

  CardManager.markUsed(card.id);
  ChatModule.setContext({ currentCard: card, nodeInfoList: null });
  switchView('task');
  loadNodes();
}

async function loadNodes() {
  if (!state.currentCard) return;

  dom.nodeList.innerHTML = `
    <div class="empty-hint">
      <div class="loading-dots"><span></span><span></span><span></span></div>
      <p style="margin-top:0.8rem;">正在載入節點資訊...</p>
    </div>
  `;
  dom.btnLoadNodes.disabled = true;

  try {
    const nodeInfoList = await API.getNodeInfo(state.currentCard.webappId);
    state.nodeInfoList = nodeInfoList;
    NodeRenderer.render(nodeInfoList, dom.nodeList);
    dom.btnSubmitTask.disabled = false;
    showToast(`已載入 ${nodeInfoList.length} 個節點`, 'success');
    ChatModule.setContext({ nodeInfoList });
  } catch (err) {
    dom.nodeList.innerHTML = `<div class="empty-hint" style="color:var(--danger);">❌ 載入失敗: ${escapeHtml(err.message)}</div>`;
    showToast(`載入失敗: ${err.message}`, 'error');
  } finally {
    dom.btnLoadNodes.disabled = false;
  }
}

async function submitTask() {
  if (!state.currentCard || !state.nodeInfoList) return;

  const updatedList = NodeRenderer.collectValues(state.nodeInfoList, dom.nodeList);
  dom.btnSubmitTask.disabled = true;
  dom.btnLoadNodes.disabled  = true;
  dom.resultArea.style.display = 'none';
  showStatus('⏳ 正在提交任務...', 'loading');

  await TaskManager.submitAndTrack(
    state.currentCard.webappId,
    state.currentCard.title,
    updatedList,
    {
      onSubmitted: (taskId) => showStatus(`📝 任務已提交 (ID: ${taskId})，排隊中...`, 'loading'),
      onProgress: (status) => {
        const map = { QUEUED: '⏳ 排隊等待中...', RUNNING: '🔄 任務執行中...', SUCCESS: '✅ 生成完成！', FAILED: '❌ 任務失敗' };
        showStatus(map[status] || `狀態: ${status}`, status === 'RUNNING' ? 'loading' : '');
      },
      onSuccess: (outputs) => {
        showStatus('✅ 生成完成！', 'success');
        dom.resultArea.style.display = 'block';
        TaskManager.renderResults(outputs, dom.resultContainer);
        showToast('任務已完成！', 'success');
      },
      onFailed: (msg) => { showStatus(`❌ ${msg}`, 'error'); showToast(`任務失敗: ${msg}`, 'error'); },
      onError:  (msg) => { showStatus(`❌ ${msg}`, 'error'); showToast(`錯誤: ${msg}`, 'error'); }
    }
  );

  dom.btnSubmitTask.disabled = false;
  dom.btnLoadNodes.disabled  = false;
}

function showStatus(text, type = '') {
  dom.statusBar.className = `status-bar active ${type}`;
  dom.statusText.textContent = text;
  const spinner = dom.statusBar.querySelector('.status-spinner');
  if (spinner) spinner.style.display = type === 'loading' ? 'block' : 'none';
}

// ===== AI 助手：套用提示詞 =====
function applyPromptToForm(text) {
  if (!state.nodeInfoList) {
    showToast('請先載入節點', 'error');
    return;
  }
  // 找第一個 STRING 類型節點的 index
  const stringIndex = state.nodeInfoList.findIndex(n => n.fieldType === 'STRING');
  if (stringIndex === -1) {
    showToast('目前節點沒有文字輸入欄位', 'error');
    return;
  }
  const textarea = dom.nodeList.querySelector(`textarea[data-node-index="${stringIndex}"]`);
  if (!textarea) {
    showToast('找不到文字輸入欄位', 'error');
    return;
  }
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
  textarea.focus();
  showToast('✅ 提示詞已套用', 'success');
}

// ===== 工具 =====
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(isoStr) {
  try {
    const diff = Date.now() - new Date(isoStr);
    if (diff < 60000)    return '剛剛';
    if (diff < 3600000)  return `${Math.floor(diff / 60000)} 分鐘前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小時前`;
    return new Date(isoStr).toLocaleDateString('zh-TW');
  } catch { return ''; }
}

// ===== 事件綁定 =====
function bindEvents() {
  dom.navHome.addEventListener('click', () => { switchView('home'); loadAndRenderCards(); });

  // 管理員登入/登出
  dom.btnAdminLogin.addEventListener('click', openAdminModal);
  dom.btnAdminLogout.addEventListener('click', doAdminLogout);
  dom.btnCloseAdminModal.addEventListener('click', closeAdminModal);
  dom.btnCancelAdminModal.addEventListener('click', closeAdminModal);
  dom.btnDoAdminLogin.addEventListener('click', doAdminLogin);
  dom.adminModalOverlay.addEventListener('click', (e) => { if (e.target === dom.adminModalOverlay) closeAdminModal(); });
  dom.inputAdminPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdminLogin(); });

  // 卡片 Modal
  dom.btnCloseCardModal.addEventListener('click', closeCardModal);
  dom.btnCancelCardModal.addEventListener('click', closeCardModal);
  dom.btnSaveCardModal.addEventListener('click', saveCardModal);
  dom.cardModalOverlay.addEventListener('click', (e) => { if (e.target === dom.cardModalOverlay) closeCardModal(); });

  // 任務頁
  dom.btnBack.addEventListener('click', () => {
    ChatModule.setContext({ currentCard: null, nodeInfoList: null });
    switchView('home');
    loadAndRenderCards();
  });
  dom.btnLoadNodes.addEventListener('click', loadNodes);
  dom.btnRefreshNodes.addEventListener('click', loadNodes);
  dom.btnSubmitTask.addEventListener('click', submitTask);

  // ESC
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (dom.adminModalOverlay.classList.contains('active')) closeAdminModal();
    if (dom.cardModalOverlay.classList.contains('active'))  closeCardModal();
  });
}

// ===== 初始化 =====
async function init() {
  cacheDom();
  bindEvents();
  ChatModule.init({ onApplyPrompt: applyPromptToForm });
  await Config.init();

  // 嘗試恢復管理員 Session
  const savedToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (savedToken) {
    try {
      const { valid } = await API.adminVerify(savedToken);
      if (valid) {
        state.isAdmin    = true;
        state.adminToken = savedToken;
      } else {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      }
    } catch (_) {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    }
  }

  updateAdminUI();
  await loadAndRenderCards();
  console.log('[App] RunningHub Client 已初始化 ✅');
}

document.addEventListener('DOMContentLoaded', init);
