def test_health_requires_token(client):
    assert client.get("/health").status_code == 401
    assert client.get("/health", headers={"x-ppt-token": "wrong"}).status_code == 401


def test_health_non_ascii_token_is_401(client):
    assert client.get("/health", headers={"x-ppt-token": "é".encode()}).status_code == 401


def test_health(client, auth):
    r = client.get("/health", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["templateSlides"] == 106 and body["layouts"] == 69


def test_catalog_shape(client, auth):
    cat = client.get("/catalog", headers=auth).json()
    names = {e["name"] for e in cat["layouts"]}
    assert len(cat["layouts"]) == 69 and "card-4" in names and "free-title" in names
    card4 = next(e for e in cat["layouts"] if e["name"] == "card-4")
    assert card4["arity"] == 4 and card4["closing"] == {"required": True, "maxLines": 2}
    assert card4["example"]["layout"] == "card-4" and len(card4["example"]["cards"]) == 4
    assert card4["example"]["cards"][0]["title"] == "…" and card4["example"]["closing"] == "…"
    image4 = next(e for e in cat["layouts"] if e["name"] == "image-4")
    assert image4["example"]["images"] == ["src:장:번호"] * 4
    free = next(e for e in cat["layouts"] if e["name"] == "free-title")
    assert free["example"] == {"layout": "free-title", "title": ["…", "…"], "source": {"slide": 1}}
    assert cat["message"]["example"] == {"layout": "message", "headline": "…", "detail": "…"}
    assert cat["products"] == ["aicubeit", "devopsit", "openstackit", "secloudit", "tabcloudit"]
    assert cat["overview"] == ["lineup", "tafa", "tafa-layers"]


from pathlib import Path


def make_source_pptx(path: Path):
    from pptx import Presentation
    from pptx.util import Cm, Pt
    prs = Presentation()
    prs.slide_width, prs.slide_height = Cm(33.867), Cm(19.05)
    blank = prs.slide_layouts[6]
    s1 = prs.slides.add_slide(blank)
    tb = s1.shapes.add_textbox(Cm(1), Cm(1), Cm(20), Cm(2))
    tb.text_frame.text = "클라우드 전환 배경"
    tb.text_frame.paragraphs[0].runs[0].font.size = Pt(28)
    body = s1.shapes.add_textbox(Cm(1), Cm(5), Cm(20), Cm(5))
    body.text_frame.text = "첫 문단\n둘째 문단"
    s2 = prs.slides.add_slide(blank)
    from PIL import Image  # Pillow는 python-pptx 의존성으로 함께 설치된다
    img = path.parent / "pic.png"
    Image.new("RGB", (40, 30), "blue").save(img)
    s2.shapes.add_picture(str(img), Cm(2), Cm(2), Cm(10), Cm(6))
    prs.save(str(path))


def test_extract_slides(tmp_path):
    from service.extract import extract_slides
    src = tmp_path / "src.pptx"
    make_source_pptx(src)
    slides = extract_slides(str(src))
    assert [s["no"] for s in slides] == [1, 2]
    assert slides[0]["title"] == "클라우드 전환 배경"
    assert slides[0]["texts"] == ["클라우드 전환 배경", "첫 문단\n둘째 문단"]
    assert slides[0]["pictures"] == 0 and slides[0]["titleBottomCm"] == 3.0
    assert slides[1]["texts"] == [] and slides[1]["pictures"] == 1 and slides[1]["title"] is None


def test_extract_endpoint(client, auth, tmp_path, monkeypatch):
    import service.storage as S
    src = tmp_path / "src.pptx"
    make_source_pptx(src)
    def fake_download(url, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(src.read_bytes())
        return dest
    monkeypatch.setattr(S, "download", fake_download)
    r = client.post("/extract", headers=auth, json={"sourceUrl": "https://example.supabase.co/storage/v1/object/sign/ppt/source/a.pptx?token=x"})
    assert r.status_code == 200 and len(r.json()["slides"]) == 2


def test_extract_rejects_foreign_host(client, auth):
    r = client.post("/extract", headers=auth, json={"sourceUrl": "https://evil.example.com/a.pptx"})
    assert r.status_code == 400


URL_OK = "https://example.supabase.co/storage/v1/object/sign/ppt/source/a.pptx?token=x"


def test_check_body_rejects_non_integer_length():
    import pytest
    import main
    from fastapi import HTTPException

    class Stub:
        def __init__(self, length):
            self.headers = {"content-length": length}

    with pytest.raises(HTTPException) as e:
        main.check_body(Stub("abc"))
    assert e.value.status_code == 400 and e.value.detail == "invalid content-length"
    with pytest.raises(HTTPException) as e:
        main.check_body(Stub(str(main.MAX_BODY + 1)))
    assert e.value.status_code == 413


def test_extract_download_failure_is_502(client, auth, monkeypatch):
    import httpx
    import service.storage as S

    def boom(url, dest):
        raise httpx.ConnectError("boom")
    monkeypatch.setattr(S, "download", boom)
    r = client.post("/extract", headers=auth, json={"sourceUrl": URL_OK})
    assert r.status_code == 502


def test_extract_corrupt_pptx_is_400(client, auth, monkeypatch):
    import service.storage as S

    def junk(url, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"not a pptx")
        return dest
    monkeypatch.setattr(S, "download", junk)
    r = client.post("/extract", headers=auth, json={"sourceUrl": URL_OK})
    assert r.status_code == 400 and r.json()["detail"] == "pptx 파일을 열 수 없습니다(손상되었거나 pptx가 아닙니다)"
