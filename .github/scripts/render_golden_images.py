"""goldenのPDF(実データではない)を、縮小の精度確認用にJPEGへ画像化する。

出力: <out_dir>/<fixtureId>__<variant>.jpg
- control: goldenと同じ200dpiで描画(長辺は約2339px。縮小が働かない対照)
- large:   長辺4000pxで描画(MAX_IMAGE_LONG_SIDE=3000のとき、サービス側で縮小される)
- partial: 4000x3000の灰色キャンバスの中央に、ページを高さ1500px(画面の50%)で配置
           (手帳のように書類が写真の一部しか占めない撮影の模擬。実効解像度が下がる側のストレス)
"""
import sys
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image

FIXTURES = {
    "golden-plain-01": "golden_plain_01.pdf",
    "golden-plain-02": "golden_plain_02.pdf",
    "golden-oldkanji-01": "golden_oldkanji_01.pdf",
    "golden-oldkanji-02": "golden_oldkanji_02.pdf",
}
JPEG_QUALITY = 90


def render(pdf_path: Path, scale: float) -> Image.Image:
    doc = pdfium.PdfDocument(str(pdf_path))
    page = doc[0]
    return page.render(scale=scale).to_pil().convert("RGB")


def render_to_long_side(pdf_path: Path, long_side: int) -> Image.Image:
    doc = pdfium.PdfDocument(str(pdf_path))
    w_pt, h_pt = doc[0].get_size()
    return render(pdf_path, long_side / max(w_pt, h_pt))


def main(golden_dir: str, out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for fixture_id, pdf_name in FIXTURES.items():
        pdf_path = Path(golden_dir) / pdf_name
        control = render(pdf_path, 200 / 72)
        control.save(out / f"{fixture_id}__control.jpg", "JPEG", quality=JPEG_QUALITY)

        large = render_to_long_side(pdf_path, 4000)
        large.save(out / f"{fixture_id}__large.jpg", "JPEG", quality=JPEG_QUALITY)

        w_pt, h_pt = pdfium.PdfDocument(str(pdf_path))[0].get_size()
        page_img = render(pdf_path, 1500 / h_pt)
        canvas = Image.new("RGB", (4000, 3000), (200, 200, 200))
        canvas.paste(page_img, ((4000 - page_img.width) // 2, (3000 - page_img.height) // 2))
        canvas.save(out / f"{fixture_id}__partial.jpg", "JPEG", quality=JPEG_QUALITY)
        print(fixture_id, "control", control.size, "large", large.size, "partial-page", page_img.size)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: render_golden_images.py <golden_dir> <out_dir>")
    main(sys.argv[1], sys.argv[2])
