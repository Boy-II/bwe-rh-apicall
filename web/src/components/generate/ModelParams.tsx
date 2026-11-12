import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { FIELD_LABELS } from '@/lib/model-utils';
import { splitParams } from '@/lib/gallery-utils';
import type { ModelParam, ModelValue } from '@/lib/types';

interface Props {
  options: { displayName: string; key: string }[];
  displayName: string;
  onModel: (displayName: string) => void;
  params: ModelParam[];
  values: Record<string, ModelValue>;
  onChange: (key: string, value: ModelValue) => void;
  disabled: boolean;
}

function Field({ p, value, onChange, disabled }: { p: ModelParam; value: ModelValue | undefined; onChange: (v: ModelValue) => void; disabled: boolean }) {
  const id = `param-${p.fieldKey}`;
  const label = FIELD_LABELS[p.fieldKey] || p.fieldKey;
  return (
    <label htmlFor={id} className="flex min-w-[8rem] flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {p.type === 'LIST' ? (
        <select
          id={id}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          disabled={disabled}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          {!p.required && <option value="">預設</option>}
          {p.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value === 'empty' ? '自動' : o.description && o.description !== o.value ? `${o.description}（${o.value}）` : o.value}
            </option>
          ))}
        </select>
      ) : p.type === 'BOOLEAN' ? (
        <input id={id} type="checkbox" disabled={disabled} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
      ) : p.type === 'INT' || p.type === 'FLOAT' ? (
        <Input
          id={id}
          type="number"
          className="h-9"
          disabled={disabled}
          value={String(value ?? '')}
          min={p.min}
          max={p.max}
          step={p.type === 'INT' ? 1 : p.step || 0.01}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      ) : (
        <Input id={id} className="h-9" disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export function ModelParams({ options, displayName, onModel, params, values, onChange, disabled }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { common, advanced } = splitParams(params);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label htmlFor="param-model" className="flex min-w-[10rem] flex-col gap-1 text-xs text-muted-foreground">
          模型
          <select
            id="param-model"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            disabled={disabled}
            value={displayName}
            onChange={(e) => onModel(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.key} value={o.displayName}>
                {o.displayName}
              </option>
            ))}
          </select>
        </label>
        {common.map((p) => (
          <Field key={p.fieldKey} p={p} value={values[p.fieldKey]} onChange={(v) => onChange(p.fieldKey, v)} disabled={disabled} />
        ))}
      </div>
      {advanced.length > 0 && (
        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            <ChevronDown className={'size-3.5 transition-transform ' + (showAdvanced ? 'rotate-180' : '')} />
            進階設定
          </button>
          {showAdvanced && (
            <div className="mt-2 flex flex-wrap gap-3">
              {advanced.map((p) => (
                <Field key={p.fieldKey} p={p} value={values[p.fieldKey]} onChange={(v) => onChange(p.fieldKey, v)} disabled={disabled} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
