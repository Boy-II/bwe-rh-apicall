import { useState } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import api from '@/lib/api';
import { languageAction } from '@/lib/gallery-utils';
import type { TemplateDetail } from '@/lib/types';

interface Props {
  template: TemplateDetail;
  onChange: (t: TemplateDetail) => void;
  onInsert: (text: string) => void;
  onClose: () => void;
}

export function TemplateCard({ template, onChange, onInsert, onClose }: Props) {
  const [generating, setGenerating] = useState<'en' | 'zh' | null>(null);

  const generate = async (lang: 'en' | 'zh') => {
    setGenerating(lang);
    try {
      const { text } = await api.templates.fillLanguage(template.id, lang);
      onChange({ ...template, [lang === 'en' ? 'promptEn' : 'promptZh']: text });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(null);
    }
  };

  const row = (lang: 'en' | 'zh', label: string) => {
    const text = lang === 'en' ? template.promptEn : template.promptZh;
    const action = languageAction(template, lang);
    return (
      <div className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-background p-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          {action === 'insert' && (
            <button type="button" className="rounded bg-sky-500 px-2.5 py-0.5 text-xs text-white hover:bg-sky-600" onClick={() => onInsert(text)}>
              帶入
            </button>
          )}
          {action === 'generate' && (
            <button
              type="button"
              disabled={generating !== null}
              className="rounded bg-neutral-900 px-2.5 py-0.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
              onClick={() => generate(lang)}
            >
              {generating === lang ? '產生中…' : '產生'}
            </button>
          )}
        </div>
        <p
          tabIndex={0}
          role="region"
          aria-label={label}
          className="max-h-40 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words pr-2 text-xs leading-relaxed focus-visible:outline-2 focus-visible:outline-sky-500"
        >
          {text || <span className="text-muted-foreground">（尚無）</span>}
        </p>
      </div>
    );
  };

  return (
    <section aria-label="範本" className="relative flex gap-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-950/20">
      <button type="button" aria-label="關閉範本" onClick={onClose} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground">
        <X className="size-4" />
      </button>
      <img src={template.imageUrl} alt={template.title} className="w-32 shrink-0 self-stretch rounded object-cover sm:w-40" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 pr-5">
        <div className="text-sm font-semibold">{template.title}</div>
        {row('en', '英文提示詞')}
        {row('zh', '中文提示詞')}
      </div>
    </section>
  );
}
