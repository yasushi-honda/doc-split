#!/usr/bin/env python3
"""ADR-0025 PR4c Phase 2: GPU実測スパイク用の使い捨て計測スクリプト(実験専用、mainへ非マージ)。

使い捨てCompute Engine VM上で、CPU/GPU両方のPaddleOCR推論を同一プロセス構成(同一モデル・
同一golden fixture)で計測し、レイテンシとgolden一致を記録する。

ラスタライズ・比較ロジックはscripts/generate-paddle-ocr-golden-text.pyと、エンジン構築引数は
services/paddle-ocr/ocr_engine.pyと可能な限り一致させる(device/cpu_threadsのみ実験変数)。

実行例:
    python3 measure.py --device cpu --cpu-threads 4 --warmup 1 --out cpu-result.json
    python3 measure.py --device gpu --warmup 1 --out gpu-result.json
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
MODEL_ROOT = Path.home() / "paddle-ocr-models"
DET_MODEL_NAME = "PP-OCRv6_medium_det"
REC_MODEL_NAME = "PP-OCRv6_medium_rec"
RENDER_DPI = 200

# scripts/generate-paddle-ocr-golden-text.pyのFIXTURESと同一
FIXTURES: list[tuple[str, list[str]]] = [
    ("golden-plain-01", ["golden_plain_01.pdf"]),
    ("golden-plain-02", ["golden_plain_02.pdf"]),
    ("golden-oldkanji-01", ["golden_oldkanji_01.pdf"]),
    ("golden-oldkanji-02", ["golden_oldkanji_02.pdf"]),
    ("golden-multipage-01", ["golden_multipage_01-p1.pdf", "golden_multipage_01-p2.pdf"]),
]


def render_pdf_page_to_rgb_array(pdf_path: Path):
    import numpy as np
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(pdf_path))
    page = pdf[0]
    bitmap = page.render(scale=RENDER_DPI / 72)
    return np.array(bitmap.to_pil().convert("RGB"))


def build_engine(device: str, cpu_threads: int | None):
    from paddleocr import PaddleOCR

    kwargs = dict(
        text_detection_model_name=DET_MODEL_NAME,
        text_detection_model_dir=str(MODEL_ROOT / DET_MODEL_NAME),
        text_recognition_model_name=REC_MODEL_NAME,
        text_recognition_model_dir=str(MODEL_ROOT / REC_MODEL_NAME),
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=False,
        device=device,
    )
    if device == "cpu" and cpu_threads:
        kwargs["cpu_threads"] = cpu_threads
    return PaddleOCR(**kwargs)


def run_pass(engine, label: str) -> list[dict]:
    results = []
    for fixture_id, files in FIXTURES:
        expected = json.loads((FIXTURE_DIR / f"{fixture_id}.pages.json").read_text(encoding="utf-8"))
        for i, fname in enumerate(files):
            img = render_pdf_page_to_rgb_array(FIXTURE_DIR / fname)
            t0 = time.monotonic()
            result = engine.predict(img)
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            text = "\n".join(result[0]["rec_texts"])
            match = text == expected[i]
            entry = {
                "label": label,
                "fixture": fixture_id,
                "file": fname,
                "elapsedMs": elapsed_ms,
                "match": match,
                "actualText": text,
                "expectedText": expected[i],
            }
            results.append(entry)
            print(f"[{label}] {fname}: {elapsed_ms}ms match={match}", flush=True)
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", choices=["cpu", "gpu"], required=True)
    parser.add_argument("--cpu-threads", type=int, default=None)
    parser.add_argument("--warmup", type=int, default=1)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    engine = build_engine(args.device, args.cpu_threads)

    warmup_results = []
    for i in range(args.warmup):
        warmup_results.extend(run_pass(engine, label=f"{args.device}-warmup-{i}"))

    main_results = run_pass(engine, label=args.device)

    out = {
        "device": args.device,
        "cpuThreads": args.cpu_threads,
        "warmup": warmup_results,
        "main": main_results,
    }
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
