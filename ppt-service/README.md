# ppt-service — 이노그리드 표준 PPT 생성 서비스 (Vercel FastAPI)

디자인센터 패키지 `innogrid_ppt`(python-pptx, 도구 v3.1 · 템플릿 v1.0 최신본 106장)를 그대로 싸서
Next.js(`frontend/`)가 호출하는 3개 엔드포인트만 제공한다. 패키지 원본·템플릿은 수정하지 않는다(문서: `docs/AGENT_GUIDE.md`).

| 엔드포인트 | 용도 |
|---|---|
| `GET /health` | 템플릿 장 수·장표 수 확인 |
| `GET /catalog` | LLM 프롬프트용 장표 카탈로그(골격 예제 포함) |
| `POST /extract` | pptx 원고 → 장표별 텍스트·그림 수 |
| `POST /build` | deck JSON → pptx·deck.yaml 생성 → 서명 URL로 업로드 |

모든 요청은 헤더 `x-ppt-token`(env `PPT_SERVICE_TOKEN`)이 필요하다. env `SUPABASE_URL`의 호스트로만 파일을 내려받고 올린다.

## 로컬

```bash
cd ppt-service
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
PPT_SERVICE_TOKEN=dev SUPABASE_URL=https://avooqcxehfeurjhqqgui.supabase.co .venv/bin/uvicorn main:app --port 8091 --reload
.venv/bin/pytest -q
```

`frontend/.env.local`: `PPT_SERVICE_URL=http://localhost:8091`, `PPT_SERVICE_TOKEN=dev`.

## 배포

```bash
cd ppt-service
vercel link --yes --project innogrid-ppt-service     # 처음 한 번(프로젝트 없으면 vercel project add innogrid-ppt-service)
vercel env add PPT_SERVICE_TOKEN production          # 프론트와 같은 값
vercel env add SUPABASE_URL production
vercel deploy --prod --yes
curl -H "x-ppt-token: $TOKEN" https://innogrid-ppt-service.vercel.app/health
```

템플릿이 갱신되면 `template/`의 pptx를 교체하고 `python tools/measure.py`로 `innogrid_ppt/capacity.py`를 다시 만든 뒤 배포한다.
