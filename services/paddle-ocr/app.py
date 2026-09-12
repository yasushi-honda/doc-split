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

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from raster import InputRejected, RasterLimits, image_to_rgb, pdf_pages_to_rgb

logger = logging.getLogger("paddle-ocr")

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
    from ocr_engine import build_engine

    expected_hashes = json.loads(EXPECTED_HASHES_PATH.read_text(encoding="utf-8"))
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


def _log_late_page_result(future: "asyncio.Future[str]") -> None:
    """タイムアウト応答を返した後もバックグラウンドで実行が続く推論の結果を破棄しつつ、
    例外だけはログに残す(add_done_callbackが失敗を握り潰す=silent failureにしないため)。
    """
    try:
        future.result()
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("OCR_ENGINE_ERROR (タイムアウト応答後に完了した推論で例外)")


@app.post("/ocr")
async def ocr(request: Request):
    # silent-failure-hunter指摘反映: 予算の起点をbody読み取り開始前に置く(以前は
    # body読み取り完了後だったため、低速なクライアント送信(意図的なslow-loris含む)が
    # サイズ上限内で無期限に引き延ばされても504契約が発動しなかった)。
    started = time.monotonic()

    def _timed_out() -> bool:
        return time.monotonic() - started > MAX_PROCESSING_SECONDS

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
        remaining = max(MAX_PROCESSING_SECONDS - (time.monotonic() - started), 0)
        data = await asyncio.wait_for(_read_body_with_limit(request), timeout=remaining)
    except asyncio.TimeoutError:
        logger.warning("PROCESSING_TIMEOUT: リクエスト受信が制限時間を超過しました")
        return _error_response(
            504, "PROCESSING_TIMEOUT", f"リクエスト受信が制限時間を超過しました(上限: {MAX_PROCESSING_SECONDS}秒)"
        )
    except InputRejected as e:
        logger.warning("%s: %s", e.code, e.message)
        return _error_response(413, e.code, e.message, limit=e.limit, actual=e.actual)

    if not data:
        return _error_response(400, "EMPTY_BODY", "リクエストbodyが空です")

    kind = ALLOWED_CONTENT_TYPES[content_type]

    if kind == "pdf":
        rgb_page_iter = pdf_pages_to_rgb(data, dpi=RENDER_DPI, limits=LIMITS)
    else:
        rgb_page_iter = image_to_rgb(data, limits=LIMITS)

    loop = asyncio.get_running_loop()

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
            remaining = max(MAX_PROCESSING_SECONDS - (time.monotonic() - started), 0)
            # codex review指摘: ENGINE.page_text()は同期・CPUバウンドな呼び出しであり、
            # async def内でそのまま呼ぶとイベントループをその呼び出しが完了するまで
            # ブロックしてしまう。以前は呼び出し後に_timed_out()を確認していたが、
            # それは「呼び出し自体が予算を超過して完了するまで発火し得ない」事後
            # チェックに過ぎず、タイムアウトを実質的に強制できていなかった。
            #
            # run_in_executorで別スレッドに逃がし、asyncio.wait(..., timeout=remaining)で
            # pendingなFutureを待たず即座に制御を返すことで、GILが(det/rec推論の合間などで)
            # 断続的に解放される通常の遅延に対しては、応答が予算通り504で返る
            # (asyncio.wait_for()でも実測上は同様に即座に返ることを確認済み。以前
            # 「wait_for()は内部でキャンセル完了を待つため機能しない」と記載していたが、
            # これは誤りだった。実測が2秒待っていたのはTestClientをwith文なしで使う際に
            # リクエストごとに生成・破棄されるanyio blocking portalの破棄処理が
            # shutdown_default_executor()相当でexecutorのFutureの完了を待ってしまう
            # というテストハーネス側の交絡であり、wait_for/wait自体の差ではなかった。
            # 直接コルーチン呼び出しの回帰テストで検証済み)。
            #
            # 既知の限界(実機プローブで確認済み、README.md「既知の限界」節参照):
            # PaddleOCRのCPU推論はdet→rec推論全体を通じてGILをほぼ連続的に保持する
            # (実測: 約81秒の推論中94%にあたる約76秒間、メインスレッドが完全に停止)。
            # そのため真に推論がハングした場合、この仕組みは無力で、バックグラウンドの
            # 推論はGILを渡さずCPUを専有し続け、ENGINE内のLockにより後続リクエストも
            # ブロックされうる。この場合の実質的な防波堤はCloud Run自体のリクエスト
            # --timeoutであり、インスタンス自体の入れ替えはPR4bで導入予定のCloud Run
            # liveness probe(追跡: 別途起票するIssue参照)に委ねる。アプリ層でLock取得に
            # 短いタイムアウトを設けて503を返す代替案も検討したが、GIL連続保持時には
            # その待機自体もGILが取れず機能せず、中途半端に導入すると「幽霊推論が
            # 終わるまで503を連発する劣化インスタンス」を作るだけで根本解決にならない
            # ため見送った(セカンドオピニオン2件の一致した結論)。
            page_future = loop.run_in_executor(None, ENGINE.page_text, rgb)
            _, pending = await asyncio.wait({page_future}, timeout=remaining)
            if pending:
                page_future.add_done_callback(_log_late_page_result)
                logger.warning("PROCESSING_TIMEOUT: OCR推論が制限時間を超過しました")
                return _error_response(
                    504,
                    "PROCESSING_TIMEOUT",
                    f"OCR処理が制限時間を超過しました(上限: {MAX_PROCESSING_SECONDS}秒)",
                )
            pages.append(page_future.result())
    except InputRejected as e:
        logger.warning("%s: %s", e.code, e.message)
        return _error_response(422, e.code, e.message, limit=e.limit, actual=e.actual)
    except RuntimeError as e:
        # pypdfium2.PdfiumErrorはRuntimeErrorのサブクラスだが、raster.py側で既に
        # InputRejectedへ変換済みのため、ここに到達するのはエンジン層の異常のみ
        # (silent-failure-hunter指摘反映)。
        logger.exception("OCR_ENGINE_ERROR")
        return _error_response(500, "OCR_ENGINE_ERROR", str(e))
    except Exception:
        # silent-failure-hunter指摘反映: predict()やPillow/pdfiumがInputRejected/
        # RuntimeErrorのいずれにも属さない例外(ValueError等)を投げた場合でも、
        # 文書化されたエラー契約({"error":{...}})を必ず守り、スタックトレースを
        # ログに残す(Starletteの既定500ではログが残らず、実運用で原因追跡できなくなるため)。
        logger.exception("OCR_ENGINE_ERROR (unexpected)")
        return _error_response(500, "OCR_ENGINE_ERROR", "予期しないエラーが発生しました")

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
