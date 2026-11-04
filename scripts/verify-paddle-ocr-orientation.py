#!/usr/bin/env python3
"""ADR-0031: PaddleOCRのページ向き補正の再確認スクリプト(ローカル専用、CI非対象、実データ不使用)。

架空の「サービス提供実績記録表」(A4横)を、0度・90度(2方向)・180度に回したPDF(および、ディザ2値化・
ノイズ・傾きでFAX品質に劣化させたもの)にし、本番設定(補正なし)と補正ありで読み、重要語13個のうち
読めた数を比べる。さらにgolden 6ページ(scripts/fixtures/paddle-ocr-golden)の補正なし/ありのOCRテキストが
完全一致することを確認する。PaddleOCR/モデルを更新するとき、ADR-0031の「再確認の手順」として実行する。

事前準備(generate-paddle-ocr-golden-text.pyと同じ):
    uv venv --python 3.12 .venv-paddle
    source .venv-paddle/bin/activate
    uv pip install paddleocr==3.7.0 paddlepaddle==3.2.2 pypdfium2==4.30.0
    # ~/.paddlex/official_models/ に PP-OCRv6_medium_det / _rec / PP-LCNet_x1_0_doc_ori が必要
    # (向き分類は services/paddle-ocr/expected-model-hashes.json のrevisionで取得したものを配置)

実行:
    source .venv-paddle/bin/activate
    python3 scripts/verify-paddle-ocr-orientation.py [--font /path/to/japanese.ttf] [--skip-golden]

終了コード: 補正ありで全ケースが13/13、かつgolden全ページが一致なら0、それ以外は1。
"""

from __future__ import annotations

import argparse
import random
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "services" / "paddle-ocr"))

MODEL_ROOT = Path.home() / ".paddlex" / "official_models"
GOLDEN_DIR = REPO_ROOT / "scripts" / "fixtures" / "paddle-ocr-golden"
KEYS = [
    "サービス提供実績記録表", "かさい内科クリニック", "山田", "太郎", "0123456789", "居宅療養管理指導",
    "あおぞら", "佐藤", "花子", "令和8年10月", "利用者名", "事業所名", "備考",
]
DEFAULT_FONTS = [
    "/Users/yyyhhh/Library/Fonts/UDEVGothicLG-Regular.ttf",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]
DIRECTIONS = {"r000": 0, "r090cw": -90, "r090ccw": 90, "r180": 180}  # PILのrotateは反時計回り


def draw_base(font_path: str):
    from PIL import Image, ImageDraw, ImageFont

    w, h = 2339, 1654  # A4横 200dpi
    img = Image.new("L", (w, h), 255)
    d = ImageDraw.Draw(img)

    def f(sz):
        return ImageFont.truetype(font_path, sz)

    rnd = random.Random(1)
    d.text((80, 50), "サービス提供実績記録表", font=f(64), fill=0)
    d.text((80, 150), "令和8年10月分   事業所名: かさい内科クリニック", font=f(44), fill=0)
    d.text((80, 220), "利用者名: 山田 太郎 様    被保険者番号: 0123456789", font=f(44), fill=0)
    cols, x0, y0, cw, rh = 31, 330, 320, 64, 90
    labels = ["訪問介護", "通所介護", "短期入所", "福祉用具", "居宅療養管理指導", "合計"]
    for r, lab in enumerate(labels + [""]):
        y = y0 + r * rh
        d.rectangle([80, y, x0 + cols * cw, y + rh], outline=0, width=2)
        d.text((90, y + 22), lab[:8], font=f(30), fill=0)
    for c in range(cols + 1):
        x = x0 + c * cw
        d.line([x, y0, x, y0 + 7 * rh], fill=0, width=2)
        if c < cols:
            d.text((x + 14, y0 + 7 * rh + 10), str(c + 1), font=f(28), fill=0)
    for r in range(len(labels)):
        for c in range(cols):
            if rnd.random() < 0.35:
                d.text((x0 + c * cw + 20, y0 + r * rh + 24), str(rnd.choice([1, 1, 2, 4])), font=f(34), fill=0)
    d.text((80, 1250), "備考: 居宅介護支援事業所 あおぞら   担当ケアマネジャー: 佐藤 花子", font=f(40), fill=0)
    return img.convert("RGB")


