"""ADR-0025 PR4a: app.py(FastAPI HTTP境界)のテスト。

conftest.pyの通り、`TestClient(app)`をwith文なしで生成することで、lifespan(paddleocr実行時
ロード)を一切トリガーせずにHTTP層のみを検証する。ENGINEにはスタブを直接代入する。
"""

from __future__ import annotations

import asyncio
import io
import json

import pypdfium2 as pdfium
import pytest
from fastapi.testclient import TestClient
from PIL import Image

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


def _make_png_bytes(width: int = 100, height: int = 100) -> bytes:
    img = Image.new("RGB", (width, height), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_gif_bytes(frame_count: int, *, width: int = 50, height: int = 50) -> bytes:
    frames = [Image.new("RGB", (width, height), color=(i * 10 % 255, 0, 0)) for i in range(frame_count)]
    buf = io.BytesIO()
    frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:])
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
    """ADR-0025 PR4b: ENGINE未初期化時は503を返す(startup/liveness probe対応)。
    以前は200を返していたが、これはprobeの誤判定防止としては不要と判明済み
    (lifespan startup完了までTCP接続自体がリッスンされないため)。定常状態の
    ヘルスチェック応答をより正確にするための防御的な変更として503化した。"""
    app_module.ENGINE = None
    resp = client.get("/healthz")
    assert resp.status_code == 503
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
    body = resp.json()
    assert body["error"]["code"] == "PAYLOAD_TOO_LARGE"
    assert body["error"]["limit"] == 10
    assert body["error"]["actual"] == 1000


