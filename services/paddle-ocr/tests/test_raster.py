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


def test_pdf_pages_to_rgb_rejects_zero_page_pdf():
    """silent-failure-hunter指摘反映: 0ページのPDFは「正常な空文書」として暗黙に
    空リストを返さず、明示的なエラーにする(破損・切り詰めの兆候の可能性が高いため)。"""
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000)
    empty_pdf_bytes = _make_pdf_bytes(0)
    with pytest.raises(InputRejected) as exc_info:
        list(pdf_pages_to_rgb(empty_pdf_bytes, dpi=200, limits=limits))
    assert exc_info.value.code == "INVALID_PDF"


def test_pdf_pages_to_rgb_at_exact_page_limit_succeeds():
    """境界値: ページ数がちょうどmax_pagesの場合は拒否されないこと。"""
    limits = RasterLimits(max_pages=3, max_pixels=40_000_000)
    pdf_bytes = _make_pdf_bytes(3)
    pages = list(pdf_pages_to_rgb(pdf_bytes, dpi=200, limits=limits))
    assert len(pages) == 3


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


def test_image_to_rgb_rejects_pixel_count_exceeding_limit_without_full_decode():
    """codex review指摘反映: サイズ判定がフル展開(np.array(img.convert("RGB")))より
    前に行われることを確認する(以前はImage.load()でフレーム0を即時全展開してから
    チェックしていたため、上限を超える画像でも展開自体は防げなかった)。"""
    limits = RasterLimits(max_pages=8, max_pixels=1000)
    png_bytes = _make_png_bytes(width=2000, height=2000)
    with pytest.raises(InputRejected) as exc_info:
        list(image_to_rgb(png_bytes, limits=limits))
    assert exc_info.value.code == "PIXEL_LIMIT_EXCEEDED"
    assert exc_info.value.limit == 1000


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


def _make_jpeg_bytes(width: int, height: int) -> bytes:
    img = Image.new("RGB", (width, height), color=(240, 240, 240))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def test_image_to_rgb_downscales_long_side_to_limit_keeping_aspect_ratio():
    """長辺が上限を超える画像は、アスペクト比を保って長辺=上限に縮小する(メモリ不足による503の予防)。"""
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000, image_max_long_side=3000)
    pages = list(image_to_rgb(_make_jpeg_bytes(4080, 3060), limits=limits))
    assert len(pages) == 1
    height, width = pages[0].shape[:2]
    assert width == 3000
    assert height == 2250  # 3060 * 3000 / 4080


def test_image_to_rgb_downscales_portrait_by_height():
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000, image_max_long_side=3000)
    pages = list(image_to_rgb(_make_jpeg_bytes(3060, 4080), limits=limits))
    height, width = pages[0].shape[:2]
    assert height == 3000
    assert width == 2250


def test_image_to_rgb_does_not_resize_when_long_side_is_at_or_below_limit():
    """境界値: 長辺がちょうど上限のとき、また上限未満のときは縮小しない(精度を不必要に落とさない)。"""
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000, image_max_long_side=3000)
    at_limit = list(image_to_rgb(_make_jpeg_bytes(3000, 2000), limits=limits))[0]
    below = list(image_to_rgb(_make_jpeg_bytes(2999, 2000), limits=limits))[0]
    assert at_limit.shape[:2] == (2000, 3000)
    assert below.shape[:2] == (2000, 2999)


def test_image_to_rgb_downscales_by_one_pixel_over_limit():
    """境界値: 上限+1pxは縮小対象。"""
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000, image_max_long_side=3000)
    pages = list(image_to_rgb(_make_jpeg_bytes(3001, 2000), limits=limits))
    assert pages[0].shape[1] == 3000


def test_image_to_rgb_without_limit_keeps_original_size():
    """image_max_long_side未指定(既定None)なら従来どおり縮小しない(既存呼び出しの回帰防止)。"""
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000)
    pages = list(image_to_rgb(_make_jpeg_bytes(4080, 3060), limits=limits))
    assert pages[0].shape[:2] == (3060, 4080)


def test_image_to_rgb_downscales_every_frame_of_multi_frame_image():
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000, image_max_long_side=40)
    pages = list(image_to_rgb(_make_gif_bytes(3, width=100, height=50), limits=limits))
    assert len(pages) == 3
    assert all(p.shape[:2] == (20, 40) for p in pages)


def test_image_to_rgb_pixel_guard_still_uses_original_size_before_downscale():
    """縮小しても、入力保護(max_pixels)は縮小前の画素数で判定する(展開爆弾対策を弱めない)。"""
    limits = RasterLimits(max_pages=8, max_pixels=1000, image_max_long_side=10)
    with pytest.raises(InputRejected) as exc_info:
        list(image_to_rgb(_make_png_bytes(width=2000, height=2000), limits=limits))
    assert exc_info.value.code == "PIXEL_LIMIT_EXCEEDED"


