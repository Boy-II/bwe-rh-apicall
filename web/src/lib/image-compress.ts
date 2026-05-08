/**
 * 瀏覽器端圖片壓縮：把任意圖片轉成 JPEG dataURL，用於 chat 助手等對畫質要求不高的場景。
 *
 * - 用 createImageBitmap + canvas，避免一次性讀整份 base64 進記憶體
 * - 失敗時 fallback 回 readAsDataURL 原檔（不阻擋使用者）
 * - 動圖只會取第一格；HEIC/HEIF 在 Chrome 桌機可能 decode 失敗 → fallback
 *
 * 注意：**不要拿來壓縮要送 AI 模型的輸入圖**（如 SeedVR2 放大、人臉替換等需高畫質的應用）。
 */

export interface CompressOptions {
  /** 最長邊上限；超過會等比縮放。預設 2048 */
  maxDim?: number;
  /** JPEG 品質 0..1。預設 0.85 */
  quality?: number;
  /** 已經比此值小的話直接跳過壓縮（bytes）。預設 200 KB */
  skipBelowBytes?: number;
}

const DEFAULTS: Required<CompressOptions> = {
  maxDim: 2048,
  quality: 0.85,
  skipBelowBytes: 200 * 1024,
};

async function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 內部：把 File 壓成 Blob（JPEG）。失敗 → 回 null（呼叫端判斷後決定要 fallback 原檔還是丟錯）
 */
async function compressToJpegBlobOrNull(
  file: File,
  opts: CompressOptions = {},
): Promise<Blob | null> {
  const { maxDim, quality, skipBelowBytes } = { ...DEFAULTS, ...opts };

  // 已經很小 + 已是 jpeg → 不壓
  if (file.type === 'image/jpeg' && file.size <= skipBelowBytes) return null;

  try {
    const bitmap = await createImageBitmap(file);
    const { w, h } = fitWithin(bitmap.width, bitmap.height, maxDim);

    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    let blob: Blob;
    if (useOffscreen) {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('無法取得 OffscreenCanvas 2d context');
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close?.();
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('無法取得 canvas 2d context');
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close?.();
      blob = await canvasToBlob(canvas, quality);
    }

    // 壓完比原檔還大 → 不用
    if (blob.size >= file.size) return null;
    return blob;
  } catch {
    return null;
  }
}

/**
 * 壓縮成 JPEG dataURL。失敗或不划算時 fallback 為原檔 dataURL。
 */
export async function compressImageToJpegDataUrl(
  file: File,
  opts: CompressOptions = {},
): Promise<string> {
  const blob = await compressToJpegBlobOrNull(file, opts);
  return readAsDataUrl(blob ?? file);
}

/**
 * 壓縮成 JPEG File（保留檔名但 ext 改 .jpg），失敗或不划算時回原 File。
 * 用於 multipart 上傳時減少傳輸量。
 */
export async function compressImageToJpegFile(
  file: File,
  opts: CompressOptions = {},
): Promise<File> {
  const blob = await compressToJpegBlobOrNull(file, opts);
  if (!blob) return file;
  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() });
}

function fitWithin(width: number, height: number, maxDim: number): { w: number; h: number } {
  if (width <= maxDim && height <= maxDim) return { w: width, h: height };
  const scale = Math.min(maxDim / width, maxDim / height);
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob 失敗'))),
      'image/jpeg',
      quality,
    );
  });
}
