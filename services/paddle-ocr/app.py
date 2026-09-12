"""ADR-0025 PR4a: PaddleOCR Cloud Runサービス(FastAPI)。

エンドポイント契約:
- GET /healthz: エンジンの状態・モデルバージョン等を返す。OCRは実行しない(軽量)。
- POST /ocr: 生バイナリbody(Content-Typeでpdf/jpeg/png/tiff/gifを判定)を受け取り、
  {text, pages, pageCount, engine, modelVersion, lang, renderDpi, processingMs} を返す。

契約上の重要な決定(v2、codex review指摘反映):
- text は常に pages.join("\\n\\n") (ページヘッダなし) と定義する。本番の
  functions/src/ocr/ocrProcessor.ts:356-359 がFunctions側で "--- Page N ---" ヘッダを
  付けるため、サービス側で付けると二重ヘッダになる。本番は常に1ページずつ送るため、
  実運用では text === pages[0] になる。
- Content-Typeの許可リストは本番のfunctions/src/upload/uploadPdf.tsの受理MIMEタイプ
  (application/pdf, image/jpeg, image/png, image/tiff, image/gif の5種類)と完全に同期させる。
- 処理時間超過は422ではなく504(入力由来の拒否と負荷起因の一時障害を区別し、将来の
  クライアント側リトライ分類(5xx/timeoutはリトライ対象)と整合させるため)。
"""

from __future__ import annotations

import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from raster import InputRejected, RasterLimits, image_to_rgb, pdf_pages_to_rgb

MODEL_ROOT = Path(os.environ.get("PADDLE_MODEL_DIR", "/opt/paddle-ocr/models"))
EXPECTED_HASHES_PATH = Path(os.environ.get("PADDLE_EXPECTED_HASHES", "/app/expected-model-hashes.json"))
RENDER_DPI = int(os.environ.get("PADDLE_PDF_RENDER_DPI", "200"))
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))
MAX_PAGES = int(os.environ.get("MAX_PAGES", "8"))
MAX_PIXELS = int(os.environ.get("MAX_PIXELS", str(40_000_000)))
MAX_PROCESSING_SECONDS = float(os.environ.get("MAX_PROCESSING_SECONDS", "240"))
IMAGE_DIGEST = os.environ.get("IMAGE_DIGEST", "unknown")

ALLOWED_CONTENT_TYPES = {
    "application/pdf": "pdf",
    "image/jpeg": "image",
    "image/png": "image",
    "image/tiff": "image",
    "image/gif": "image",
}

LIMITS = RasterLimits(max_pages=MAX_PAGES, max_pixels=MAX_PIXELS)

ENGINE = None  # lifespan内でセットする(モジュールimport時にpaddleocrを引かないため)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global ENGINE
    import json as _json

    from ocr_engine import build_engine

    expected_hashes = _json.loads(EXPECTED_HASHES_PATH.read_text(encoding="utf-8"))
    ENGINE = build_engine(MODEL_ROOT, expected_hashes)
    yield


app = FastAPI(lifespan=lifespan)


def _error_response(status_code: int, code: str, message: str, *, limit: Optional[int] = None, actual: Optional[int] = None) -> JSONResponse:
    body: dict = {"error": {"code": code, "message": message}}
    if limit is not None:
        body["error"]["limit"] = limit
    if actual is not None:
        body["error"]["actual"] = actual
    return JSONResponse(status_code=status_code, content=body)


@app.get("/healthz")
def healthz():
    return {
        "status": "ok" if ENGINE is not None else "starting",
        "engine": "paddleocr",
        "modelVersion": ENGINE.model_version if ENGINE is not None else None,
        "renderDpi": RENDER_DPI,
        "imageDigest": IMAGE_DIGEST,
        "modelLoaded": ENGINE is not None,
    }


async def _read_body_with_limit(request: Request) -> bytes:
    """Content-Lengthヘッダを鵜呑みにせず、受信バイト数を累積カウントして上限超過時点で
    即座に打ち切る(chunked転送等でヘッダが無い/不正な場合の抜け道を塞ぐ、codex review指摘)。
    """
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise InputRejected(
                "PAYLOAD_TOO_LARGE",
                f"アップロードサイズが上限を超えています(上限: {MAX_UPLOAD_BYTES}バイト)",
                limit=MAX_UPLOAD_BYTES,
                actual=total,
            )
        chunks.append(chunk)
    return b"".join(chunks)


@app.post("/ocr")
async def ocr(request: Request):
    if ENGINE is None:
        return _error_response(500, "OCR_ENGINE_ERROR", "エンジンが初期化されていません")

    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        return _error_response(
            415,
            "UNSUPPORTED_MEDIA_TYPE",
            f"未対応のContent-Typeです: {content_type or '(なし)'}。"
            f"許可: {', '.join(sorted(ALLOWED_CONTENT_TYPES))}",
        )

    try:
        data = await _read_body_with_limit(request)
    except InputRejected as e:
        return _error_response(413, e.code, e.message, limit=e.limit, actual=e.actual)

    if not data:
        return _error_response(400, "EMPTY_BODY", "リクエストbodyが空です")

    kind = ALLOWED_CONTENT_TYPES[content_type]
    started = time.monotonic()

    def _timed_out() -> bool:
        return time.monotonic() - started > MAX_PROCESSING_SECONDS

    if kind == "pdf":
        rgb_page_iter = pdf_pages_to_rgb(data, dpi=RENDER_DPI, limits=LIMITS)
    else:
        rgb_page_iter = image_to_rgb(data, limits=LIMITS)

    try:
        pages: list[str] = []
        # raster側のgeneratorを1ページずつ消費し、OCR後は次ページの参照を保持しない
        # (codex review指摘: list()で全ページを先に確保すると、8ページ×4000万ピクセルで
        # 約960MBを同時保持しラスタライズのメモリ上限設計が無効化されるため)。
        for rgb in rgb_page_iter:
            if _timed_out():
                return _error_response(
                    504,
                    "PROCESSING_TIMEOUT",
                    f"ラスタライズ処理が制限時間を超過しました(上限: {MAX_PROCESSING_SECONDS}秒)",
                )
            pages.append(ENGINE.page_text(rgb))
            # codex review指摘: page_text呼び出し後にも再チェックする。呼び出し前だけの
            # チェックでは、最終ページ(または単一ページ)のOCR自体が予算を超過した場合に
            # 200で成功応答してしまい、504タイムアウト契約を満たさないため。
            if _timed_out():
                return _error_response(
                    504,
                    "PROCESSING_TIMEOUT",
                    f"OCR処理が制限時間を超過しました(上限: {MAX_PROCESSING_SECONDS}秒)",
                )
    except InputRejected as e:
        return _error_response(422, e.code, e.message, limit=e.limit, actual=e.actual)
    except RuntimeError as e:
        return _error_response(500, "OCR_ENGINE_ERROR", str(e))

    processing_ms = int((time.monotonic() - started) * 1000)

    return {
        "text": "\n\n".join(pages),
        "pages": pages,
        "pageCount": len(pages),
        "engine": "paddleocr",
        "modelVersion": ENGINE.model_version,
        "lang": "japan",
        "renderDpi": RENDER_DPI,
        "processingMs": processing_ms,
    }
