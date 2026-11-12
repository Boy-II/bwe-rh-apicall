import { MultiImageInput } from '../MultiImageInput';
import type { ModelParam } from '@/lib/types';

interface Props {
  uploadModelKey: string | null;
  param: ModelParam | undefined;
  images: string[];
  resetKey: string;
  disabled: boolean;
  required: boolean;
  onChange: (urls: string[], busy: boolean) => void;
}

/** 參考圖：上傳到自有儲存，與目前選的模型路由無關（切換模型後仍可用）。 */
export function ReferenceImages({ uploadModelKey, param, images, resetKey, disabled, required, onChange }: Props) {
  if (!uploadModelKey || !param) {
    return <p className="text-xs text-muted-foreground">目前沒有支援參考圖的模型</p>;
  }
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">
        參考圖 <span className="font-normal text-muted-foreground">（選填；上傳後改用圖生圖／編輯）</span>
      </div>
      {required && images.length === 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-400" role="alert">
          此範本需要上傳參考圖
        </p>
      )}
      <MultiImageInput
        key={resetKey}
        modelKey={uploadModelKey}
        param={{ ...param, multipleInputs: true }}
        initial={images}
        disabled={disabled}
        onChange={onChange}
        dropzone
      />
    </div>
  );
}
