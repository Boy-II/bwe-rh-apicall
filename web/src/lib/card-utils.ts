import type { Card } from './types';

const LAST_USED_KEY = 'rh_card_last_used';

export const PALETTE = [
  '#6C5CE7', '#00B894', '#E17055', '#0984E3',
  '#D63031', '#E84393', '#00CEC9', '#FDCB6E',
  '#A29BFE', '#55EFC4', '#FF7675', '#74B9FF',
];

export const ICONS = ['🎨', '🖼️', '🎬', '🎵', '✨', '🚀', '💡', '🔮', '🌈', '⚡'];

function getLastUsedMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_USED_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function markCardUsed(cardId: string) {
  const map = getLastUsedMap();
  map[cardId] = new Date().toISOString();
  localStorage.setItem(LAST_USED_KEY, JSON.stringify(map));
}

export interface CardWithUsage extends Card {
  lastUsedAt: string | null;
}

export function mergeLastUsed(cards: Card[]): CardWithUsage[] {
  const map = getLastUsedMap();
  return cards.map((c) => ({ ...c, lastUsedAt: map[c.id] || null }));
}

export function sortCards(cards: CardWithUsage[]): CardWithUsage[] {
  return [...cards].sort((a, b) => {
    const aUsed = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
    const bUsed = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
    if (aUsed !== bUsed) return bUsed - aUsed;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });
}

export function isVideoCover(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url || '');
}
