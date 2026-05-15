import { useEffect, useRef, useState, useCallback } from 'react';
import { Brush, Eraser, Eye, EyeOff, Trash2, Undo2, Redo2, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const MAX_HISTORY = 30;

export interface MaskEditorProps {
  /** 來源圖 URL（已上傳到 RH 後我們其實沒拿到原始 dataURL，所以這裡用 RH 拿回來的可訪問 URL 或本地 dataURL）*/
  imageUrl: string;
  /** 已存在的 mask（重新編輯時帶入的 PNG dataURL；新繪則 null） */
  initialMaskDataUrl?: string | null;
  /** 確認時匯出的 PNG Blob（白底黑背景，尺寸 = 原圖） */
  onConfirm: (maskBlob: Blob, maskPreviewDataUrl: string) => void | Promise<void>;
  onCancel: () => void;
}

type Tool = 'brush' | 'eraser';

export function MaskEditorModal({ imageUrl, initialMaskDataUrl, onConfirm, onCancel }: MaskEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);

  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDims, setImageDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [displayDims, setDisplayDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const [tool, setTool] = useState<Tool>('brush');
  const [brushSize, setBrushSize] = useState(40);
  const [brushColor, setBrushColor] = useState('#ff3333');
  const [brushOpacity, setBrushOpacity] = useState(70);
  const [feather, setFeather] = useState(0);
  const [showMask, setShowMask] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Undo / Redo：保存 mask canvas 的 ImageData 快照
  const historyRef = useRef<ImageData[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [historyTick, setHistoryTick] = useState(0); // 觸發 Undo/Redo 按鈕 disabled 重算

  // 繪製狀態
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // ----- 載入圖片並畫到底層 canvas -----
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const naturalW = img.naturalWidth;
      const naturalH = img.naturalHeight;
      setImageDims({ w: naturalW, h: naturalH });

      const baseCanvas = baseCanvasRef.current;
      const maskCanvas = maskCanvasRef.current;
      if (!baseCanvas || !maskCanvas) return;
      baseCanvas.width = maskCanvas.width = naturalW;
      baseCanvas.height = maskCanvas.height = naturalH;

      const baseCtx = baseCanvas.getContext('2d');
      if (baseCtx) {
        baseCtx.clearRect(0, 0, naturalW, naturalH);
        baseCtx.drawImage(img, 0, 0);
      }

      // 載入既有 mask（重新編輯）
      if (initialMaskDataUrl) {
        const m = new Image();
        m.onload = () => {
          const ctx = maskCanvas.getContext('2d');
          ctx?.drawImage(m, 0, 0, naturalW, naturalH);
          pushHistory();
          setImageLoaded(true);
        };
        m.onerror = () => {
          pushHistory();
          setImageLoaded(true);
        };
        m.src = initialMaskDataUrl;
      } else {
        pushHistory();
        setImageLoaded(true);
      }
    };
    img.onerror = () => setError('無法載入來源圖片，請重新上傳');
    img.src = imageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, initialMaskDataUrl]);

  // ----- 計算 fit-to-screen 顯示尺寸 -----
  const recalcDisplay = useCallback(() => {
    const c = containerRef.current;
    if (!c || imageDims.w === 0) return;
    const rect = c.getBoundingClientRect();
    const ratio = imageDims.w / imageDims.h;
    let w = rect.width;
    let h = w / ratio;
    if (h > rect.height) {
      h = rect.height;
      w = h * ratio;
    }
    setDisplayDims({ w: Math.floor(w), h: Math.floor(h) });
  }, [imageDims]);

  useEffect(() => {
    recalcDisplay();
    const ro = new ResizeObserver(recalcDisplay);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [recalcDisplay]);

  // ----- Undo / Redo -----
  const pushHistory = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const stack = historyRef.current;
    // 清掉當前 index 之後的 redo 記錄
    const newStack = stack.slice(0, historyIndexRef.current + 1);
    newStack.push(snap);
    if (newStack.length > MAX_HISTORY) newStack.shift();
    historyRef.current = newStack;
    historyIndexRef.current = newStack.length - 1;
    setHistoryTick((t) => t + 1);
  }, []);

  const restoreHistory = useCallback((index: number) => {
    const canvas = maskCanvasRef.current;
    const snap = historyRef.current[index];
    if (!canvas || !snap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(snap, 0, 0);
    historyIndexRef.current = index;
    setHistoryTick((t) => t + 1);
  }, []);

  const undo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx <= 0) return;
    restoreHistory(idx - 1);
  }, [restoreHistory]);

  const redo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx >= historyRef.current.length - 1) return;
    restoreHistory(idx + 1);
  }, [restoreHistory]);

  const clearAll = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pushHistory();
  }, [pushHistory]);

  const handleColorChange = useCallback((color: string) => {
    clearAll();
    setBrushColor(color);
  }, [clearAll]);

  // ----- 鍵盤快捷鍵 -----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault();
          redo();
        }
      } else if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === '[') {
        setBrushSize((s) => Math.max(1, s - 5));
      } else if (e.key === ']') {
        setBrushSize((s) => Math.min(200, s + 5));
      } else if (e.key === 'b' || e.key === 'B') {
        setTool('brush');
      } else if (e.key === 'e' || e.key === 'E') {
        setTool('eraser');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, onCancel]);

  // ----- 畫圖：滑鼠/觸控 -----
  const eventToCanvasPoint = (clientX: number, clientY: number) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const drawDot = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawLine = (ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const startStroke = (clientX: number, clientY: number) => {
    if (!imageLoaded) return;
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const p = eventToCanvasPoint(clientX, clientY);
    if (!p) return;
    drawingRef.current = true;
    lastPointRef.current = p;

    if (tool === 'brush') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = brushOpacity / 100;
      ctx.fillStyle = brushColor;
      ctx.strokeStyle = brushColor;
    } else {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
    }
    drawDot(ctx, p.x, p.y);
  };

  const moveStroke = (clientX: number, clientY: number) => {
    if (!drawingRef.current) return;
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const p = eventToCanvasPoint(clientX, clientY);
    if (!p) return;
    const last = lastPointRef.current;
    if (last) {
      if (tool === 'brush') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = brushOpacity / 100;
        ctx.strokeStyle = brushColor;
      } else {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1;
      }
      drawLine(ctx, last, p);
    } else {
      drawDot(ctx, p.x, p.y);
    }
    lastPointRef.current = p;
  };

  const endStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    pushHistory();
  };

  // ----- 確認：匯出兩份（兼容 ComfyUI LoadImageMask 全 channel） -----
  // ① preview（給 UI 顯示：黑底 + 白色塗抹，人類可讀）
  // ② upload blob（給 RH workflow）
  //    雙通道同時編碼，使 LoadImageMask 不論 channel = alpha / red / green / blue 都能正確讀：
  //      - alpha 通道：mask = 1 - alpha/255 → painted=alpha 0、unpainted=alpha 255
  //      - RGB 通道：mask = channel/255 → painted=255、unpainted=0
  //    像素：rgba(s, s, s, 255-s)，s = 塗抹強度（0..255，含羽化漸層）
  const handleConfirm = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      const maskCanvas = maskCanvasRef.current;
      if (!maskCanvas) throw new Error('無法存取 canvas');
      const w = maskCanvas.width;
      const h = maskCanvas.height;

      // 套羽化（產生 strength gradient，沒羽化就直接用原 canvas）
      let working: HTMLCanvasElement = maskCanvas;
      if (feather > 0) {
        const fc = document.createElement('canvas');
        fc.width = w;
        fc.height = h;
        const fctx = fc.getContext('2d');
        if (!fctx) throw new Error('feather context 失敗');
        fctx.filter = `blur(${feather}px)`;
        fctx.drawImage(maskCanvas, 0, 0);
        working = fc;
      }

      // 讀塗抹強度（白色塗抹的 alpha）
      const wctx = working.getContext('2d');
      if (!wctx) throw new Error('mask context 失敗');
      const maskData = wctx.getImageData(0, 0, w, h);

      // ② 雙通道編碼輸出
      const outCanvas = document.createElement('canvas');
      outCanvas.width = w;
      outCanvas.height = h;
      const octx = outCanvas.getContext('2d');
      if (!octx) throw new Error('export context 失敗');
      const outData = octx.createImageData(w, h);
      for (let i = 0; i < maskData.data.length; i += 4) {
        const s = maskData.data[i + 3]; // 0..255
        outData.data[i] = s;        // R
        outData.data[i + 1] = s;    // G
        outData.data[i + 2] = s;    // B
        outData.data[i + 3] = 255 - s; // A（反相）
      }
      octx.putImageData(outData, 0, 0);

      // ① preview（黑底白塗，給 UI 看）
      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = w;
      previewCanvas.height = h;
      const pctx = previewCanvas.getContext('2d');
      if (!pctx) throw new Error('preview context 失敗');
      pctx.fillStyle = '#000000';
      pctx.fillRect(0, 0, w, h);
      pctx.drawImage(working, 0, 0);
      const previewDataUrl = previewCanvas.toDataURL('image/png');

      const blob = await new Promise<Blob>((resolve, reject) =>
        outCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob 失敗'))),
          'image/png',
        ),
      );
      await onConfirm(blob, previewDataUrl);
    } catch (e) {
      setError((e as Error).message);
      setConfirming(false);
    }
  };

  // ----- Render -----
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Brush className="size-4 text-primary" />
          <span className="font-medium">遮罩編輯器</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={confirming}>
            <X className="size-4" /> 取消
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!imageLoaded || confirming}>
            <Check className="size-4" /> {confirming ? '匯出中…' : '確認'}
          </Button>
        </div>
      </header>

      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* 畫布區 */}
        <div ref={containerRef} className="relative flex-1 bg-muted/30">
          {!imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              載入圖片中…
            </div>
          )}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: displayDims.w, height: displayDims.h }}
          >
            <canvas
              ref={baseCanvasRef}
              className="absolute inset-0 h-full w-full"
              style={{ imageRendering: 'pixelated' }}
            />
            <canvas
              ref={maskCanvasRef}
              className={cn(
                'absolute inset-0 h-full w-full cursor-crosshair touch-none',
                showMask ? 'opacity-50' : 'opacity-0',
                'mix-blend-screen',
              )}
              onMouseDown={(e) => startStroke(e.clientX, e.clientY)}
              onMouseMove={(e) => moveStroke(e.clientX, e.clientY)}
              onMouseUp={endStroke}
              onMouseLeave={endStroke}
              onTouchStart={(e) => {
                const t = e.touches[0];
                if (t) startStroke(t.clientX, t.clientY);
              }}
              onTouchMove={(e) => {
                e.preventDefault();
                const t = e.touches[0];
                if (t) moveStroke(t.clientX, t.clientY);
              }}
              onTouchEnd={endStroke}
            />
          </div>
        </div>

        {/* 工具列 */}
        <aside className="flex w-60 flex-col gap-4 border-l border-border bg-card p-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={tool === 'brush' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTool('brush')}
              title="筆刷 (B)"
            >
              <Brush className="size-4" /> 筆刷
            </Button>
            <Button
              variant={tool === 'eraser' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTool('eraser')}
              title="橡皮擦 (E)"
            >
              <Eraser className="size-4" /> 橡皮
            </Button>
          </div>

          <div className="space-y-1">
            <Label>筆刷顏色</Label>
            <div className="flex gap-2 flex-wrap">
              {[
                { color: '#ff3333', label: '紅' },
                { color: '#ff9900', label: '橙' },
                { color: '#ffee00', label: '黃' },
                { color: '#00cc44', label: '綠' },
                { color: '#3399ff', label: '藍' },
                { color: '#cc44ff', label: '紫' },
                { color: '#ffffff', label: '白' },
              ].map(({ color, label }) => (
                <button
                  key={color}
                  title={label}
                  onClick={() => handleColorChange(color)}
                  className={cn(
                    'size-7 rounded-full border-2 transition-transform',
                    brushColor === color ? 'border-foreground scale-110' : 'border-transparent hover:scale-105',
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>筆刷透明度</Label>
              <span className="text-xs text-muted-foreground">{brushOpacity}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={10}
              value={brushOpacity}
              onChange={(e) => setBrushOpacity(parseInt(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>筆刷大小</Label>
              <span className="text-xs text-muted-foreground">{brushSize}px</span>
            </div>
            <input
              type="range"
              min={1}
              max={200}
              value={brushSize}
              onChange={(e) => setBrushSize(parseInt(e.target.value))}
              className="w-full"
            />
            <p className="text-[10px] text-muted-foreground">[ ] 鍵調整</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>邊緣羽化</Label>
              <span className="text-xs text-muted-foreground">{feather}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={30}
              value={feather}
              onChange={(e) => setFeather(parseInt(e.target.value))}
              className="w-full"
            />
            <p className="text-[10px] text-muted-foreground">匯出時套用</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={undo}
              disabled={historyIndexRef.current <= 0}
              title="Cmd/Ctrl+Z"
            >
              <Undo2 className="size-4" /> 復原
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={redo}
              disabled={historyIndexRef.current >= historyRef.current.length - 1}
              title="Cmd/Ctrl+Shift+Z"
            >
              <Redo2 className="size-4" /> 重做
            </Button>
          </div>
          {/* historyTick 是強制 rerender 的 hack，引用一下避免 unused warning */}
          <span className="hidden">{historyTick}</span>

          <Button variant="outline" size="sm" onClick={() => setShowMask((v) => !v)}>
            {showMask ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            {showMask ? '顯示中' : '已隱藏'}
          </Button>

          <Button variant="outline" size="sm" onClick={clearAll} className="text-destructive">
            <Trash2 className="size-4" /> 全部清除
          </Button>

          <div className="mt-auto rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
            塗抹處 = 重繪區、未塗處 = 保留區
            <br />
            匯出尺寸與原圖相同
            <br />
            快捷鍵：B 筆刷 / E 橡皮 / [ ] 大小 / Cmd+Z 復原
          </div>
        </aside>
      </div>
    </div>
  );
}
