"""ADR-0025 PR4a: ocr_engine.py の起動時モデル整合性検証(_verify_model_hashes)のテスト。

paddleocr/paddlepaddleを一切importせずに検証可能(hashlib/pathlibのみに依存する純粋関数)。
pr-test-analyzer/silent-failure-hunter指摘反映: このfail-loud検証ロジック自体が
無テストだった(「起動時検証が本当に例外を送出して起動を止めるか」がコードリーディング
でしか確認できていなかった)ため新規追加する。
"""

from __future__ import annotations

import json
import re
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
    """expected-model-hashes.json・ビルド時取得・起動時検証の3者のモデル種別とディレクトリ名が食い違わないこと。

    1つだけ追加し忘れると、ビルドは通るのに起動時検証で落ちる(または検証されないまま使われる)。
    """
    expected_path = Path(__file__).resolve().parent.parent / "expected-model-hashes.json"
    expected = json.loads(expected_path.read_text(encoding="utf-8"))
    kinds_in_json = {k for k in expected if not k.startswith("_")}

    assert kinds_in_json == set(download_models.MODEL_KINDS)
    # 起動時検証の対象(kind -> ディレクトリ名)が、ビルド時取得の配置先と完全に同じであること
    assert ocr_engine.MODEL_DIRS == download_models.MODEL_KINDS
    assert set(ocr_engine.MODEL_DIRS.values()) == {
        ocr_engine.DET_MODEL_NAME,
        ocr_engine.REC_MODEL_NAME,
        ocr_engine.DOC_ORI_MODEL_NAME,
    }
    for kind in kinds_in_json:
        spec = expected[kind]
        assert re.fullmatch(r"[0-9a-f]{40}", spec["hfRevision"])
        assert set(spec["fileHashes"]) == set(download_models.REQUIRED_FILES)
        assert all(re.fullmatch(r"[0-9a-f]{64}", h) for h in spec["fileHashes"].values())


@pytest.mark.parametrize("kind", list(ocr_engine.MODEL_DIRS))
def test_verify_model_hashes_detects_corruption_of_every_model_kind(tmp_path: Path, kind: str):
    """全モデル種別について、1つ壊すと起動時検証が失敗すること(検証対象の取りこぼし防止)。

    モデルごとに別の内容・別のハッシュにして、モデル間の取り違え(detの期待値でrecを検証する等)も検出する。
    """
    expected: dict = {}
    for k, dirname in ocr_engine.MODEL_DIRS.items():
        expected[k] = {"fileHashes": {"inference.pdiparams": _write_dummy_model(tmp_path, dirname, k.encode())}}
    _verify_model_hashes(tmp_path, expected)  # 壊す前は通る

    (tmp_path / ocr_engine.MODEL_DIRS[kind] / "inference.pdiparams").write_bytes(b"corrupted")
    with pytest.raises(RuntimeError, match=ocr_engine.MODEL_DIRS[kind]):
        _verify_model_hashes(tmp_path, expected)


def _fake_result(angle):
    page = {"rec_texts": ["a", "b"]}
    if angle is not None:
        page["doc_preprocessor_res"] = {"angle": angle}
    return [page]


class _StubEngine:
    def __init__(self, result):
        self._result = result

    def predict(self, _arr):
        return self._result


@pytest.mark.parametrize("angle", [90, 180, 270])
def test_page_texts_logs_applied_orientation_angle(caplog, angle):
    """向き補正で回したページは、運用者が数えられるよう角度つきの警告ログを残す(書類内容は含めない)。"""
    engine = ocr_engine.PaddleOcrEngine(_StubEngine(_fake_result(angle)), "v")
    with caplog.at_level("WARNING", logger="paddle-ocr.engine"):
        assert engine.page_texts(object()) == ["a", "b"]
    assert any("PAGE_ORIENTATION_CORRECTED" in r.message and str(angle) in r.message for r in caplog.records)
    assert not any("a" == r.message for r in caplog.records)


