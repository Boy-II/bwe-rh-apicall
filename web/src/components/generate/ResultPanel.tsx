import { useState } from 'react';
import { toast } from 'sonner';
import { BookmarkPlus, Check, Download, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import type { NormalizedOutput } from '@/lib/task-utils';

interface Props {
  taskId: string | null;
  outputs: NormalizedOutput[];
  status: string;
  onSave?: (index: number) => void;
  savedIndexes?: number[];
}

export function ResultPanel({ taskId, outputs, status, onSave, savedIndexes = [] }: Props) {
  const [downloading, setDownloading] = useState<number | null>(null);
  if (!outputs.length) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        <ImageIcon className="size-8 opacity-40" />
        {status || '生成結果會顯示在這裡'}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {outputs.map((o, i) => (
        <div key={o.fileUrl} className="overflow-hidden rounded-lg border border-border bg-card">
          <img src={o.fileUrl} alt={`生成結果 ${i + 1}`} className="w-full" />
          <div className="flex flex-wrap gap-2 p-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!taskId || downloading === i}
              onClick={async () => {
                if (!taskId) return;
                setDownloading(i);
                try {
                  await api.models.download(taskId, i);
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setDownloading(null);
                }
              }}
            >
              <Download className="size-4" /> 下載圖片
            </Button>
            {onSave && (
              <Button size="sm" disabled={savedIndexes.includes(i)} onClick={() => onSave(i)}>
                {savedIndexes.includes(i) ? <Check className="size-4" /> : <BookmarkPlus className="size-4" />}
                {savedIndexes.includes(i) ? '已保存' : '保存進範本庫'}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