def degrade_fax(base, width: int, noise: float, skew: float):
    from PIL import Image

    rnd = random.Random(7)
    h = round(base.height * width / base.width)
    im = base.convert("L").resize((width, h), Image.Resampling.BILINEAR).rotate(skew, expand=True, fillcolor=255)
    im = im.convert("1")
    px = im.load()
    for _ in range(int(im.width * im.height * noise)):
        px[rnd.randrange(im.width), rnd.randrange(im.height)] = rnd.choice([0, 255])
    return im.convert("RGB")


def build_cases(font_path: str, out: Path) -> list[Path]:
    base = draw_base(font_path)
    cases: list[Path] = []
    variants = {"clean": (base, 200)}
    variants["fxA"] = (degrade_fax(base, 1728, 0.004, 1.2), 204)
    variants["fxB"] = (degrade_fax(base, 1200, 0.010, -2.0), 204)
    for vname, (im, dpi) in variants.items():
        for dname, ang in DIRECTIONS.items():
            rotated = im.rotate(ang, expand=True) if ang else im
            path = out / f"{vname}_{dname}.pdf"
            rotated.save(path, resolution=dpi)
            cases.append(path)
    return cases


def make_engine(orientation: bool):
    from paddleocr import PaddleOCR

    kw = dict(
        text_detection_model_name="PP-OCRv6_medium_det",
        text_detection_model_dir=str(MODEL_ROOT / "PP-OCRv6_medium_det"),
        text_recognition_model_name="PP-OCRv6_medium_rec",
        text_recognition_model_dir=str(MODEL_ROOT / "PP-OCRv6_medium_rec"),
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=True,
        cpu_threads=4,
    )
    if orientation:
        kw.update(
            doc_orientation_classify_model_name="PP-LCNet_x1_0_doc_ori",
            doc_orientation_classify_model_dir=str(MODEL_ROOT / "PP-LCNet_x1_0_doc_ori"),
            use_doc_orientation_classify=True,
        )
    else:
        kw.update(use_doc_orientation_classify=False)
    return PaddleOCR(**kw)


def ocr_pages(engine, pdf: Path) -> list[str]:
    from raster import RasterLimits, pdf_pages_to_rgb

    limits = RasterLimits(max_pages=8, max_pixels=40_000_000, pdf_max_long_side=2500)
    return ["\n".join(engine.predict(a)[0]["rec_texts"]) for a in pdf_pages_to_rgb(pdf.read_bytes(), dpi=200, limits=limits)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--font")
    ap.add_argument("--skip-golden", action="store_true")
    args = ap.parse_args()
    font = args.font or next((p for p in DEFAULT_FONTS if Path(p).exists()), None)
    if not font:
        print("ERROR: 日本語フォントが見つかりません。--font で指定してください", file=sys.stderr)
        return 2

    prod, new = make_engine(False), make_engine(True)
    ok = True
    with tempfile.TemporaryDirectory() as tmp:
        print("== 合成帳票(架空データ): 重要語13個のうち読めた数 ==")
        for pdf in build_cases(font, Path(tmp)):
            before = sum(k in ocr_pages(prod, pdf)[0] for k in KEYS)
            after = sum(k in ocr_pages(new, pdf)[0] for k in KEYS)
            ok &= after == len(KEYS)
            print(f"{pdf.stem:16s} 補正なし {before:2d}/13  補正あり {after:2d}/13")

    if not args.skip_golden:
        print("== golden(正常な向き): 補正なしと補正ありのOCRテキストが一致するか ==")
        same = diff = 0
        for pdf in sorted(GOLDEN_DIR.glob("*.pdf")):
            for i, (x, y) in enumerate(zip(ocr_pages(prod, pdf), ocr_pages(new, pdf)), 1):
                same += x == y
                diff += x != y
                print(f"{pdf.name} p{i}: {'同一' if x == y else '差異'}")
        ok &= diff == 0
        print(f"golden合計: 同一{same} 差異{diff}")

    print("RESULT:", "OK" if ok else "NG")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
