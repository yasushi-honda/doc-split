"""ADR-0025 PR4a: PDF/画像 -> RGB numpy配列への変換と入力保護。

paddleocr/paddlepaddleを一切importしない純粋モジュール(functions/src/ocr/buildPageResult.ts の
「firebase-adminを持たない純粋モジュール」規約のPython版)。CIでpaddle無しに軽量テスト可能にする。

PDFラスタライズはscripts/generate-paddle-ocr-golden-text.pyのrender_pdf_page_to_rgb_array()と
完全同一手順(pypdfium2、scale=dpi/72、convert("RGB"))。この手順を変えるとgolden textの再現性が
崩れるため、変更時は再検証必須。
ただしpdf_max_long_sideを超えないページ(A4は200dpiで長辺2339px)は、この手順のまま一切変えない。
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Iterator

logger = logging.getLogger("paddle-ocr.raster")


class InputRejected(Exception):
    """入力保護ガードに違反した場合の例外。app.py側でHTTPステータスへ変換する。"""

    def __init__(self, code: str, message: str, *, limit: int | None = None, actual: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.limit = limit
        self.actual = actual


@dataclass(frozen=True)
class RasterLimits:
    max_pages: int
    max_pixels: int
    # 画像(PNG/JPEG/TIFF/GIF)の長辺の上限px。超える画像はOCRエンジンへ渡す前に、アスペクト比を保って縮小する。
    # 12Mpx前後のスマホ写真でエンジンの推論メモリが4GiBを超え、コンテナがsignal 9で強制終了する(HTTP 503)事象
    # への対策(devで合成JPEGの再現・メモリ8GiB化での解消を確認済み)。縮小するのはOCR入力のみで、
    # 原本のバイト列は変更しない。None(既定)は従来どおり縮小しない。PDFにはpdf_max_long_sideを使う。
    image_max_long_side: int | None = None
    # PDFページの長辺の上限px。画像と同じ理由(推論メモリが4GiBを超えsignal 9)で、1ページ目だけA3横
    # (200dpiで長辺3309px)のPDFがdevの合成PDFで3/3再現した。超えるページだけ、描画後に縮小するのではなく
    # 最初から縮小後の倍率で描画する(縮小前の大きな配列を確保しないため)。上限以下のページは描画手順不変。
    # None(既定)は従来どおり縮小しない。
    pdf_max_long_side: int | None = None

    def __post_init__(self) -> None:
        if self.image_max_long_side is not None and self.image_max_long_side <= 0:
            raise ValueError(f"image_max_long_side は正の整数である必要があります: {self.image_max_long_side}")
        if self.pdf_max_long_side is not None and self.pdf_max_long_side <= 0:
            raise ValueError(f"pdf_max_long_side は正の整数である必要があります: {self.pdf_max_long_side}")


def pdf_pages_to_rgb(data: bytes, *, dpi: int, limits: RasterLimits) -> Iterator["object"]:
    """PDFバイト列をページ単位でRGB numpy配列へ変換するgenerator。

    generatorにするのは、160ページのPDFでも同時に保持するのは1ページ分のraster結果のみに
    留めるため(Cloud Runの4GiBメモリ制約下で全ページを同時展開するとOOMのリスクがある)。
    """
    import numpy as np
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(data)
        page_count = len(pdf)
    except Exception as e:
        raise InputRejected("INVALID_PDF", f"PDFの読み込みに失敗しました: {e}") from e

    if page_count == 0:
        # silent-failure-hunter指摘反映: 0ページのPDFは「正常な空文書」ではなく
        # 破損・切り詰めの兆候である可能性が高いため、暗黙に空のtext/pages(200成功)を
        # 返さず明示的なエラーにする。
        raise InputRejected("INVALID_PDF", "PDFにページが1つも含まれていません")

    if page_count > limits.max_pages:
        raise InputRejected(
            "PAGE_LIMIT_EXCEEDED",
            f"ページ数が上限を超えています(上限: {limits.max_pages}, 実際: {page_count})",
            limit=limits.max_pages,
            actual=page_count,
        )

    for i in range(page_count):
        try:
            page = pdf[i]
            width_pt, height_pt = page.get_size()
            scale = dpi / 72
            pixel_count = int(width_pt * scale) * int(height_pt * scale)
        except pdfium.PdfiumError as e:
            raise InputRejected("INVALID_PDF", f"ページ{i + 1}の読み込みに失敗しました: {e}") from e

        if pixel_count > limits.max_pixels:
            raise InputRejected(
                "PIXEL_LIMIT_EXCEEDED",
                f"ページ{i + 1}のピクセル数が上限を超えています(上限: {limits.max_pixels}, 実際: {pixel_count})",
                limit=limits.max_pixels,
                actual=pixel_count,
            )

        render_scale = _pdf_render_scale(width_pt, height_pt, dpi=dpi, max_long_side=limits.pdf_max_long_side)
        if render_scale != dpi / 72:
            # 縮小したページは、応答のrenderDpi(設定値)と実効解像度が食い違うため、ログで検知できるようにする
            # (書類名・内容は含めない。ページ番号と寸法だけ)。本番(uvicorn、rootロガーはWARNING)で出力されるよう
            # warningにする(infoは握りつぶされる)。app.pyの運用者向けイベントと同じ扱い。
            logger.warning(
                "PDF_PAGE_DOWNSCALED: ページ%d 長辺%dpx→%dpx 実効約%.0fdpi(設定%ddpi)",
                i + 1,
                math.ceil(max(width_pt, height_pt) * dpi / 72),
                limits.pdf_max_long_side,
                render_scale * 72,
                dpi,
            )

        try:
            # silent-failure-hunter指摘反映: pypdfium2.PdfiumErrorはRuntimeErrorの
            # サブクラス(実機確認済み)のため、ここを無保護にするとapp.py側の
            # except RuntimeErrorに捕まり、入力由来の問題が500(エンジン異常)として
            # 誤分類される。ページ単位のレンダリング失敗も422/INVALID_PDFに変換する。
            bitmap = page.render(scale=render_scale)
            pil_image = bitmap.to_pil()
            rgb_array = np.array(pil_image.convert("RGB"))
        except pdfium.PdfiumError as e:
            raise InputRejected("INVALID_PDF", f"ページ{i + 1}のレンダリングに失敗しました: {e}") from e

        yield rgb_array


def _pdf_render_scale(width_pt: float, height_pt: float, *, dpi: int, max_long_side: int | None) -> float:
    """PDFページの描画倍率。長辺がmax_long_sideを超えるページだけ、長辺がちょうど上限に収まる倍率にする。

    上限以下のページはdpi/72のまま(従来と完全に同じ)。pypdfium2は寸法をceilで丸めるため、上限を超える
    場合は(上限-0.5)/長辺ptとし、浮動小数の誤差で長辺が上限+1pxにならないようにする。
    """
    scale = dpi / 72
    if max_long_side is None:
        return scale
    long_side_pt = max(width_pt, height_pt)
    # 長辺px = long_side_pt * dpi / 72。除算を避けて比較し、ちょうど上限(例: 900pt@200dpi=2500px)を誤判定しない
    if long_side_pt * dpi <= max_long_side * 72:
        return scale
    return (max_long_side - 0.5) / long_side_pt


def image_to_rgb(data: bytes, *, limits: RasterLimits) -> Iterator["object"]:
    """画像バイト列(PNG/JPEG/TIFF/GIF)をRGB numpy配列へ変換するgenerator。

    TIFF/GIFは複数フレームを持ちうるため、全フレームをページとして処理する
    (フレーム欠落よりデータ保全を優先する安全側の設計。本番Functions側での扱いは
    PR5/PR6で決定、既知の未解決事項)。
    """
    import numpy as np
    from PIL import Image, UnidentifiedImageError

    try:
        # Image.open()はヘッダ(サイズ・フレーム数)のみを読み、ピクセルデータはこの時点では
        # デコードしない(codex review指摘反映: 以前はここで img.load() を呼びフレーム0を
        # 即座に全展開していたため、max_pixels超過の画像でもチェック前に確保が発生していた)。
        img = Image.open(_bytes_io(data))
        # silent-failure-hunter指摘反映: n_framesは一部コーデックでメタデータの遅延
        # パースを伴い例外を送出しうるため、Image.open()と同じtryブロックで保護する。
        frame_count = getattr(img, "n_frames", 1)
    except (UnidentifiedImageError, OSError) as e:
        raise InputRejected("INVALID_IMAGE", f"画像の読み込みに失敗しました: {e}") from e
    except Image.DecompressionBombError as e:
        raise InputRejected("INVALID_IMAGE", f"画像の展開後サイズが異常です: {e}") from e

    if frame_count > limits.max_pages:
        raise InputRejected(
            "PAGE_LIMIT_EXCEEDED",
            f"フレーム数が上限を超えています(上限: {limits.max_pages}, 実際: {frame_count})",
            limit=limits.max_pages,
            actual=frame_count,
        )

    for i in range(frame_count):
        try:
            img.seek(i)
        except (OSError, EOFError, ValueError) as e:
            raise InputRejected("INVALID_IMAGE", f"フレーム{i + 1}の読み込みに失敗しました: {e}") from e
        width, height = img.size
        pixel_count = width * height
        if pixel_count > limits.max_pixels:
            raise InputRejected(
                "PIXEL_LIMIT_EXCEEDED",
                f"フレーム{i + 1}のピクセル数が上限を超えています(上限: {limits.max_pixels}, 実際: {pixel_count})",
                limit=limits.max_pixels,
                actual=pixel_count,
            )
        try:
            rgb = img.convert("RGB")
            if limits.image_max_long_side is not None:
                rgb = _downscale_to_long_side(rgb, limits.image_max_long_side)
            yield np.array(rgb)
        except (OSError, ValueError, Image.DecompressionBombError) as e:
            raise InputRejected("INVALID_IMAGE", f"フレーム{i + 1}のデコードに失敗しました: {e}") from e


def _downscale_to_long_side(img: "object", max_long_side: int) -> "object":
    """長辺がmax_long_sideを超える場合のみ、アスペクト比を保って縮小する(上限ちょうど以下は無変更)。"""
    from PIL import Image

    width, height = img.size
    long_side = max(width, height)
    if long_side <= max_long_side:
        return img
    scale = max_long_side / long_side
    new_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return img.resize(new_size, Image.Resampling.LANCZOS)


def _bytes_io(data: bytes):
    import io

    return io.BytesIO(data)
