#!/usr/bin/env python3
"""ADR-0025 PR4前提: PaddleOCR golden text生成スクリプト(ローカル専用、CI非対象)。

scripts/fixtures/paddleOcrGoldenFixtures.ts が生成したLayer A fixture(分割済み単一ページ
PDF)に対して、実際にPaddleOCR(PP-OCRv6 medium)を1回実行し、その生テキストを
scripts/fixtures/paddle-ocr-golden/<id>.expected.txt(本番と同じ`--- Page N ---`ヘッダ付き
結合フォーマット)・<id>.pages.json(ページ別生テキスト、firstPageText再構築用)・
manifest.json(モデル・実行環境の来歴)として記録する。

functions/test/paddleOcrArbitrationRegression.test.ts (CI対象) はこれらの記録済み
ファイルを読むだけで、PaddleOCR/Pythonには一切依存しない。

事前準備:
    uv venv --python 3.12 .venv-paddle
    source .venv-paddle/bin/activate
    uv pip install paddleocr==3.7.0 paddlepaddle==3.3.1 pypdfium2==4.30.0

実行:
    source .venv-paddle/bin/activate
    python3 scripts/generate-paddle-ocr-golden-text.py

前提: `~/.paddlex/official_models/PP-OCRv6_medium_det` / `_rec` にモデル重みが
キャッシュ済みであること(初回のみ、PaddleOCR(lang="japan")を一度実行してダウンロード)。
`text_detection_model_dir`/`text_recognition_model_dir`で明示的にこのディレクトリを
指定することで、暗黙のキャッシュ依存(将来別バージョンのモデルが同じキャッシュパスに
上書きされて気づかず差し替わるリスク)を避け、実際に使用した重みファイルのSHA-256を
manifestに記録することで来歴を担保する(~/.claude/plans/fuzzy-moseying-book.md v5参照)。
"""

from __future__ import annotations

import hashlib
import json
import platform
import subprocess
import sys
from datetime import datetime, timezone
from importlib.metadata import version as pkg_version
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = REPO_ROOT / "scripts" / "fixtures" / "paddle-ocr-golden"
RENDER_DPI = 200

DET_MODEL_NAME = "PP-OCRv6_medium_det"
REC_MODEL_NAME = "PP-OCRv6_medium_rec"
DET_MODEL_DIR = Path.home() / ".paddlex" / "official_models" / DET_MODEL_NAME
REC_MODEL_DIR = Path.home() / ".paddlex" / "official_models" / REC_MODEL_NAME

# scripts/fixtures/paddleOcrGoldenFixtures.ts の GOLDEN_FIXTURES と対応する
# (id, 分割済み単一ページPDFファイル名の配列)。1ページ文書は要素数1。
FIXTURES: list[tuple[str, list[str]]] = [
    ("golden-plain-01", ["golden_plain_01.pdf"]),
    ("golden-plain-02", ["golden_plain_02.pdf"]),
    ("golden-oldkanji-01", ["golden_oldkanji_01.pdf"]),
    ("golden-oldkanji-02", ["golden_oldkanji_02.pdf"]),
    ("golden-multipage-01", ["golden_multipage_01-p1.pdf", "golden_multipage_01-p2.pdf"]),
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def sha256_dir_files(dir_path: Path) -> dict:
    return {p.name: sha256_file(p) for p in sorted(dir_path.iterdir()) if p.is_file()}


def git_commit_hash() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, stderr=subprocess.PIPE
        ).decode().strip()
    except (subprocess.CalledProcessError, FileNotFoundError, OSError) as e:
        print(f"WARNING: git commit hash取得失敗、manifest.jsonには'unknown'を記録します: {e}", file=sys.stderr)
        return "unknown"


def render_pdf_page_to_rgb_array(pdf_path: Path):
    import numpy as np
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(pdf_path))
    if len(pdf) != 1:
        sys.exit(
            f"ERROR: {pdf_path} は分割済み単一ページPDFである必要があります"
            f"(実際: {len(pdf)}ページ)。scripts/fixtures/paddleOcrGoldenFixtures.tsの"
            "--generate-pdfsで生成し直してください。"
        )
    page = pdf[0]
    bitmap = page.render(scale=RENDER_DPI / 72)
    pil_image = bitmap.to_pil()
    return np.array(pil_image.convert("RGB"))


