"""集中式 logging 設定。

呼叫 setup_logging() 一次（lifespan 啟動時），之後各模組用：
    import logging
    logger = logging.getLogger(__name__)
"""

import logging
import os


def setup_logging() -> None:
    level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
