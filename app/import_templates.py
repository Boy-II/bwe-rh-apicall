"""初始範本匯入 CLI。

用法：
  python -m app.import_templates awesome-prompts [--path DIR] [--limit N] [--dry-run]
  python -m app.import_templates gpt-image-2     [--path DIR] [--limit N] [--dry-run]
  python -m app.import_templates manual          [--path manifest.json]

未給 --path 時，自動從 GitHub 下載來源 tarball 到暫存目錄。
需要資料庫與 AI 設定（讀 settings 表，與服務相同）。
"""

import argparse
import asyncio
import io
import json
import logging
import sys
import tarfile
import tempfile
from pathlib import Path

import httpx

from app.core import config, db
from app.services import media, runninghub, template_import as ti

SOURCES = {
    "awesome-prompts": ("https://codeload.github.com/samuxbuilds/awesome-prompts/tar.gz/HEAD", ti.parse_awesome_prompts),
    "gpt-image-2": ("https://codeload.github.com/freestylefly/awesome-gpt-image-2/tar.gz/HEAD", ti.parse_gpt_image2),
}
MANUAL_DEFAULT = Path(__file__).parent / "data/manual_templates.json"


def download(url: str, dest: Path) -> Path:
    print(f"下載 {url} …", flush=True)
    with httpx.Client(timeout=300, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
    with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz") as tar:
        tar.extractall(dest, filter="data")
    return next(p for p in dest.iterdir() if p.is_dir())


async def load_settings() -> None:
    rows = await db.fetch_all("SELECT key, value FROM settings")
    config.replace_db_settings(
        {r["key"]: json.dumps(r["value"]) if isinstance(r["value"], (dict, list)) else str(r["value"] or "") for r in rows}
    )


async def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.import_templates")
    ap.add_argument("source", choices=[*SOURCES, "manual"])
    ap.add_argument("--path", type=Path)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--concurrency", type=int, default=4)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    with tempfile.TemporaryDirectory(prefix="tpl-import-") as tmp:
        if args.source == "manual":
            raws = ti.parse_manual(args.path or MANUAL_DEFAULT)
        else:
            url, parser = SOURCES[args.source]
            root = args.path or download(url, Path(tmp))
            raws = parser(root)
        if args.limit:
            raws = raws[: args.limit]
        print(f"解析到 {len(raws)} 筆", flush=True)
        if args.dry_run:
            return 0
        await db.init_pool()
        runninghub.init_client()
        try:
            await load_settings()
            media.ensure_dirs()
            report = await ti.import_all(raws, concurrency=args.concurrency)
        finally:
            await runninghub.close_client()
            await db.close_pool()
    print(f"完成：新增 {report.created}、略過 {report.skipped}、失敗 {len(report.failed)}")
    for sid, err in report.failed:
        print(f"  失敗 {sid}：{err}")
    return 1 if report.failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
