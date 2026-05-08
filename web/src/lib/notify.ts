/**
 * 瀏覽器通知薄殼。Notification API 在 page hidden 時才有意義。
 * 第一次呼叫會請求權限；被拒絕後不再嘗試。
 */

let permissionAsked = false;

export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function ensurePermission(): Promise<NotificationPermission> {
  if (!isSupported()) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  if (permissionAsked) return Notification.permission;
  permissionAsked = true;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

interface NotifyOptions {
  /** 只在 tab 不可見時才發 */
  onlyWhenHidden?: boolean;
  body?: string;
  icon?: string;
  tag?: string;
}

export function notify(title: string, opts: NotifyOptions = {}): Notification | null {
  if (!isSupported() || Notification.permission !== 'granted') return null;
  if (opts.onlyWhenHidden && document.visibilityState !== 'hidden') return null;
  try {
    const n = new Notification(title, {
      body: opts.body,
      icon: opts.icon,
      tag: opts.tag,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return n;
  } catch {
    return null;
  }
}
