import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';

interface Props {
  open: boolean;
  prompt: string;
  modelKey: string;
  onClose: () => void;
  onApply: (text: string) => void;
}

export function OptimizeDialog({ open, prompt, modelKey, onClose, onApply }: Props) {
  const [request, setRequest] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setResult('');
  }, [open]);

  const run = async () => {
    if (!request.trim()) return;
    setLoading(true);
    try {
      setResult((await api.prompt.optimize(prompt, request, modelKey)).prompt);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>優化提示詞</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">優化需求</span>
            <Textarea
              rows={3}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="例：替換場景成海邊、改成編輯圖片用、修正錯字、翻成英文"
            />
          </label>
          {result && (
            <label className="block space-y-1 text-sm">
              <span className="font-medium">優化結果（可再修改）</span>
              <Textarea rows={8} value={result} onChange={(e) => setResult(e.target.value)} />
            </label>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={run} disabled={loading || !request.trim()}>
            {loading ? '優化中…' : result ? '重新優化' : '送出'}
          </Button>
          {result && <Button onClick={() => onApply(result)}>套用</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
