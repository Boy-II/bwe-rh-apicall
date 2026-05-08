import { Sun, Moon, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme, type ThemeMode } from '@/lib/theme-store';

const ICON: Record<ThemeMode, React.ReactNode> = {
  light: <Sun className="size-4" />,
  dark: <Moon className="size-4" />,
  system: <Monitor className="size-4" />,
};

const LABEL: Record<ThemeMode, string> = {
  light: '淺色',
  dark: '深色',
  system: '跟系統',
};

export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      title={`目前：${LABEL[mode]}（點擊切換）`}
      aria-label="切換主題"
    >
      {ICON[mode]}
      <span className="hidden sm:inline">{LABEL[mode]}</span>
    </Button>
  );
}
