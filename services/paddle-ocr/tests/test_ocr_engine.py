"""ADR-0025 PR4a: ocr_engine.py の起動時モデル整合性検証(_verify_model_hashes)のテスト。

paddleocr/paddlepaddleを一切importせずに検証可能(hashlib/pathlibのみに依存する純粋関数)。
pr-test-analyzer/silent-failure-hunter指摘反映: このfail-loud検証ロジック自体が
無テストだった(「起動時検証が本当に例外を送出して起動を止めるか」がコードリーディング
でしか確認できていなかった)ため新規追加する。
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

import download_models
import ocr_engine
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
        "docOrientation": {"fileHashes": {"inference.pdiparams": hash_value}},
    }


def _write_all_dummy_models(root: Path, content: bytes = b"weights") -> str:
    h = ""
    for dirname in ("PP-OCRv6_medium_det", "PP-OCRv6_medium_rec", "PP-LCNet_x1_0_doc_ori"):
        h = _write_dummy_model(root, dirname, content)
    return h


def test_verify_model_hashes_succeeds_when_hashes_match(tmp_path: Path):
    hash_value = _write_all_dummy_models(tmp_path, b"det-weights")
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


def test_verify_model_hashes_raises_when_doc_orientation_model_missing(tmp_path: Path):
    """向き分類モデルだけ欠けた場合も起動を止める(欠けたまま起動すると横向き帳票が黙って読めなくなる)。"""
    hash_value = _write_dummy_model(tmp_path, "PP-OCRv6_medium_det", b"w")
    _write_dummy_model(tmp_path, "PP-OCRv6_medium_rec", b"w")
    expected = _expected_spec(hash_value)

    with pytest.raises(RuntimeError, match="PP-LCNet_x1_0_doc_ori"):
        _verify_model_hashes(tmp_path, expected)


def test_verify_model_hashes_raises_when_doc_orientation_hash_mismatch(tmp_path: Path):
    hash_value = _write_dummy_model(tmp_path, "PP-OCRv6_medium_det", b"w")
    _write_dummy_model(tmp_path, "PP-OCRv6_medium_rec", b"w")
    _write_dummy_model(tmp_path, "PP-LCNet_x1_0_doc_ori", b"DIFFERENT")
    expected = _expected_spec(hash_value)

    with pytest.raises(RuntimeError, match="SHA-256が不一致"):
        _verify_model_hashes(tmp_path, expected)


def test_build_engine_enables_doc_orientation_classify(tmp_path: Path, monkeypatch):
    """PaddleOCRへ向き補正を有効にして渡すこと(横向き・上下逆のFAX帳票が「未判定」になる事象の回帰防止)。

    実機の再現: 補正なしだと90度の片方向・180度の帳票が重要語0/13、出力が数字だけになる。
    これが無効に戻ると、本物のPaddleOCRなしのCIでは気付けないため、コンストラクタ引数を直接検証する。
    """
    hash_value = _write_all_dummy_models(tmp_path, b"w")
    captured: dict = {}

    class FakePaddleOCR:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    fake_module = types.ModuleType("paddleocr")
    fake_module.PaddleOCR = FakePaddleOCR
    monkeypatch.setitem(sys.modules, "paddleocr", fake_module)

    hashes = {
        kind: {"fileHashes": {"inference.pdiparams": hash_value}}
        for kind in ("textDetection", "textRecognition", "docOrientation")
    }
    # build_engineはmodel_version表記のためinference.pdiparamsのハッシュを参照する
    ocr_engine.build_engine(tmp_path, hashes)

    assert captured["use_doc_orientation_classify"] is True
    assert captured["doc_orientation_classify_model_name"] == "PP-LCNet_x1_0_doc_ori"
    assert captured["doc_orientation_classify_model_dir"] == str(tmp_path / "PP-LCNet_x1_0_doc_ori")
    # 既存の設定は変えていない(歪み補正・行単位の向き分類は無効のまま)
    assert captured["use_doc_unwarping"] is False
    assert captured["use_textline_orientation"] is False


def test_model_kinds_are_consistent_across_hashes_download_and_runtime():
    """expected-model-hashes.json・ビルド時取得・起動時検証の3者のモデル種別が食い違わないこと。

    1つだけ追加し忘れると、ビルドは通るのに起動時検証で落ちる(または検証されないまま使われる)。
    """
    expected_path = Path(__file__).resolve().parent.parent / "expected-model-hashes.json"
    expected = json.loads(expected_path.read_text(encoding="utf-8"))
    kinds_in_json = {k for k in expected if not k.startswith("_")}

    assert kinds_in_json == set(download_models.MODEL_KINDS)
    assert set(download_models.MODEL_KINDS.values()) == {
        ocr_engine.DET_MODEL_NAME,
        ocr_engine.REC_MODEL_NAME,
        ocr_engine.DOC_ORI_MODEL_NAME,
    }
    for kind in kinds_in_json:
        spec = expected[kind]
        assert spec["hfRepoId"].startswith("PaddlePaddle/")
        assert len(spec["hfRevision"]) == 40
        assert set(spec["fileHashes"]) == set(download_models.REQUIRED_FILES)
        assert all(len(h) == 64 for h in spec["fileHashes"].values())
