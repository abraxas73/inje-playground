import os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("PPT_SERVICE_TOKEN", "test-token")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def client():
    from main import app
    return TestClient(app)


@pytest.fixture
def auth():
    return {"x-ppt-token": "test-token"}