def build_ocr_engine():
    from paddleocr import PaddleOCR

    if not DET_MODEL_DIR.exists() or not REC_MODEL_DIR.exists():
        sys.exit(
            f"ERROR: モデルディレクトリが見つかりません: {DET_MODEL_DIR} / {REC_MODEL_DIR}\n"
            "初回はPaddleOCR(lang='japan')を一度実行してモデルをダウンロードしてください。"
        )
    # lang指定はtext_detection_model_name/text_recognition_model_name指定時は無視される
    # (実行時にUserWarningで確認済み)ため渡さない。モデルは名前+ディレクトリで完全に固定する。
    #
    # enable_mkldnn=False(ADR-0025 PR4a実機検証で追加): linux/amd64コンテナ(Cloud Run想定
    # 環境)でmkldnn実行パスが例外終了する不具合を確認したため無効化した(services/paddle-ocr/
    # ocr_engine.py参照)。arm64(Mac)ではmkldnnが元々使われないため本スクリプトの出力(golden
    # text)には影響しないが、services/paddle-ocr/ocr_engine.pyとの「一字一句一致」を保つため
    # 本スクリプトにも反映する。
    return PaddleOCR(
        text_detection_model_name=DET_MODEL_NAME,
        text_detection_model_dir=str(DET_MODEL_DIR),
        text_recognition_model_name=REC_MODEL_NAME,
        text_recognition_model_dir=str(REC_MODEL_DIR),
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=False,
    )


def ocr_single_page_pdf(engine, pdf_path: Path) -> str:
    img_array = render_pdf_page_to_rgb_array(pdf_path)
    try:
        result = engine.predict(img_array)
        return "\n".join(result[0]["rec_texts"])
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"PaddleOCR実行結果の形状が想定外です: {pdf_path} ({e})") from e


def join_pages_like_production(page_texts: list[str]) -> str:
    """functions/src/ocr/ocrProcessor.ts:356と同一フォーマット
    (`--- Page N ---\\n<text>`をpageごとに付けてから`\\n\\n`結合)。"""
    return "\n\n".join(f"--- Page {i + 1} ---\n{text}" for i, text in enumerate(page_texts))


def main() -> None:
    if not FIXTURE_DIR.exists():
        sys.exit(
            f"ERROR: {FIXTURE_DIR} が存在しません。先に "
            "`npx ts-node scripts/fixtures/paddleOcrGoldenFixtures.ts --generate-pdfs` "
            "を実行してください。"
        )

    engine = build_ocr_engine()

    # 実行ゲート: 最初のfixtureの最初のページでsmoke testを行い、失敗したら即座に中断する
    # (~/.claude/plans/fuzzy-moseying-book.md v5「実行ゲート」参照)。
    smoke_id, smoke_files = FIXTURES[0]
    smoke_text = ocr_single_page_pdf(engine, FIXTURE_DIR / smoke_files[0])
    if not smoke_text.strip():
        sys.exit(f"ERROR: smoke test失敗、{smoke_files[0]}からテキストが得られませんでした")
    print(f"✓ smoke test成功: {smoke_files[0]} → {len(smoke_text)}文字")

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "generatorGitCommit": git_commit_hash(),
        "renderDpi": RENDER_DPI,
        "engine": "paddleocr",
        "textDetectionModelName": DET_MODEL_NAME,
        "textRecognitionModelName": REC_MODEL_NAME,
        "textDetectionModelDir": str(DET_MODEL_DIR),
        "textRecognitionModelDir": str(REC_MODEL_DIR),
        "textDetectionModelFileHashes": sha256_dir_files(DET_MODEL_DIR),
        "textRecognitionModelFileHashes": sha256_dir_files(REC_MODEL_DIR),
        "paddleocrVersion": pkg_version("paddleocr"),
        "paddlepaddleVersion": pkg_version("paddlepaddle"),
        "pypdfium2Version": pkg_version("pypdfium2"),
        "pythonVersion": sys.version,
        "platform": platform.platform(),
        "fixtures": {},
    }

    for fixture_id, files in FIXTURES:
        page_texts = [ocr_single_page_pdf(engine, FIXTURE_DIR / fname) for fname in files]
        joined = join_pages_like_production(page_texts)

        (FIXTURE_DIR / f"{fixture_id}.pages.json").write_text(
            json.dumps(page_texts, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (FIXTURE_DIR / f"{fixture_id}.expected.txt").write_text(joined, encoding="utf-8")

        manifest["fixtures"][fixture_id] = {
            "sourcePdfSha256": {fname: sha256_file(FIXTURE_DIR / fname) for fname in files},
            "pageCount": len(page_texts),
        }
        print(f"✓ {fixture_id}: {len(page_texts)}ページ処理完了")

    (FIXTURE_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"✓ manifest.json 出力完了: {FIXTURE_DIR / 'manifest.json'}")


if __name__ == "__main__":
    main()
