/**
 * cardManager.js — 卡片本地狀態輔助模組
 * 卡片清單由後端管理，此模組僅負責 lastUsedAt 的本地追蹤
 */

const CardManager = (() => {
  const LAST_USED_KEY = 'rh_card_last_used';

  /** 預設顏色調色盤 */
  const PALETTE = [
    '#6C5CE7', '#00B894', '#E17055', '#0984E3',
    '#D63031', '#E84393', '#00CEC9', '#FDCB6E',
    '#A29BFE', '#55EFC4', '#FF7675', '#74B9FF'
  ];

  /** 預設圖示 */
  const ICONS = ['🎨', '🖼️', '🎬', '🎵', '✨', '🚀', '💡', '🔮', '🌈', '⚡'];

  /** 取得所有 lastUsedAt 記錄 */
  function getLastUsed() {
    try {
      return JSON.parse(localStorage.getItem(LAST_USED_KEY)) || {};
    } catch {
      return {};
    }
  }

  /** 記錄最後使用時間（cardId → ISO string） */
  function markUsed(cardId) {
    const map = getLastUsed();
    map[cardId] = new Date().toISOString();
    localStorage.setItem(LAST_USED_KEY, JSON.stringify(map));
  }

  /** 將後端 cards 與本地 lastUsedAt 合併 */
  function mergeLastUsed(cards) {
    const map = getLastUsed();
    return cards.map(card => ({
      ...card,
      lastUsedAt: map[card.id] || null
    }));
  }

  return { markUsed, mergeLastUsed, PALETTE, ICONS };
})();

export default CardManager;
