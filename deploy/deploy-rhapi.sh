#!/bin/sh
# rhapi 部署：拉取 GitHub main（或指定 commit）→ 重建 rhapi → 健康檢查，失敗自動回滾。
# 由 GitHub Actions 透過受限 SSH key 呼叫（authorized_keys 的 command= 強制執行本腳本）。
set -eu
exec 9>/tmp/deploy-rhapi.lock
flock -n 9 || { echo "另一個部署正在進行"; exit 1; }

APP=/opt/apps/bwe
SRC=$APP/rhapi-src
# SSH_ORIGINAL_COMMAND 只接受一個 commit SHA；其他內容一律忽略
TARGET=$(printf '%s' "${SSH_ORIGINAL_COMMAND:-}" | grep -oE '^[0-9a-f]{7,40}$' || true)

cd "$SRC"
PREV=$(git rev-parse HEAD)
git fetch -q origin main
if [ -n "$TARGET" ]; then
  # 只部署 main 上的 commit
  git merge-base --is-ancestor "$TARGET" origin/main || { echo "commit $TARGET 不在 main 上"; exit 1; }
else
  TARGET=$(git rev-parse origin/main)
fi
git reset -q --hard "$TARGET"
echo "部署 $(git log --oneline -1)（原本 $(git rev-parse --short "$PREV")）"

build_and_check() {
  cd "$APP"
  sudo docker compose build -q rhapi
  sudo docker compose up -d --no-deps rhapi
  for _ in $(seq 1 30); do
    if sudo docker exec rhapi python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/')" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if build_and_check; then
  echo "部署成功"
else
  echo "健康檢查失敗，回滾到 $(git -C "$SRC" rev-parse --short "$PREV")"
  sudo docker logs --tail 30 rhapi 2>&1 || true
  git -C "$SRC" reset -q --hard "$PREV"
  build_and_check || echo "回滾後仍未通過健康檢查，請手動處理"
  exit 1
fi
