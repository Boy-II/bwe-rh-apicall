/**
 * chatModule.js — AI 助手側邊欄：UI 控制、訊息收發、prompt 套用
 */

const ChatModule = (() => {
  // ===== 內部狀態 =====
  let _context = { cards: [], currentCard: null, nodeInfoList: null };
  let _history = [];   // [{role: 'user'|'model', text: '...'}]
  let _onApplyPrompt = null;
  let _isLoading = false;
  let _pendingImage = null;   // base64 data URL of pending image

  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;  // 2 MB

  // ===== DOM 參照 =====
  let _sidebar, _messages, _input, _btnSend, _btnClose, _btnToggle, _backdrop;
  let _imageInput, _imagePreview, _imageThumb, _btnClearImage, _btnClearChat;

  // ===== 初始化 =====
  function init({ onApplyPrompt } = {}) {
    _onApplyPrompt = onApplyPrompt || null;

    _sidebar       = document.getElementById('chatSidebar');
    _messages      = document.getElementById('chatMessages');
    _input         = document.getElementById('chatInput');
    _btnSend       = document.getElementById('btnChatSend');
    _btnClose      = document.getElementById('btnChatClose');
    _btnToggle     = document.getElementById('btnChatToggle');
    _backdrop      = document.getElementById('chatBackdrop');
    _imageInput    = document.getElementById('chatImageInput');
    _imagePreview  = document.getElementById('chatImagePreview');
    _imageThumb    = document.getElementById('chatImageThumb');
    _btnClearImage = document.getElementById('btnClearChatImage');
    _btnClearChat  = document.getElementById('btnClearChat');

    _btnToggle.addEventListener('click', toggle);
    _btnClose.addEventListener('click', close);
    _backdrop.addEventListener('click', close);
    _btnSend.addEventListener('click', sendMessage);
    _input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // 圖片上傳
    _imageInput.addEventListener('change', _onImageSelected);
    _btnClearImage.addEventListener('click', _clearPendingImage);

    // 清除對話
    if (_btnClearChat) _btnClearChat.addEventListener('click', clearHistory);

    // ESC 關閉
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _sidebar.classList.contains('active')) close();
    });

    // 顯示歡迎訊息
    _appendMessage('model', [{ type: 'text', content: '您好！我是 BWE-RH AI 助手 🤖\n可以問我關於 AI 應用選擇或提示詞撰寫的問題。\n\n支援傳送圖片（最大 2MB）一起提問。' }]);
  }

  // ===== 開關側邊欄 =====
  function open() {
    _sidebar.classList.add('active');
    _backdrop.classList.add('active');
    document.body.classList.add('chat-open');
    setTimeout(() => _input.focus(), 300);
  }

  function close() {
    _sidebar.classList.remove('active');
    _backdrop.classList.remove('active');
    document.body.classList.remove('chat-open');
  }

  function toggle() {
    _sidebar.classList.contains('active') ? close() : open();
  }

  // ===== Context 更新 =====
  function setContext({ cards, currentCard, nodeInfoList } = {}) {
    if (cards !== undefined)       _context.cards = cards;
    if (currentCard !== undefined) _context.currentCard = currentCard;
    if (nodeInfoList !== undefined) _context.nodeInfoList = nodeInfoList;
  }

  // ===== 圖片處理 =====
  function _onImageSelected(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > MAX_IMAGE_BYTES) {
      alert(`圖片超過 2MB 限制（目前 ${(file.size / 1024 / 1024).toFixed(1)} MB），請選擇較小的圖片。`);
      _imageInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      _pendingImage = ev.target.result;
      _imageThumb.src = _pendingImage;
      _imagePreview.classList.add('visible');
    };
    reader.readAsDataURL(file);
    _imageInput.value = '';   // 允許重複選同檔案
  }

  function _clearPendingImage() {
    _pendingImage = null;
    _imageThumb.src = '';
    _imagePreview.classList.remove('visible');
  }

  // ===== 清除對話 =====
  function clearHistory() {
    _history = [];
    _messages.innerHTML = '';
    _clearPendingImage();
    _appendMessage('model', [{ type: 'text', content: '對話已清除。有什麼可以幫您的嗎？' }]);
  }

  // ===== 發送訊息 =====
  async function sendMessage() {
    const text = _input.value.trim();
    if ((!text && !_pendingImage) || _isLoading) return;

    const imageToSend = _pendingImage;
    _input.value = '';
    _clearPendingImage();

    // 渲染使用者訊息
    const userParts = [];
    if (imageToSend) userParts.push({ type: 'image', content: imageToSend });
    if (text) userParts.push({ type: 'text', content: text });
    _appendMessage('user', userParts);
    _history.push({ role: 'user', text: text || '（圖片）' });

    _isLoading = true;
    _btnSend.disabled = true;
    const loadingEl = _appendLoading();

    try {
      const resp = await fetch('/api/proxy/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text || '請描述這張圖片的內容。',
          history: _history.slice(-20),
          context: _context,
          image: imageToSend || ''
        })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }

      const { text: aiText } = await resp.json();
      _history.push({ role: 'model', text: aiText });
      loadingEl.remove();
      _appendMessage('model', _parseResponse(aiText));
    } catch (e) {
      loadingEl.remove();
      _appendMessage('model', [{ type: 'text', content: `❌ 錯誤：${e.message}` }]);
    } finally {
      _isLoading = false;
      _btnSend.disabled = false;
      _input.focus();
    }
  }

  // ===== 解析 AI 回應中的 ```prompt 區塊 =====
  function _parseResponse(text) {
    const parts = [];
    const regex = /```prompt\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'prompt', content: match[1].trim() });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIndex) });
    }

    return parts.length > 0 ? parts : [{ type: 'text', content: text }];
  }

  // ===== 渲染訊息 =====
  function _appendMessage(role, parts) {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-msg chat-msg-${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';

    parts.forEach(part => {
      if (part.type === 'image') {
        const img = document.createElement('img');
        img.className = 'chat-msg-image';
        img.src = part.content;
        img.alt = '圖片';
        bubble.appendChild(img);
      } else if (part.type === 'text') {
        const p = document.createElement('div');
        p.className = 'chat-text';
        p.textContent = part.content;
        bubble.appendChild(p);
      } else if (part.type === 'prompt') {
        const block = document.createElement('div');
        block.className = 'chat-prompt-block';

        const pre = document.createElement('pre');
        pre.className = 'chat-prompt-text';
        pre.textContent = part.content;

        const btn = document.createElement('button');
        btn.className = 'btn btn-success chat-apply-btn';
        btn.textContent = '✅ 套用到提示詞欄位';
        btn.addEventListener('click', () => {
          if (_onApplyPrompt) _onApplyPrompt(part.content);
        });

        block.appendChild(pre);
        block.appendChild(btn);
        bubble.appendChild(block);
      }
    });

    wrapper.appendChild(bubble);
    _messages.appendChild(wrapper);
    _messages.scrollTop = _messages.scrollHeight;
    return wrapper;
  }

  function _appendLoading() {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-msg chat-msg-model';
    wrapper.innerHTML = `
      <div class="chat-bubble chat-bubble-loading">
        <div class="loading-dots"><span></span><span></span><span></span></div>
      </div>
    `;
    _messages.appendChild(wrapper);
    _messages.scrollTop = _messages.scrollHeight;
    return wrapper;
  }

  return { init, open, close, toggle, setContext, clearHistory };
})();

export default ChatModule;
