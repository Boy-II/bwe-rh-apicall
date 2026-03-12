/**
 * chatModule.js — AI 助手側邊欄：UI 控制、訊息收發、prompt 套用
 */

const ChatModule = (() => {
  // ===== 內部狀態 =====
  let _context = { cards: [], currentCard: null, nodeInfoList: null };
  let _history = [];   // [{role: 'user'|'model', text: '...'}]
  let _onApplyPrompt = null;
  let _isLoading = false;

  // ===== DOM 參照 =====
  let _sidebar, _messages, _input, _btnSend, _btnClose, _btnToggle, _backdrop;

  // ===== 初始化 =====
  function init({ onApplyPrompt } = {}) {
    _onApplyPrompt = onApplyPrompt || null;

    _sidebar   = document.getElementById('chatSidebar');
    _messages  = document.getElementById('chatMessages');
    _input     = document.getElementById('chatInput');
    _btnSend   = document.getElementById('btnChatSend');
    _btnClose  = document.getElementById('btnChatClose');
    _btnToggle = document.getElementById('btnChatToggle');
    _backdrop  = document.getElementById('chatBackdrop');

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

    // ESC 關閉
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _sidebar.classList.contains('active')) close();
    });

    // 顯示歡迎訊息
    _appendMessage('model', [{ type: 'text', content: '您好！我是 BWE-RH AI 助手 🤖\n可以問我關於 AI 應用選擇或提示詞撰寫的問題。' }]);
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

  // ===== 發送訊息 =====
  async function sendMessage() {
    const text = _input.value.trim();
    if (!text || _isLoading) return;

    _input.value = '';
    _appendMessage('user', [{ type: 'text', content: text }]);
    _history.push({ role: 'user', text });

    _isLoading = true;
    _btnSend.disabled = true;
    const loadingEl = _appendLoading();

    try {
      const resp = await fetch('/api/proxy/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: _history.slice(-20),   // 保留最近 20 條
          context: _context
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
      if (part.type === 'text') {
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

  return { init, open, close, toggle, setContext };
})();

export default ChatModule;