def test_image_to_rgb_downscale_never_produces_zero_sized_dimension():
    """極端な縦横比でも短辺が0にならない(最小1px)。"""
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000, image_max_long_side=100)
    pages = list(image_to_rgb(_make_png_bytes(width=10000, height=10), limits=limits))
    height, width = pages[0].shape[:2]
    assert width == 100
    assert height >= 1


def test_raster_limits_rejects_non_positive_image_max_long_side():
    with pytest.raises(ValueError):
        RasterLimits(max_pages=8, max_pixels=40_000_000, image_max_long_side=0)


# --- PDFページの長辺上限(pdf_max_long_side) -------------------------------------------------
# 画像入力には長辺上限があるがPDFには無く、1ページ目だけA3横(200dpiで長辺3309px)のPDFが
# コンテナをsignal 9で落とした(dev合成PDFで3/3再現)。上限を超えるページだけ、最初から縮小後の倍率で描画する。


def _pdf_shapes(pdf_bytes: bytes, *, max_long_side: int | None, dpi: int = 200) -> list[tuple[int, ...]]:
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000, pdf_max_long_side=max_long_side)
    return [a.shape for a in pdf_pages_to_rgb(pdf_bytes, dpi=dpi, limits=limits)]


def test_pdf_a4_page_is_pixel_identical_with_and_without_long_side_cap():
    """A4(長辺2339px)は上限2500以下なので、描画結果が上限なしと完全一致する(golden textの再現性の担保)。"""
    pdf_bytes = _make_pdf_bytes(1, width=595, height=842)
    no_cap = RasterLimits(max_pages=8, max_pixels=40_000_000)
    capped = RasterLimits(max_pages=8, max_pixels=40_000_000, pdf_max_long_side=2500)
    a = next(pdf_pages_to_rgb(pdf_bytes, dpi=200, limits=no_cap))
    b = next(pdf_pages_to_rgb(pdf_bytes, dpi=200, limits=capped))
    assert a.shape == b.shape == (2339, 1653, 3)
    assert np.array_equal(a, b)


def test_pdf_a3_landscape_is_rendered_down_to_long_side_limit_keeping_aspect_ratio():
    """A3横(1191x842pt、200dpiで3309x2339)は長辺2500pxまで縮小され、アスペクト比が保たれる。"""
    (shape,) = _pdf_shapes(_make_pdf_bytes(1, width=1191, height=842), max_long_side=2500)
    height, width = shape[0], shape[1]
    assert width == 2500
    assert abs(width / height - 1191 / 842) < 0.002


def test_pdf_portrait_page_is_limited_by_height():
    (shape,) = _pdf_shapes(_make_pdf_bytes(1, width=842, height=1191), max_long_side=2500)
    assert shape[0] == 2500
    assert shape[1] < 2500


def test_pdf_page_exactly_at_long_side_limit_is_not_resized():
    """900pt@200dpi=ちょうど2500px。上限ちょうどは無変更(上限なしと同じ形状)。"""
    pdf_bytes = _make_pdf_bytes(1, width=900, height=600)
    assert _pdf_shapes(pdf_bytes, max_long_side=2500) == _pdf_shapes(pdf_bytes, max_long_side=None)
    assert _pdf_shapes(pdf_bytes, max_long_side=2500)[0][1] == 2500


def test_pdf_page_one_point_over_long_side_limit_is_resized():
    """901pt@200dpi=2503px。上限を超えるので縮小され、長辺はちょうど上限に収まる。"""
    (shape,) = _pdf_shapes(_make_pdf_bytes(1, width=901, height=600), max_long_side=2500)
    assert shape[1] == 2500


def test_pdf_without_long_side_limit_keeps_full_resolution():
    """pdf_max_long_side未指定(既定None)なら従来どおり縮小しない(既存呼び出しの回帰防止)。"""
    (shape,) = _pdf_shapes(_make_pdf_bytes(1, width=1191, height=842), max_long_side=None)
    assert shape[1] == 3309


def test_pdf_long_side_limit_applies_to_every_page():
    shapes = _pdf_shapes(_make_pdf_bytes(3, width=1191, height=842), max_long_side=2500)
    assert len(shapes) == 3
    assert all(s[1] == 2500 for s in shapes)


def test_pdf_pixel_guard_still_uses_full_resolution_before_downscale():
    """MAX_PIXELS(展開爆弾対策)は縮小前の200dpi換算で判定する(画像経路と同じ方針)。"""
    limits = RasterLimits(max_pages=8, max_pixels=1000, pdf_max_long_side=100)
    with pytest.raises(InputRejected) as exc:
        list(pdf_pages_to_rgb(_make_pdf_bytes(1, width=200, height=300), dpi=200, limits=limits))
    assert exc.value.code == "PIXEL_LIMIT_EXCEEDED"
    assert exc.value.actual == int(200 * 200 / 72) * int(300 * 200 / 72)


