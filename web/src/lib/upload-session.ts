import api from './api';

/**
 * 使用者上傳的參考圖：伺服器用完即刪，原檔只保留在本頁的瀏覽器記憶體（本次工作階段）。
 * 同一張圖再次生成時，從瀏覽器重新上傳取得新網址；重新整理或關閉頁面即消失。
 */
interface Entry {
  file: File;
  modelKey: string;
  fieldKey: string;
}

const files = new Map<string, Entry>();
const used = new Set<string>();

export const isServerUpload = (url: string) => url.startsWith('/covers/media/uploads/');

export function rememberUpload(url: string, file: File, modelKey: string, fieldKey: string) {
  files.set(url, { file, modelKey, fieldKey });
}

/** 歷史重跑帶入的參考圖：伺服器上已不存在，只保留本次工作階段還有原檔的 */
export function keepAvailable(urls: string[]): { kept: string[]; dropped: number } {
  const kept = urls.filter((u) => !isServerUpload(u) || files.has(u));
  return { kept, dropped: urls.length - kept.length };
}

/** 送出前呼叫：已送出過（伺服器已刪）的參考圖從瀏覽器重新上傳，並標記這批為已使用 */
export async function prepareUploadsForSubmit(urls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const url of urls) {
    const entry = files.get(url);
    if (isServerUpload(url) && used.has(url) && entry) {
      const { url: fresh } = await api.models.upload(entry.modelKey, entry.fieldKey, entry.file);
      files.set(fresh, entry);
      out.push(fresh);
    } else {
      out.push(url);
    }
  }
  out.forEach((u) => used.add(u));
  return out;
}
