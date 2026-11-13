import { useState, type ReactNode } from 'react';
import {
  HardDrive,
  BookImage,
  Boxes,
  Cpu,
  Heart,
  History,
  ImagePlus,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  Tags,
  Users,
  X,
} from 'lucide-react';
import { useAuth, isAdmin, canEditTemplates } from '@/lib/auth-store';
import { ThemeToggle } from '../ThemeToggle';
import { BalancePill } from '../BalancePill';
import { UserManageModal } from '../UserManageModal';
import { AiConfigModal } from '../AiConfigModal';

export type NavKey = 'gallery' | 'favorites' | 'generate' | 'apps' | 'history' | 'new-template' | 'media';

const NAV: { key: NavKey; label: string; icon: ReactNode }[] = [
  { key: 'gallery', label: '提示詞庫', icon: <BookImage className="size-4" /> },
  { key: 'favorites', label: '我的收藏', icon: <Heart className="size-4" /> },
  { key: 'generate', label: 'AI 生圖', icon: <Sparkles className="size-4" /> },
  { key: 'apps', label: 'AI 應用', icon: <Boxes className="size-4" /> },
  { key: 'history', label: '生成紀錄', icon: <History className="size-4" /> },
];

interface Props {
  active: NavKey;
  onNavigate: (key: NavKey) => void;
  onOpenModels?: () => void;
  onOpenCategories?: () => void;
  children: ReactNode;
}

export function AppShell({ active, onNavigate, onOpenModels, onOpenCategories, children }: Props) {
  const { user, logout } = useAuth();
  const admin = isAdmin(user);
  const editor = !admin && canEditTemplates(user);
  const [open, setOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const item = (label: string, icon: ReactNode, onClick: () => void, selected = false) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        onClick();
        setOpen(false);
      }}
      aria-current={selected ? 'page' : undefined}
      className={
        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ' +
        (selected
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground')
      }
    >
      {icon}
      {label}
    </button>
  );

  const sidebar = (
    <div className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 px-3 pt-1 text-lg font-semibold">
        <span className="text-primary">BWE</span> AI
      </div>
      <nav aria-label="主選單" className="flex flex-col gap-1">
        {NAV.map((n) => item(n.label, n.icon, () => onNavigate(n.key), active === n.key))}
      </nav>
      {admin && (
        <div className="mt-4 flex flex-col gap-1 border-t border-border pt-3">
          <div className="px-3 pb-1 text-xs text-muted-foreground">管理</div>
          {item('新增範本', <ImagePlus className="size-4" />, () => onNavigate('new-template'), active === 'new-template')}
          {item('模型管理', <Cpu className="size-4" />, () => onOpenModels?.())}
          {item('分類管理', <Tags className="size-4" />, () => onOpenCategories?.())}
          {item('圖片管理', <HardDrive className="size-4" />, () => onNavigate('media'), active === 'media')}
          {item('用戶', <Users className="size-4" />, () => setUsersOpen(true))}
          {item('AI 設定', <Settings className="size-4" />, () => setAiOpen(true))}
          <div className="px-3 pt-1">
            <BalancePill />
          </div>
        </div>
      )}
      {editor && (
        <div className="mt-4 flex flex-col gap-1 border-t border-border pt-3">
          <div className="px-3 pb-1 text-xs text-muted-foreground">範本管理</div>
          {item('分類管理', <Tags className="size-4" />, () => onOpenCategories?.())}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        <div className="flex items-center justify-between px-3">
          <span className="truncate text-sm text-muted-foreground">
            {user?.name || user?.username}
            {admin && <span className="text-primary">（管理員）</span>}
            {editor && <span className="text-primary">（範本編輯）</span>}
          </span>
          <ThemeToggle />
        </div>
        {item('登出', <LogOut className="size-4" />, () => logout())}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground md:flex">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 border-r border-border md:block">
        {sidebar}
      </aside>
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background/90 px-4 py-2 backdrop-blur md:hidden">
        <span className="font-semibold">
          <span className="text-primary">BWE</span> AI
        </span>
        <button type="button" aria-label="開啟選單" onClick={() => setOpen(true)}>
          <Menu className="size-5" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-30 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-background shadow-xl">
            <button
              type="button"
              aria-label="關閉選單"
              className="absolute right-3 top-3"
              onClick={() => setOpen(false)}
            >
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">{children}</div>
      <UserManageModal open={usersOpen} onClose={() => setUsersOpen(false)} />
      <AiConfigModal open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}