def test_raster_limits_rejects_non_positive_pdf_max_long_side():
    with pytest.raises(ValueError):
        RasterLimits(max_pages=8, max_pixels=40_000_000, pdf_max_long_side=0)
    with pytest.raises(ValueError):
        RasterLimits(max_pages=8, max_pixels=40_000_000, pdf_max_long_side=-1)


def _make_mixed_pdf_bytes(sizes: list[tuple[float, float]], *, rotation: int = 0) -> bytes:
    """ページごとに寸法が違うPDF。rotationが0以外なら全ページに回転を設定する。"""
    pdf = pdfium.PdfDocument.new()
    for width, height in sizes:
        page = pdf.new_page(width, height)
        if rotation:
            page.set_rotation(rotation)
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


def test_pdf_mixed_page_sizes_are_scaled_per_page():
    """実害の形: 1ページ目だけA3横で、以降はA4。倍率はページごとに決まり、A4ページは縮小されない。"""
    pdf_bytes = _make_mixed_pdf_bytes([(1191, 842), (595, 842), (595, 842), (1191, 842)])
    shapes = _pdf_shapes(pdf_bytes, max_long_side=2500)
    assert [max(s[:2]) for s in shapes] == [2500, 2339, 2339, 2500]
    assert shapes[1] == (2339, 1653, 3)


def test_pdf_rotated_page_is_limited_by_rotated_long_side():
    """/Rotate 90のA3横は縦長として描画され、回転後の長辺が上限に収まる(get_size()が回転後の寸法を返す前提の固定)。"""
    (shape,) = _pdf_shapes(_make_mixed_pdf_bytes([(1191, 842)], rotation=90), max_long_side=2500)
    assert shape[0] == 2500
    assert shape[1] < shape[0]


# 5000pt(200dpiで約23Mpx)まで。それ以上はMAX_PIXELS(40Mpx)が縮小より先に拒否する
@pytest.mark.parametrize("long_side_pt", [901, 1000, 1191, 3000, 5000])
def test_pdf_scaled_long_side_never_exceeds_limit(long_side_pt):
    """縮小したページの長辺はちょうど上限に収まる(pypdfium2の丸め挙動の変化を検知するための回帰テスト)。"""
    (shape,) = _pdf_shapes(_make_pdf_bytes(1, width=long_side_pt, height=600), max_long_side=2500)
    assert max(shape[:2]) == 2500


def test_pdf_page_just_below_long_side_limit_is_not_resized():
    """899pt@200dpi=2497px。上限未満は無変更。"""
    pdf_bytes = _make_pdf_bytes(1, width=899, height=600)
    assert _pdf_shapes(pdf_bytes, max_long_side=2500) == _pdf_shapes(pdf_bytes, max_long_side=None)


def test_pdf_fractional_point_size_just_over_limit_is_resized():
    """小数ptの寸法(900.4pt@200dpi=2501.1px)も上限を超えれば縮小される。"""
    (shape,) = _pdf_shapes(_make_pdf_bytes(1, width=900.4, height=600), max_long_side=2500)
    assert shape[1] == 2500


def test_pdf_long_side_boundary_follows_dpi():
    """上限判定は渡されたdpiに従う。150dpiでは1200ptがちょうど2500px(無変更)、1201ptは縮小。"""
    exact = _make_pdf_bytes(1, width=1200, height=800)
    over = _make_pdf_bytes(1, width=1201, height=800)
    assert _pdf_shapes(exact, max_long_side=2500, dpi=150) == _pdf_shapes(exact, max_long_side=None, dpi=150)
    assert _pdf_shapes(exact, max_long_side=2500, dpi=150)[0][1] == 2500
    assert _pdf_shapes(over, max_long_side=2500, dpi=150)[0][1] == 2500
    assert _pdf_shapes(over, max_long_side=None, dpi=150)[0][1] == 2503


def test_pdf_downscale_is_logged_only_for_resized_pages(caplog):
    """縮小したページだけログに残す(A4は残さない)。書類名などは含めずページ番号と寸法のみ。"""
    pdf_bytes = _make_mixed_pdf_bytes([(595, 842), (1191, 842)])
    limits = RasterLimits(max_pages=8, max_pixels=40_000_000, pdf_max_long_side=2500)
    with caplog.at_level("INFO", logger="paddle-ocr.raster"):
        list(pdf_pages_to_rgb(pdf_bytes, dpi=200, limits=limits))
    messages = [r.getMessage() for r in caplog.records if "PDF_PAGE_DOWNSCALED" in r.getMessage()]
    assert len(messages) == 1
    assert "ページ2" in messages[0]
    assert "3309px→2500px" in messages[0]
