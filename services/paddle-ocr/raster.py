"""ADR-0025 PR4a: PDF/画像 -> RGB numpy配列への変換と入力保護。

paddleocr/paddlepaddleを一切importしない純粋モジュール(functions/src/ocr/buildPageResult.ts の
「firebase-adminを持たない純粋モジュール」規約のPython版)。CIでpaddle無しに軽量テスト可能にする。

PDFラスタライズはscripts/generate-paddle-ocr-golden-text.pyのrender_pdf_page_to_rgb_array()と
完全同一手順(pypdfium2、scale=dpi/72、convert("RGB"))。この手順を変えるとgolden textの再現性が
崩れるため、変更時は再検証必須。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator


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

        try:
            # silent-failure-hunter指摘反映: pypdfium2.PdfiumErrorはRuntimeErrorの
            # サブクラス(実機確認済み)のため、ここを無保護にするとapp.py側の
            # except RuntimeErrorに捕まり、入力由来の問題が500(エンジン異常)として
            # 誤分類される。ページ単位のレンダリング失敗も422/INVALID_PDFに変換する。
            bitmap = page.render(scale=scale)
            pil_image = bitmap.to_pil()
            rgb_array = np.array(pil_image.convert("RGB"))
        except pdfium.PdfiumError as e:
            raise InputRejected("INVALID_PDF", f"ページ{i + 1}のレンダリングに失敗しました: {e}") from e

        yield rgb_array


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
            yield np.array(img.convert("RGB"))
        except (OSError, ValueError, Image.DecompressionBombError) as e:
            raise InputRejected("INVALID_IMAGE", f"フレーム{i + 1}のデコードに失敗しました: {e}") from e


def _bytes_io(data: bytes):
    import io

    return io.BytesIO(data)
