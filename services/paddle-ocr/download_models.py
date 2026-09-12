#!/usr/bin/env python3
"""ADR-0025 PR4a: モデル取得スクリプト(ビルド時専用)。

expected-model-hashes.json に固定されたHugging Faceリポジトリのimmutable revisionから
PP-OCRv6 medium det/recモデルを取得し、SHA-256を検証したうえで、実行時に読み込む固定パス
(dest配下)へ配置する。

設計上の要点(v2、codex review pass2指摘反映):
- PaddleOCR/PaddleXのモデルロード機構(PaddleOCR(...)コンストラクタ)を一切経由しない。
  PaddleXの `_resolve_model_dir()` は model_dir 指定時にディレクトリの存在確認のみを行い、
  存在しなければ FileNotFoundError を送出してダウンロードしない仕様のため、取得ロジックを
  ocr_engine.py 側の実行時ロードと同じ関数で行うことはできない(v1の設計バグ)。
- 取得は huggingface_hub.snapshot_download(repo_id, revision=<pinned>) で行う。これは
  PaddleXのモデルホスター判定を経由しない独立した経路であり、上記の制約と衝突しない。
- 取得したファイルのSHA-256を expected-model-hashes.json の fileHashes と突合し、
  重み本体3ファイル(inference.json/inference.pdiparams/inference.yml)が不一致なら
  即座にビルド失敗させる(fail-loud)。

実行:
    python3 download_models.py --dest /opt/paddle-ocr/models --expected expected-model-hashes.json
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from hashutil import sha256_file

# 重み本体として厳格に検証する必須ファイル。README.md/.gitattributes等の付随ファイルは
# 上流のドキュメント更新で変わりうり同一性とは無関係なため、検証対象に含めない。
REQUIRED_FILES = ("inference.json", "inference.pdiparams", "inference.yml")

MODEL_KINDS = {
    "textDetection": "PP-OCRv6_medium_det",
    "textRecognition": "PP-OCRv6_medium_rec",
}


def download_and_verify(dest: Path, expected: dict) -> None:
    from huggingface_hub import snapshot_download

    dest.mkdir(parents=True, exist_ok=True)

    for kind, dirname in MODEL_KINDS.items():
        spec = expected[kind]
        repo_id = spec["hfRepoId"]
        revision = spec["hfRevision"]

        print(f"=== {kind} ({repo_id} @ {revision}) ===")
        local_dir = Path(
            snapshot_download(repo_id=repo_id, revision=revision, allow_patterns=["*.json", "*.pdiparams", "*.yml"])
        )

        # silent-failure-hunter指摘反映: 全ファイルのハッシュを検証してから配置する
        # (検証前にコピーすると、"fail-loud"という設計意図に反して不一致ファイルが
        # 一部でも配置されてしまう余地が残るため)。
        mismatches: list[str] = []
        verified: list[tuple[Path, Path]] = []
        for fname in REQUIRED_FILES:
            src = local_dir / fname
            if not src.exists():
                sys.exit(f"ERROR: {repo_id}@{revision} に {fname} が見つかりません")
            actual_hash = sha256_file(src)
            expected_hash = spec["fileHashes"][fname]
            status = "OK" if actual_hash == expected_hash else "MISMATCH"
            print(f"  {fname}: {actual_hash} [{status}]")
            if actual_hash != expected_hash:
                mismatches.append(f"{fname} (expected={expected_hash}, actual={actual_hash})")
            else:
                verified.append((src, fname))

        if mismatches:
            sys.exit(
                f"ERROR: {kind} のモデルファイルハッシュが expected-model-hashes.json と不一致です:\n"
                + "\n".join(f"  - {m}" for m in mismatches)
                + "\n\n上流のcommitが変わった可能性があります。"
                "scripts/generate-paddle-ocr-golden-text.py をローカルで再実行して"
                "94/96相当の精度を再検証したうえで、scripts/fixtures/paddle-ocr-golden/manifest.json と"
                "services/paddle-ocr/expected-model-hashes.json を同時更新してください。"
                "無検証での上書きは禁止です。"
            )

        target_dir = dest / dirname
        target_dir.mkdir(parents=True, exist_ok=True)
        for src, fname in verified:
            shutil.copy2(src, target_dir / fname)

    print(f"✓ 全モデルファイルのハッシュ検証に成功しました: {dest}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dest", required=True, type=Path)
    parser.add_argument("--expected", required=True, type=Path)
    args = parser.parse_args()

    expected = json.loads(args.expected.read_text(encoding="utf-8"))
    download_and_verify(args.dest, expected)


if __name__ == "__main__":
    main()
