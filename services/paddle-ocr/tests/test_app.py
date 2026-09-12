"""ADR-0025 PR4a: app.py(FastAPI HTTP境界)のテスト。

conftest.pyの通り、`TestClient(app)`をwith文なしで生成することで、lifespan(paddleocr実行時
ロード)を一切トリガーせずにHTTP層のみを検証する。ENGINEにはスタブを直接代入する。
"""

from __future__ import annotations

import io

import pypdfium2 as pdfium
import pytest
from fastapi.testclient import TestClient

import app as app_module


class StubEngine:
    """app.pyが要求するインターフェース(page_text, model_version)のみを持つスタブ。"""

    model_version = "stub-model-version"

    def __init__(self, texts_by_call=None):
        self._texts_by_call = list(texts_by_call or [])
        self.calls = 0

    def page_text(self, rgb_array) -> str:
        if self._texts_by_call:
            text = self._texts_by_call[self.calls % len(self._texts_by_call)]
        else:
            text = f"stub-text-{self.calls}"
        self.calls += 1
        return text


def _make_pdf_bytes(page_count: int, *, width: float = 200, height: float = 300) -> bytes:
    pdf = pdfium.PdfDocument.new()
    for _ in range(page_count):
        pdf.new_page(width, height)
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _reset_engine():
    original = app_module.ENGINE
    yield
    app_module.ENGINE = original


@pytest.fixture()
def client():
    return TestClient(app_module.app)


def test_healthz_reports_engine_not_loaded_when_engine_is_none(client):
    app_module.ENGINE = None
    resp = client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["modelLoaded"] is False
    assert body["status"] == "starting"


def test_healthz_reports_model_version_when_engine_loaded(client):
    app_module.ENGINE = StubEngine()
    resp = client.get("/healthz")
    body = resp.json()
    assert body["modelLoaded"] is True
    assert body["modelVersion"] == "stub-model-version"
    assert body["engine"] == "paddleocr"


def test_ocr_rejects_unsupported_content_type(client):
    app_module.ENGINE = StubEngine()
    resp = client.post("/ocr", content=b"not-a-real-file", headers={"content-type": "text/plain"})
    assert resp.status_code == 415
    assert resp.json()["error"]["code"] == "UNSUPPORTED_MEDIA_TYPE"


def test_ocr_rejects_empty_body(client):
    app_module.ENGINE = StubEngine()
    resp = client.post("/ocr", content=b"", headers={"content-type": "application/pdf"})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "EMPTY_BODY"


def test_ocr_single_page_pdf_returns_text_without_page_header(client):
    """text にページヘッダ(--- Page N ---)を含めないことを検証する(本番Functions側との二重防止)。"""
    app_module.ENGINE = StubEngine(texts_by_call=["ケアプラン利用者:田中花子"])
    pdf_bytes = _make_pdf_bytes(1)
    resp = client.post("/ocr", content=pdf_bytes, headers={"content-type": "application/pdf"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["text"] == "ケアプラン利用者:田中花子"
    assert body["pages"] == ["ケアプラン利用者:田中花子"]
    assert body["pageCount"] == 1
    assert "--- Page" not in body["text"]


def test_ocr_multi_page_pdf_joins_pages_with_double_newline_no_header(client):
    """複数ページ時、text は pages.join("\\n\\n") と一義的に定まる(v2で契約を明確化)。"""
    app_module.ENGINE = StubEngine(texts_by_call=["1ページ目", "2ページ目", "3ページ目"])
    pdf_bytes = _make_pdf_bytes(3)
    resp = client.post("/ocr", content=pdf_bytes, headers={"content-type": "application/pdf"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["pages"] == ["1ページ目", "2ページ目", "3ページ目"]
    assert body["text"] == "1ページ目\n\n2ページ目\n\n3ページ目"
    assert body["pageCount"] == 3


def test_ocr_pdf_exceeding_max_pages_returns_422(client, monkeypatch):
    monkeypatch.setattr(app_module, "LIMITS", app_module.RasterLimits(max_pages=2, max_pixels=app_module.MAX_PIXELS))
    app_module.ENGINE = StubEngine()
    pdf_bytes = _make_pdf_bytes(3)
    resp = client.post("/ocr", content=pdf_bytes, headers={"content-type": "application/pdf"})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "PAGE_LIMIT_EXCEEDED"
    assert body["error"]["limit"] == 2
    assert body["error"]["actual"] == 3


def test_ocr_invalid_pdf_returns_422(client):
    app_module.ENGINE = StubEngine()
    resp = client.post("/ocr", content=b"this is not a valid pdf", headers={"content-type": "application/pdf"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "INVALID_PDF"


def test_ocr_payload_too_large_returns_413(client, monkeypatch):
    monkeypatch.setattr(app_module, "MAX_UPLOAD_BYTES", 10)
    app_module.ENGINE = StubEngine()
    resp = client.post("/ocr", content=b"x" * 1000, headers={"content-type": "application/pdf"})
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_ocr_times_out_after_last_page_inference_exceeds_budget(client, monkeypatch):
    """codex review指摘反映: page_text呼び出し前だけのチェックでは、最終ページ(または
    単一ページ)のOCR自体が予算を超過した場合に200で成功応答してしまっていた。
    呼び出し後にも再チェックすることで504が返ることを確認する。"""
    import time as time_module

    class SlowStubEngine(StubEngine):
        def page_text(self, rgb_array) -> str:
            time_module.sleep(0.1)
            return super().page_text(rgb_array)

    monkeypatch.setattr(app_module, "MAX_PROCESSING_SECONDS", 0.05)
    app_module.ENGINE = SlowStubEngine()
    pdf_bytes = _make_pdf_bytes(1)
    resp = client.post("/ocr", content=pdf_bytes, headers={"content-type": "application/pdf"})
    assert resp.status_code == 504
    assert resp.json()["error"]["code"] == "PROCESSING_TIMEOUT"


def test_error_message_does_not_leak_input_content(client):
    """個人情報保護: エラーメッセージに入力内容が含まれないことを確認する。"""
    app_module.ENGINE = StubEngine()
    secret_marker = "SECRET_CUSTOMER_NAME_MARKER"
    resp = client.post(
        "/ocr", content=f"invalid-pdf-{secret_marker}".encode(), headers={"content-type": "application/pdf"}
    )
    assert resp.status_code == 422
    assert secret_marker not in resp.text
