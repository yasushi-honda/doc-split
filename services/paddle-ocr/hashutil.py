"""ADR-0025 PR4a: SHA-256計算の共有ヘルパー。

paddleocr/paddlepaddleに依存しない純粋関数のため、download_models.py(ビルド時専用、
モデル取得)とocr_engine.py(実行時専用、固定パスからのロード)の両方から利用する。
この2ファイルの分離はPaddleXのmodel_dir制約(取得と実行時ロードを同じ関数で行えない)に
起因するものであり、依存を持たないハッシュ計算という副作用のないロジックの共有は
その制約と無関係(code-review指摘反映)。
"""

from __future__ import annotations

import hashlib
from pathlib import Path


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()
