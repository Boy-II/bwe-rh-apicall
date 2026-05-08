import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth-store';
import { ThemeToggle } from './ThemeToggle';

type Mode = 'login' | 'register';

export function LoginPanel() {
  const { login, register, isLoading } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error('請輸入帳號與密碼');
      return;
    }
    try {
      if (mode === 'login') {
        await login(username, password);
        toast.success('登入成功');
      } else {
        const res = await register(username, password);
        toast.success(res.message || '註冊成功，待管理員審核');
        setMode('login');
        setPassword('');
      }
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
          <CardDescription>
            {mode === 'login' ? '登入後即可使用 AI 應用' : '註冊後需待管理員審核'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="username">帳號</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="使用者名稱（admin 為管理員）"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密碼</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? '處理中…' : mode === 'login' ? '登入' : '註冊'}
            </Button>
            <Button
              type="button"
              variant="link"
              className="w-full"
              onClick={() => setMode((m) => (m === 'login' ? 'register' : 'login'))}
              disabled={isLoading}
            >
              {mode === 'login' ? '沒有帳號？註冊' : '已有帳號？登入'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
