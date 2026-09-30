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
