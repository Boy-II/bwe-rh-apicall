import { createContext } from 'react';
import type { NodeInfo } from './types';

/** TaskView 提供：決定檔案上傳到 RunningHub（undefined）或本地 ComfyUI */
export const UploadTargetContext = createContext<'comfyui' | undefined>(undefined);

const FILE_FIELDS: Record<string, string> = { 'LoadImage::image': 'IMAGE', 'LoadImageMask::image': 'IMAGE' };

/** 解析 ComfyUI「Export (API)」JSON；UI 格式或格式錯誤時丟出可讀錯誤 */
export function parseComfyWorkflow(text: string): { workflow: Record<string, unknown>; nodes: NodeInfo[] } {
  let wf: unknown;
  try {
    wf = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON');
  }
  if (!wf || typeof wf !== 'object' || Array.isArray(wf)) throw new Error('workflow 必須是 JSON 物件');
  const obj = wf as Record<string, unknown>;
  if ('nodes' in obj && 'links' in obj) {
    throw new Error('這是 ComfyUI 的 UI 格式；請在 ComfyUI 用「Export (API)」匯出 API 格式 JSON');
  }
  const nodes: NodeInfo[] = [];
  for (const [nodeId, raw] of Object.entries(obj)) {
    const node = raw as { class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } };
    if (!node || typeof node !== 'object' || !node.class_type || typeof node.inputs !== 'object') {
      throw new Error(`節點 ${nodeId} 不是 API 格式（缺 class_type / inputs）`);
    }
    const title = node._meta?.title || '';
    for (const [fieldName, value] of Object.entries(node.inputs || {})) {
      if (Array.isArray(value) || value === null || typeof value === 'object') continue; // 連線、物件型設定
      const fieldType =
        FILE_FIELDS[`${node.class_type}::${fieldName}`] ||
        (typeof value === 'number' && Number.isInteger(value) ? 'INT' : 'STRING');
      nodes.push({
        nodeId,
        fieldName,
        fieldValue: value as NodeInfo['fieldValue'],
        fieldType,
        description: title ? `${title} · ${fieldName}` : fieldName,
        descriptionEn: `${node.class_type}.${fieldName}`,
      } as NodeInfo);
    }
  }
  return { workflow: obj, nodes };
}