def test_page_texts_does_not_log_when_angle_is_zero(caplog):
    engine = ocr_engine.PaddleOcrEngine(_StubEngine(_fake_result(0)), "v")
    with caplog.at_level("WARNING", logger="paddle-ocr.engine"):
        assert engine.page_texts(object()) == ["a", "b"]
    assert caplog.records == []


def test_page_texts_logs_when_angle_unavailable_but_still_returns_text(caplog):
    """角度を取れなくてもOCRは止めない。ただし黙って欠けないよう、取れなかったことは残す。"""
    engine = ocr_engine.PaddleOcrEngine(_StubEngine(_fake_result(None)), "v")
    with caplog.at_level("WARNING", logger="paddle-ocr.engine"):
        assert engine.page_texts(object()) == ["a", "b"]
    assert any("PAGE_ORIENTATION_ANGLE_UNAVAILABLE" in r.message for r in caplog.records)


def _install_fake_hf(monkeypatch, tmp_path: Path, files_by_repo: dict):
    """huggingface_hub.snapshot_downloadをスタブにする(repo_idごとに用意したディレクトリを返す)。"""
    def snapshot_download(repo_id, revision, allow_patterns):
        d = tmp_path / "hf" / repo_id.replace("/", "__")
        d.mkdir(parents=True, exist_ok=True)
        for fname, content in files_by_repo[repo_id].items():
            (d / fname).write_bytes(content)
        return str(d)

    fake = types.ModuleType("huggingface_hub")
    fake.snapshot_download = snapshot_download
    monkeypatch.setitem(sys.modules, "huggingface_hub", fake)


def _spec_for(contents: dict) -> dict:
    import hashlib

    return {
        "hfRepoId": "PaddlePaddle/x",
        "hfRevision": "0" * 40,
        "fileHashes": {f: hashlib.sha256(c).hexdigest() for f, c in contents.items()},
    }


def test_download_and_verify_places_every_model_kind_including_doc_orientation(tmp_path: Path, monkeypatch):
    """ビルド時の取得経路が全モデル(向き分類を含む)を所定のディレクトリへ配置すること。"""
    contents = {f: f.encode() for f in download_models.REQUIRED_FILES}
    expected = {}
    files_by_repo = {}
    for kind in download_models.MODEL_KINDS:
        spec = _spec_for(contents)
        spec["hfRepoId"] = f"PaddlePaddle/{kind}"
        expected[kind] = spec
        files_by_repo[spec["hfRepoId"]] = contents
    _install_fake_hf(monkeypatch, tmp_path, files_by_repo)

    dest = tmp_path / "models"
    download_models.download_and_verify(dest, expected)

    for dirname in download_models.MODEL_KINDS.values():
        for fname in download_models.REQUIRED_FILES:
            assert (dest / dirname / fname).read_bytes() == contents[fname]
    assert (dest / "PP-LCNet_x1_0_doc_ori" / "inference.pdiparams").exists()


def test_download_and_verify_fails_without_placing_files_when_doc_orientation_hash_mismatches(tmp_path: Path, monkeypatch):
    contents = {f: f.encode() for f in download_models.REQUIRED_FILES}
    expected = {}
    files_by_repo = {}
    for kind in download_models.MODEL_KINDS:
        spec = _spec_for(contents)
        spec["hfRepoId"] = f"PaddlePaddle/{kind}"
        expected[kind] = spec
        files_by_repo[spec["hfRepoId"]] = dict(contents)
    files_by_repo["PaddlePaddle/docOrientation"]["inference.pdiparams"] = b"tampered"
    _install_fake_hf(monkeypatch, tmp_path, files_by_repo)

    dest = tmp_path / "models"
    with pytest.raises(SystemExit):
        download_models.download_and_verify(dest, expected)
    assert not (dest / "PP-LCNet_x1_0_doc_ori").exists()
