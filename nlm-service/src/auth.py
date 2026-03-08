"""
NotebookLM 인증 관리 (쿠키 기반)
"""

import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_default_home = str(Path(__file__).resolve().parent.parent)
NOTEBOOKLM_HOME = os.getenv("NOTEBOOKLM_HOME", _default_home)
STORAGE_PATH = os.path.join(NOTEBOOKLM_HOME, "storage_state.json")

os.environ.setdefault("NOTEBOOKLM_HOME", NOTEBOOKLM_HOME)

_nlm_client = None


def is_authenticated() -> bool:
    if not Path(STORAGE_PATH).exists():
        return False
    try:
        import json
        data = json.loads(Path(STORAGE_PATH).read_text())
        cookies = {c["name"]: c["value"] for c in data.get("cookies", [])}
        return "SID" in cookies
    except Exception:
        return False


def get_status() -> dict:
    return {
        "authenticated": is_authenticated(),
        "storage_path": STORAGE_PATH,
        "storage_exists": Path(STORAGE_PATH).exists(),
    }


async def get_nlm_client():
    global _nlm_client
    if _nlm_client is not None:
        return _nlm_client
    if not is_authenticated():
        raise RuntimeError(
            "NotebookLM 인증이 필요합니다. scripts/nlm-login.sh를 실행하여 로그인하세요."
        )
    try:
        from notebooklm import NotebookLMClient
        client = await NotebookLMClient.from_storage(str(STORAGE_PATH))
        _nlm_client = client
        logger.info("NotebookLM client initialized (storage: %s)", STORAGE_PATH)
        return client
    except Exception as e:
        logger.error("Failed to initialize NotebookLM client: %s", e)
        _nlm_client = None
        raise


def reset_client():
    global _nlm_client
    _nlm_client = None


def disconnect():
    reset_client()
    if Path(STORAGE_PATH).exists():
        Path(STORAGE_PATH).unlink()
        logger.info("Storage state removed: %s", STORAGE_PATH)
