import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-store';
import { ThemeToggle } from './ThemeToggle';

export function LoginPanel() {
  const { login, isLoading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error('請輸入帳號與密碼');
      return;
    }
    try {
      await login(username, password);
      toast.success('登入成功');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            <span className="text-primary">BWE</span> AI 應用平台
          </CardTitle>
          <CardDescription>使用 BWHR 員工編號與密碼登入</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="username">員工編號</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="員工編號（admin 為管理員）"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密碼</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? '處理中…' : '登入'}
            </Button>
            <p className="text-xs text-muted-foreground">
              首次設定或忘記密碼，請至 BWHR；所屬區處須由管理員開放。
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
