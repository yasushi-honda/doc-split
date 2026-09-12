"""ADR-0025 PR4a: ocr_engine.py の起動時モデル整合性検証(_verify_model_hashes)のテスト。

paddleocr/paddlepaddleを一切importせずに検証可能(hashlib/pathlibのみに依存する純粋関数)。
pr-test-analyzer/silent-failure-hunter指摘反映: このfail-loud検証ロジック自体が
無テストだった(「起動時検証が本当に例外を送出して起動を止めるか」がコードリーディング
でしか確認できていなかった)ため新規追加する。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from hashutil import sha256_file
from ocr_engine import _verify_model_hashes


def _write_dummy_model(root: Path, dirname: str, content: bytes) -> str:
    model_dir = root / dirname
    model_dir.mkdir(parents=True, exist_ok=True)
    fpath = model_dir / "inference.pdiparams"
    fpath.write_bytes(content)
    return sha256_file(fpath)


def _expected_spec(hash_value: str) -> dict:
    return {
        "textDetection": {"fileHashes": {"inference.pdiparams": hash_value}},
        "textRecognition": {"fileHashes": {"inference.pdiparams": hash_value}},
    }


def test_verify_model_hashes_succeeds_when_hashes_match(tmp_path: Path):
    hash_value = _write_dummy_model(tmp_path, "PP-OCRv6_medium_det", b"det-weights")
    _write_dummy_model(tmp_path, "PP-OCRv6_medium_rec", b"det-weights")
    expected = _expected_spec(hash_value)

    _verify_model_hashes(tmp_path, expected)  # 例外が出ないこと


def test_verify_model_hashes_raises_when_file_missing(tmp_path: Path):
    hash_value = _write_dummy_model(tmp_path, "PP-OCRv6_medium_det", b"det-weights")
    # textRecognitionのモデルディレクトリを作らない(ファイル欠落を再現)
    expected = _expected_spec(hash_value)

    with pytest.raises(RuntimeError, match="モデルファイルが見つかりません"):
        _verify_model_hashes(tmp_path, expected)


def test_verify_model_hashes_raises_when_hash_mismatch(tmp_path: Path):
    hash_value = _write_dummy_model(tmp_path, "PP-OCRv6_medium_det", b"det-weights")
    _write_dummy_model(tmp_path, "PP-OCRv6_medium_rec", b"DIFFERENT-CONTENT")  # 実ハッシュを変える
    expected = _expected_spec(hash_value)

    with pytest.raises(RuntimeError, match="SHA-256が不一致"):
        _verify_model_hashes(tmp_path, expected)
