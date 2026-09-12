"""ADR-0025 PR4a: raster.py(paddle非依存の入力保護ロジック)のテスト。"""

from __future__ import annotations

import io

import numpy as np
import pypdfium2 as pdfium
import pytest
from PIL import Image

from raster import InputRejected, RasterLimits, image_to_rgb, pdf_pages_to_rgb


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


def test_pdf_pages_to_rgb_yields_one_array_per_page():
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000)
    pdf_bytes = _make_pdf_bytes(3)
    pages = list(pdf_pages_to_rgb(pdf_bytes, dpi=200, limits=limits))
    assert len(pages) == 3
    for arr in pages:
        assert isinstance(arr, np.ndarray)
        assert arr.ndim == 3
        assert arr.shape[2] == 3  # RGB


def test_pdf_pages_to_rgb_rejects_page_count_exceeding_limit():
    limits = RasterLimits(max_pages=2, max_pixels=40_000_000)
    pdf_bytes = _make_pdf_bytes(3)
    with pytest.raises(InputRejected) as exc_info:
        list(pdf_pages_to_rgb(pdf_bytes, dpi=200, limits=limits))
    assert exc_info.value.code == "PAGE_LIMIT_EXCEEDED"
    assert exc_info.value.limit == 2
    assert exc_info.value.actual == 3


def test_pdf_pages_to_rgb_rejects_pixel_count_exceeding_limit():
    # 200DPIで巨大な物理ページサイズを指定し、ピクセル数上限に到達させる
    limits = RasterLimits(max_pages=8, max_pixels=1000)
    pdf_bytes = _make_pdf_bytes(1, width=2000, height=2000)
    with pytest.raises(InputRejected) as exc_info:
        list(pdf_pages_to_rgb(pdf_bytes, dpi=200, limits=limits))
    assert exc_info.value.code == "PIXEL_LIMIT_EXCEEDED"


def test_pdf_pages_to_rgb_rejects_invalid_pdf():
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000)
    with pytest.raises(InputRejected) as exc_info:
        list(pdf_pages_to_rgb(b"not a pdf", dpi=200, limits=limits))
    assert exc_info.value.code == "INVALID_PDF"


def test_pdf_pages_to_rgb_is_lazy_generator():
    """160ページでも同時保持は1ページ分のみ、というメモリ制約を守るためgeneratorであることを確認。"""
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000)
    pdf_bytes = _make_pdf_bytes(3)
    gen = pdf_pages_to_rgb(pdf_bytes, dpi=200, limits=limits)
    assert hasattr(gen, "__next__")
    first = next(gen)
    assert isinstance(first, np.ndarray)


def test_image_to_rgb_single_frame_png():
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000)
    png_bytes = _make_png_bytes()
    pages = list(image_to_rgb(png_bytes, limits=limits))
    assert len(pages) == 1
    assert pages[0].shape[2] == 3


def test_image_to_rgb_multi_frame_gif_yields_all_frames():
    """GIF/TIFFの複数フレームは全て処理する(データ欠落よりデータ保全を優先する安全側の設計)。"""
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000)
    gif_bytes = _make_gif_bytes(4)
    pages = list(image_to_rgb(gif_bytes, limits=limits))
    assert len(pages) == 4


def test_image_to_rgb_rejects_frame_count_exceeding_limit():
    limits = RasterLimits(max_pages=2, max_pixels=40_000_000)
    gif_bytes = _make_gif_bytes(4)
    with pytest.raises(InputRejected) as exc_info:
        list(image_to_rgb(gif_bytes, limits=limits))
    assert exc_info.value.code == "PAGE_LIMIT_EXCEEDED"
    assert exc_info.value.actual == 4


def test_image_to_rgb_rejects_invalid_image():
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000)
    with pytest.raises(InputRejected) as exc_info:
        list(image_to_rgb(b"not an image", limits=limits))
    assert exc_info.value.code == "INVALID_IMAGE"
