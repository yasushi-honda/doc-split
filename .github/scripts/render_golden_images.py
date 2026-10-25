"""goldenのPDF(実データではない)を、縮小の精度確認用にJPEGへ画像化する。

出力: <out_dir>/<fixtureId>__<variant>.jpg
- control: goldenと同じ200dpiで描画(長辺は約2339px。縮小が働かない対照)
- large:   長辺4000pxで描画(MAX_IMAGE_LONG_SIDEの既定(2500)を超えるため、サービス側で縮小される)
- partial: 4000x3000の灰色キャンバスの中央に、ページを高さ1500px(画面の50%)で配置
           (書類が写真の一部しか占めない撮影の模擬。実効解像度が下がる側のストレス)

さらに、大判PDFの縮小後の読み取り精度の確認用に、同じgoldenから次のPDFも出力する:
出力: <out_dir>/<fixtureId>__<variant>.pdf (variantは画像と衝突しないよう `pdf-` 接頭辞)
- pdf-control: goldenのPDFをそのまま(A4、200dpiで長辺2339px。縮小が働かない対照)
- pdf-big-k1 / pdf-big-k2 / pdf-big-k27: 1608x3365ptのページ(kanameoneで422になった大判ページの寸法)の
  左上に、goldenのページ内容を倍率k(1 / 2 / 2.7)で配置する。k=2.7でほぼページ幅いっぱい(595pt x 2.7 = 1606.5pt)。
  サービスはこのページを長辺2500pxへ縮小して描画する(約0.743 px/pt)ため、文字の画素高は対照の約 k x 0.267 倍
  (k=1: 約0.27、k=2: 約0.53、k=2.7: 約0.72)になる。実書類の文字の大きさは不明なので、倍率を振って
  「どの大きさから読めるか」を見る。
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

# 1608x3365pt(実測: kanameoneで422になったページは1607.8x3365.3pt)
LARGE_PAGE_W_PT = 1608
LARGE_PAGE_H_PT = 3365
# 埋め込む画像の解像度。サービス側の描画(約53dpi)より十分高い値にして、ここで解像度を落とさない
LARGE_EMBED_DPI = 200
LARGE_PDF_SCALES = {"pdf-big-k1": 1.0, "pdf-big-k2": 2.0, "pdf-big-k27": 2.7}


def render(pdf_path: Path, scale: float) -> Image.Image:
    doc = pdfium.PdfDocument(str(pdf_path))
    page = doc[0]
    return page.render(scale=scale).to_pil().convert("RGB")


def render_to_long_side(pdf_path: Path, long_side: int) -> Image.Image:
    doc = pdfium.PdfDocument(str(pdf_path))
    w_pt, h_pt = doc[0].get_size()
    return render(pdf_path, long_side / max(w_pt, h_pt))


def make_large_page_pdf(src_pdf: Path, out_path: Path, k: float) -> tuple[int, int]:
    """大判ページの左上へ、goldenのページ内容を倍率kで配置したPDFを書き出し、配置した内容の画素寸法を返す。"""
    canvas_w = round(LARGE_PAGE_W_PT * LARGE_EMBED_DPI / 72)
    canvas_h = round(LARGE_PAGE_H_PT * LARGE_EMBED_DPI / 72)
    content = render(src_pdf, k * LARGE_EMBED_DPI / 72)
    if content.width > canvas_w or content.height > canvas_h:
        raise ValueError(f"配置する内容がページに収まりません: {content.size} > {(canvas_w, canvas_h)}")
    canvas = Image.new("RGB", (canvas_w, canvas_h), (255, 255, 255))
    canvas.paste(content, (0, 0))
    canvas.save(out_path, "PDF", resolution=float(LARGE_EMBED_DPI), quality=JPEG_QUALITY)
    return content.size


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

        (out / f"{fixture_id}__pdf-control.pdf").write_bytes(pdf_path.read_bytes())
        for variant, k in LARGE_PDF_SCALES.items():
            size = make_large_page_pdf(pdf_path, out / f"{fixture_id}__{variant}.pdf", k)
            print(fixture_id, variant, f"k={k}", "content-px", size)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: render_golden_images.py <golden_dir> <out_dir>")
    main(sys.argv[1], sys.argv[2])
