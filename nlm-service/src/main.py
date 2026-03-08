"""
NLM (NotebookLM) Microservice
"""
import logging
import os
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from .auth import (
    get_nlm_client,
    is_authenticated,
    get_status,
    disconnect,
    reset_client,
)

logging.basicConfig(
    level=logging.INFO,
    format="[NLM] %(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Inje NLM Service", docs_url=None, redoc_url=None)


# --- Models ---


class FileSource(BaseModel):
    url: str
    file_name: str = "upload.pdf"


class NotebookCreateRequest(BaseModel):
    title: str
    sources: list = []
    file_sources: List[FileSource] = []
    is_public: bool = False


class ChatRequest(BaseModel):
    notebook_id: str
    question: str
    conversation_id: Optional[str] = None


class AddTextSourceRequest(BaseModel):
    title: str
    content: str


class AddFileFromUrlRequest(BaseModel):
    url: str
    file_name: str = "upload.pdf"


class AddUrlRequest(BaseModel):
    url: str


class AuthStatusResponse(BaseModel):
    authenticated: bool
    storage_path: str
    storage_exists: bool


def _require_auth():
    if not is_authenticated():
        raise HTTPException(
            status_code=503,
            detail="NotebookLM 인증이 필요합니다. scripts/nlm-login.sh를 실행하세요.",
        )


# --- Auth Endpoints ---


@app.get("/health")
async def health():
    return {"status": "ok", "service": "nlm"}


@app.get("/auth/status")
async def auth_status():
    """인증 상태 확인"""
    return get_status()


@app.post("/auth/disconnect")
async def auth_disconnect():
    """인증 해제 (쿠키 삭제)"""
    disconnect()
    return {"success": True}


# --- Notebook Endpoints ---


@app.post("/notebook")
async def create_notebook(req: NotebookCreateRequest):
    """NotebookLM 노트북 생성 + 텍스트/파일 소스 추가"""
    _require_auth()

    try:
        client = await get_nlm_client()

        logger.info("Creating notebook: %s", req.title)

        async with client:
            notebook = await client.notebooks.create(req.title)
            notebook_id = notebook.id

            # 텍스트 소스 추가
            for source in req.sources:
                name = source.get("sourceName", "untitled") if isinstance(source, dict) else "untitled"
                content = source.get("content", "") if isinstance(source, dict) else ""
                logger.info("Adding text source: %s (%d chars)", name, len(content))
                await client.sources.add_text(notebook_id, title=name, content=content)

            # 파일 소스 추가 (signed URL → 다운로드 → 원래 파일명으로 저장 → 업로드)
            if req.file_sources:
                import httpx

                async with httpx.AsyncClient() as http:
                    for fs in req.file_sources:
                        try:
                            resp = await http.get(fs.url, timeout=60)
                            resp.raise_for_status()

                            # 원래 파일명으로 temp 디렉토리에 저장
                            tmp_dir = tempfile.mkdtemp()
                            tmp_path = os.path.join(tmp_dir, fs.file_name)
                            with open(tmp_path, "wb") as f:
                                f.write(resp.content)

                            logger.info("Adding file source: %s", fs.file_name)
                            await client.sources.add_file(notebook_id, Path(tmp_path))
                            os.unlink(tmp_path)
                            os.rmdir(tmp_dir)
                        except Exception as e:
                            logger.warning("Failed to add file source %s: %s", fs.file_name, e)

            # 공유 설정
            if req.is_public:
                try:
                    share_status = await client.sharing.set_public(notebook_id, True)
                    logger.info("Shared notebook as public: %s", share_status.is_public)
                except Exception as share_err:
                    logger.warning("Failed to share notebook: %s", share_err)

            web_url = f"https://notebooklm.google.com/notebook/{notebook_id}"

        logger.info("Notebook created (public=%s): %s", req.is_public, web_url)
        reset_client()

        return {"web_url": web_url, "notebook_id": notebook_id, "is_public": req.is_public}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to create notebook: %s", e, exc_info=True)
        reset_client()
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/notebook/{notebook_id}")
async def delete_notebook(notebook_id: str):
    """NotebookLM 노트북 삭제"""
    _require_auth()
    try:
        client = await get_nlm_client()
        async with client:
            await client.notebooks.delete(notebook_id)
        reset_client()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to delete notebook: %s", e, exc_info=True)
        reset_client()
        raise HTTPException(status_code=500, detail=str(e))


# --- Chat Endpoints ---