def test_ocr_zero_page_pdf_returns_422(client):
    """pr-test-analyzer/silent-failure-hunter指摘反映: 0ページのPDFは「正常な空文書」
    として200を返さず、明示的にエラーとする(破損・切り詰めの兆候である可能性が高いため)。"""
    app_module.ENGINE = StubEngine()
    empty_pdf = pdfium.PdfDocument.new()
    buf = io.BytesIO()
    empty_pdf.save(buf)
    resp = client.post("/ocr", content=buf.getvalue(), headers={"content-type": "application/pdf"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "INVALID_PDF"


def test_ocr_returns_500_when_engine_raises_runtime_error(client):
    """pr-test-analyzer指摘反映: エンジン内部異常(RuntimeError)が500として
    正しく応答されることを確認する(現状は422/504系の異常系のみ網羅されていた)。"""

    class FailingStubEngine(StubEngine):
        def page_text(self, rgb_array) -> str:
            raise RuntimeError("PaddleOCR実行結果の形状が想定外です: dummy")

    app_module.ENGINE = FailingStubEngine()
    pdf_bytes = _make_pdf_bytes(1)
    resp = client.post("/ocr", content=pdf_bytes, headers={"content-type": "application/pdf"})
    assert resp.status_code == 500
    assert resp.json()["error"]["code"] == "OCR_ENGINE_ERROR"


def test_ocr_returns_500_when_engine_raises_unexpected_exception(client):
    """silent-failure-hunter指摘反映: InputRejected/RuntimeErrorのいずれにも属さない
    例外(ValueError等)でも、文書化されたエラー契約({"error":{...}})を守ること。"""

    class WeirdStubEngine(StubEngine):
        def page_text(self, rgb_array) -> str:
            raise ValueError("想定外の内部エラー")

    app_module.ENGINE = WeirdStubEngine()
    pdf_bytes = _make_pdf_bytes(1)
    resp = client.post("/ocr", content=pdf_bytes, headers={"content-type": "application/pdf"})
    assert resp.status_code == 500
    body = resp.json()
    assert body["error"]["code"] == "OCR_ENGINE_ERROR"
    assert "想定外の内部エラー" not in body["error"]["message"]  # 内部例外メッセージをそのまま漏らさない


def test_ocr_returns_500_when_engine_is_none(client):
    """pr-test-analyzer指摘反映: /healthzは既にENGINE=Noneをテスト済みだが、/ocr側の
    同分岐は未テストだった。起動直後にリクエストが到達するレースを想定した防御を確認する。"""
    app_module.ENGINE = None
    pdf_bytes = _make_pdf_bytes(1)
    resp = client.post("/ocr", content=pdf_bytes, headers={"content-type": "application/pdf"})
    assert resp.status_code == 500
    assert resp.json()["error"]["code"] == "OCR_ENGINE_ERROR"


def test_ocr_png_content_type_end_to_end(client):
    """pr-test-analyzer指摘反映: 画像系Content-Type(png/gif等)がHTTPレベルで
    エンドツーエンド検証されていなかった(raster.py単体テストのみ)。"""
    app_module.ENGINE = StubEngine(texts_by_call=["PNGからのテキスト"])
    resp = client.post("/ocr", content=_make_png_bytes(), headers={"content-type": "image/png"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["text"] == "PNGからのテキスト"
    assert body["pageCount"] == 1


def test_ocr_gif_multi_frame_content_type_end_to_end(client):
    """複数フレームGIFが全フレームpageCountとして処理されることをHTTPレベルで確認する。"""
    app_module.ENGINE = StubEngine(texts_by_call=["フレーム1", "フレーム2", "フレーム3"])
    resp = client.post("/ocr", content=_make_gif_bytes(3), headers={"content-type": "image/gif"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["pageCount"] == 3
    assert body["pages"] == ["フレーム1", "フレーム2", "フレーム3"]


def test_ocr_gif_frame_count_exceeding_limit_returns_422_end_to_end(client, monkeypatch):
    monkeypatch.setattr(app_module, "LIMITS", app_module.RasterLimits(max_pages=2, max_pixels=app_module.MAX_PIXELS))
    app_module.ENGINE = StubEngine()
    resp = client.post("/ocr", content=_make_gif_bytes(3), headers={"content-type": "image/gif"})
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "PAGE_LIMIT_EXCEEDED"
    assert body["error"]["actual"] == 3


def test_ocr_content_type_with_charset_parameter_is_accepted(client):
    """Content-Typeにパラメータが付与された場合(例: application/pdf; charset=binary)も
    正しく許可されることを確認する。"""
    app_module.ENGINE = StubEngine(texts_by_call=["テキスト"])
    pdf_bytes = _make_pdf_bytes(1)
    resp = client.post(
        "/ocr", content=pdf_bytes, headers={"content-type": "application/pdf; charset=binary"}
    )
    assert resp.status_code == 200


def test_ocr_missing_content_type_header_returns_415(client):
    app_module.ENGINE = StubEngine()
    # TestClientはcontentのみ渡すとContent-Typeを自動付与するため、明示的に空にする
    resp = client.post("/ocr", content=b"dummy", headers={"content-type": ""})
    assert resp.status_code == 415
    assert resp.json()["error"]["code"] == "UNSUPPORTED_MEDIA_TYPE"


def test_ocr_pdf_at_exact_page_limit_succeeds(client, monkeypatch):
    """境界値: ページ数がちょうどmax_pagesの場合は拒否されず成功すること
    (> と >= の取り違えのような回帰の検知)。"""
    monkeypatch.setattr(app_module, "LIMITS", app_module.RasterLimits(max_pages=2, max_pixels=app_module.MAX_PIXELS))
    app_module.ENGINE = StubEngine(texts_by_call=["1p", "2p"])
    pdf_bytes = _make_pdf_bytes(2)
    resp = client.post("/ocr", content=pdf_bytes, headers={"content-type": "application/pdf"})
    assert resp.status_code == 200
    assert resp.json()["pageCount"] == 2


def test_ocr_payload_at_exact_size_limit_succeeds(client, monkeypatch):
    """境界値: アップロードサイズがちょうどMAX_UPLOAD_BYTESの場合は拒否されず
    処理が進むこと(空PDFではないため422になるが、413にはならないことを確認する)。"""
    pdf_bytes = _make_pdf_bytes(1)
    monkeypatch.setattr(app_module, "MAX_UPLOAD_BYTES", len(pdf_bytes))
    app_module.ENGINE = StubEngine(texts_by_call=["ok"])
    resp = client.post("/ocr", content=pdf_bytes, headers={"content-type": "application/pdf"})
    assert resp.status_code != 413


def test_ocr_times_out_after_last_page_inference_exceeds_budget(client, monkeypatch):
    """codex review指摘反映(2回目): 最終ページ(または単一ページ)のOCR呼び出し自体が
    予算を超過する場合、以前は呼び出し完了を待ってから事後チェックで504を返していたため、
    呼び出しがハングまたは非常に長時間かかると事実上タイムアウトが機能しなかった
    (呼び出しが返るまでレスポンスも返せないため)。ここではステータス/ボディのみ確認する
    (応答時間の実測はtest_ocr_timeout_does_not_wait_for_slow_inference_to_completeで行う。
    TestClientはwith文なし利用時、リクエストごとにanyioのblocking portalを都度生成・破棄し、
    その破棄処理がbackgroundで走り続けるrun_in_executorのFutureの完了を待ってしまうため、
    このテストで応答時間を測ると本番のuvicorn常駐イベントループでは起きない待機が
    混入し誤った失敗になる)。"""
    import time as time_module

    class SlowStubEngine(StubEngine):
        def page_text(self, rgb_array) -> str:
            time_module.sleep(0.2)
            return super().page_text(rgb_array)

    monkeypatch.setattr(app_module, "MAX_PROCESSING_SECONDS", 0.05)
    app_module.ENGINE = SlowStubEngine()
    pdf_bytes = _make_pdf_bytes(1)
    resp = client.post("/ocr", content=pdf_bytes, headers={"content-type": "application/pdf"})
    assert resp.status_code == 504
    assert resp.json()["error"]["code"] == "PROCESSING_TIMEOUT"


async def _call_ocr_directly(pdf_bytes: bytes) -> tuple[float, object]:
    """TestClientのportal破棄処理(with文なし利用時、リクエストごとにanyioの
    blocking portalを生成・破棄し、その破棄処理がbackgroundで走り続けるrun_in_executorの
    Futureの完了を待ってしまう)を経由しない、直接のコルーチン呼び出し。本番のuvicorn
    常駐イベントループに近い条件でタイムアウトの応答時間を実測するために使う。"""
    import time as time_module

    from starlette.requests import Request

    sent = False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": pdf_bytes, "more_body": False}
        return {"type": "http.disconnect"}

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/ocr",
        "headers": [(b"content-type", b"application/pdf")],
    }
    request = Request(scope, receive)
    started = time_module.monotonic()
    result = await app_module.ocr(request)
    return time_module.monotonic() - started, result


def test_ocr_timeout_does_not_wait_for_slow_inference_to_complete(monkeypatch):
    """codex review指摘反映(2回目)の中核: MAX_PROCESSING_SECONDSを超える推論に対して、
    レスポンスが推論の完了を待たずに返ることを実測する(_call_ocr_directlyのdocstring参照)。"""
    import time as time_module

    class SlowStubEngine(StubEngine):
        def page_text(self, rgb_array) -> str:
            time_module.sleep(2.0)
            return super().page_text(rgb_array)

    monkeypatch.setattr(app_module, "MAX_PROCESSING_SECONDS", 0.05)
    app_module.ENGINE = SlowStubEngine()
    pdf_bytes = _make_pdf_bytes(1)

    elapsed, result = asyncio.run(_call_ocr_directly(pdf_bytes))

    assert result.status_code == 504
    body = json.loads(result.body)
    assert body["error"]["code"] == "PROCESSING_TIMEOUT"
    # 推論の完了(2.0秒)を待たずに、予算超過時点(0.05秒)で応答が返っていること。
    assert elapsed < 1.0


def test_ocr_timeout_does_not_wait_for_slow_rasterization_to_complete(monkeypatch):
    """codex review指摘反映(3回目): ラスタライズ(next(rgb_page_iter))も同期・CPUバウンドな
    呼び出しであり、OCR推論と同じrun_in_executor+asyncio.waitパターンで非ブロッキング化した。
    ラスタライズ自体が予算を超過する場合も、完了を待たずに504が返ることを実測する。"""
    import time as time_module

    def slow_pdf_pages_to_rgb(data, *, dpi, limits):
        time_module.sleep(2.0)
        yield object()

    monkeypatch.setattr(app_module, "pdf_pages_to_rgb", slow_pdf_pages_to_rgb)
    monkeypatch.setattr(app_module, "MAX_PROCESSING_SECONDS", 0.05)
    app_module.ENGINE = StubEngine()
    pdf_bytes = _make_pdf_bytes(1)

    elapsed, result = asyncio.run(_call_ocr_directly(pdf_bytes))

    assert result.status_code == 504
    body = json.loads(result.body)
    assert body["error"]["code"] == "PROCESSING_TIMEOUT"
    # ラスタライズの完了(2.0秒)を待たずに、予算超過時点(0.05秒)で応答が返っていること。
    assert elapsed < 1.0


def test_error_message_does_not_leak_input_content(client):
    """個人情報保護: エラーメッセージに入力内容が含まれないことを確認する。"""
    app_module.ENGINE = StubEngine()
    secret_marker = "SECRET_CUSTOMER_NAME_MARKER"
    resp = client.post(
        "/ocr", content=f"invalid-pdf-{secret_marker}".encode(), headers={"content-type": "application/pdf"}
    )
    assert resp.status_code == 422
    assert secret_marker not in resp.text