@app.post("/chat")
async def chat(req: ChatRequest):
    """NotebookLM 노트북에 질의"""
    _require_auth()

    try:
        client = await get_nlm_client()

        logger.info("Chat: notebook=%s, question=%s", req.notebook_id, req.question[:50])

        async with client:
            result = await client.chat.ask(
                req.notebook_id,
                req.question,
                conversation_id=req.conversation_id,
            )

        reset_client()

        return {
            "answer": result.answer,
            "conversation_id": result.conversation_id,
            "turn_number": result.turn_number,
            "references": [
                {
                    "source_id": ref.source_id,
                    "citation_number": ref.citation_number,
                    "cited_text": ref.cited_text,
                }
                for ref in result.references
            ] if result.references else [],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Chat failed: %s", e, exc_info=True)
        reset_client()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/notebook/{notebook_id}/description")
async def get_notebook_description(notebook_id: str):
    """노트북의 AI 생성 요약 + 추천 질문 조회"""
    _require_auth()

    try:
        from notebooklm.rpc import RPCMethod

        client = await get_nlm_client()
        async with client:
            # 라이브러리의 get_description() 파싱 버그 우회 — raw RPC 직접 호출
            params = [notebook_id, [2]]
            result = await client._core.rpc_call(
                RPCMethod.SUMMARIZE,
                params,
                source_path=f"/notebook/{notebook_id}",
            )
        reset_client()

        summary = ""
        suggested_topics = []

        if result and isinstance(result, list) and len(result) > 0:
            # Summary: result[0] = [[summary_text]]
            first = result[0]
            if isinstance(first, list) and len(first) > 0:
                inner = first[0]
                if isinstance(inner, list) and len(inner) > 0:
                    summary = str(inner[0]) if inner[0] else ""
                elif isinstance(inner, str):
                    summary = inner

            # Topics: result[0][1] = [[[question, prompt], ...]]
            if isinstance(first, list) and len(first) > 1:
                topics_wrapper = first[1]
                if isinstance(topics_wrapper, list) and len(topics_wrapper) > 0:
                    topics_list = topics_wrapper[0] if isinstance(topics_wrapper[0], list) else topics_wrapper
                    for topic in topics_list:
                        if isinstance(topic, list) and len(topic) >= 1 and isinstance(topic[0], str):
                            suggested_topics.append({"question": topic[0]})

        return {
            "summary": summary,
            "suggested_topics": suggested_topics,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get notebook description: %s", e, exc_info=True)
        reset_client()
        raise HTTPException(status_code=500, detail=str(e))


# --- Source Endpoints ---


@app.get("/notebook/{notebook_id}/sources")
async def list_notebook_sources(notebook_id: str):
    """노트북의 소스 목록 조회"""
    _require_auth()

    try:
        client = await get_nlm_client()
        async with client:
            sources = await client.sources.list(notebook_id)
        reset_client()

        return {
            "sources": [
                {
                    "id": s.id,
                    "title": s.title,
                    "source_type": str(s.source_type) if hasattr(s, "source_type") else "unknown",
                    "is_ready": s.is_ready if hasattr(s, "is_ready") else True,
                }
                for s in sources
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to list sources: %s", e, exc_info=True)
        reset_client()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/notebook/{notebook_id}/sources/add-text")
async def add_text_source(notebook_id: str, req: AddTextSourceRequest):
    """텍스트 소스 추가"""
    _require_auth()
    try:
        client = await get_nlm_client()
        async with client:
            source = await client.sources.add_text(notebook_id, title=req.title, content=req.content)
        reset_client()
        return {
            "source": {
                "id": source.id,
                "title": source.title,
                "source_type": "TEXT",
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to add text source: %s", e, exc_info=True)
        reset_client()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/notebook/{notebook_id}/sources/add-file-from-url")
async def add_file_source_from_url(notebook_id: str, req: AddFileFromUrlRequest):
    """Signed URL로부터 파일 다운로드 후 노트북에 소스 추가"""
    _require_auth()

    try:
        import httpx

        client = await get_nlm_client()

        # 파일 다운로드
        async with httpx.AsyncClient() as http:
            resp = await http.get(req.url, timeout=60)
            resp.raise_for_status()

        # 원래 파일명으로 temp 디렉토리에 저장
        tmp_dir = tempfile.mkdtemp()
        tmp_path = os.path.join(tmp_dir, req.file_name)
        with open(tmp_path, "wb") as f:
            f.write(resp.content)

        logger.info("Adding file source to %s: %s", notebook_id, req.file_name)

        async with client:
            source = await client.sources.add_file(notebook_id, Path(tmp_path))
        os.unlink(tmp_path)
        os.rmdir(tmp_dir)
        reset_client()

        return {
            "source": {
                "id": source.id,
                "title": source.title,
                "source_type": str(source.source_type) if hasattr(source, "source_type") else "FILE",
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to add file source: %s", e, exc_info=True)
        reset_client()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/notebook/{notebook_id}/sources/add-url")
async def add_url_source(notebook_id: str, req: AddUrlRequest):
    """URL 소스 추가"""
    _require_auth()

    try:
        client = await get_nlm_client()
        logger.info("Adding URL source to %s: %s", notebook_id, req.url)

        async with client:
            source = await client.sources.add_url(notebook_id, req.url)
        reset_client()

        return {
            "source": {
                "id": source.id,
                "title": source.title,
                "source_type": str(source.source_type) if hasattr(source, "source_type") else "URL",
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to add URL source: %s", e, exc_info=True)
        reset_client()
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/notebook/{notebook_id}/sources/{source_id}")
async def delete_source(notebook_id: str, source_id: str):
    """노트북에서 소스 삭제"""
    _require_auth()

    try:
        client = await get_nlm_client()
        async with client:
            await client.sources.delete(notebook_id, source_id)
        reset_client()

        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to delete source: %s", e, exc_info=True)
        reset_client()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/notebook/{notebook_id}/history")
async def get_chat_history(notebook_id: str):
    """노트북 대화 기록 조회"""
    _require_auth()

    try:
        client = await get_nlm_client()
        async with client:
            history = await client.chat.get_history(notebook_id)
        reset_client()

        turns = []
        if history:
            for idx, turn in enumerate(history):
                # get_history() returns list[tuple[str, str]] — (question, answer) pairs
                if isinstance(turn, (list, tuple)) and len(turn) >= 2:
                    query = turn[0] or ""
                    answer = turn[1] or ""
                else:
                    # Fallback for ConversationTurn objects (cached turns)
                    query = getattr(turn, "query", "") or ""
                    answer = getattr(turn, "answer", "") or ""

                if query:
                    turns.append({
                        "role": "user",
                        "content": query,
                        "turn_number": idx + 1,
                    })
                if answer:
                    turns.append({
                        "role": "assistant",
                        "content": answer,
                        "turn_number": idx + 1,
                    })

        return {"history": turns}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get history: %s", e, exc_info=True)
        reset_client()
        raise HTTPException(status_code=500, detail=str(e))
