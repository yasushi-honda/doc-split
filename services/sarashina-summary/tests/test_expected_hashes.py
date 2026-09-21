"""ADR-0027 PR1a: expected-model-hashes.jsonの形式検証。

本サービスはPaddleOCRと異なり実行時Pythonコードを持たない(Dockerfileのcurl+jqで
モデル取得・検証が完結する)ため、このテストがビルド前に検証できる唯一の
Sarashina固有ロジックになる。CIでの早期検知が目的。

fixture(scripts/fixtures/sarashina-summary-golden/)とのgolden突合はPR2のスコープ。
"""

import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
EXPECTED_HASHES_PATH = os.path.join(HERE, "..", "expected-model-hashes.json")
README_PATH = os.path.join(HERE, "..", "README.md")

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


def load_expected_hashes():
    with open(EXPECTED_HASHES_PATH, encoding="utf-8") as f:
        return json.load(f)


def test_text_generation_fields_present_and_well_formed():
    data = load_expected_hashes()
    tg = data["textGeneration"]
    assert tg["hfRepoId"] == "mmnga/sarashina2.2-3b-instruct-v0.1-gguf"
    assert tg["fileName"] == "sarashina2.2-3b-instruct-v0.1-Q8_0.gguf"
    # hfRevisionはHugging FaceのフルコミットSHA(40桁16進数)
    assert re.match(r"^[0-9a-f]{40}$", tg["hfRevision"]), tg["hfRevision"]
    assert SHA256_RE.match(tg["sha256"]), tg["sha256"]
    assert isinstance(tg["sizeBytes"], int) and tg["sizeBytes"] > 0


def test_base_image_fields_present_and_well_formed():
    data = load_expected_hashes()
    bi = data["baseImage"]
    assert bi["repository"] == "ghcr.io/ggml-org/llama.cpp"
    assert DIGEST_RE.match(bi["digest"]), bi["digest"]
    # buildInfoはPR0実測(b11065-ce8caa6e6)とタグ(server-b11065)の対応を保つ
    assert bi["tag"].startswith("server-")
    assert bi["buildInfo"].split("-")[0] in bi["tag"]


def test_dockerfile_references_same_digest():
    """Dockerfile FROM行のdigestとexpected-model-hashes.jsonのdigestが一致することを
    ドリフトガードする(どちらか一方だけ更新して不整合になる事故を防ぐ)。"""
    data = load_expected_hashes()
    expected_digest = data["baseImage"]["digest"]
    dockerfile_path = os.path.join(HERE, "..", "Dockerfile")
    with open(dockerfile_path, encoding="utf-8") as f:
        dockerfile = f.read()
    assert expected_digest in dockerfile, (
        f"Dockerfileに{expected_digest}が見つかりません。"
        "expected-model-hashes.jsonのbaseImage.digestとDockerfileのFROM行を同時更新してください。"
    )


def test_readme_documents_same_model_hash():
    """README.mdに記載されたSHA-256がexpected-model-hashes.jsonと一致することを確認する
    (README.mdは人間が読む一次情報のため、乖離すると誤った値を運用者が信じるリスクがある)。"""
    data = load_expected_hashes()
    expected_sha256 = data["textGeneration"]["sha256"]
    with open(README_PATH, encoding="utf-8") as f:
        readme = f.read()
    assert expected_sha256 in readme, (
        f"README.mdに{expected_sha256}が見つかりません。"
        "expected-model-hashes.jsonとREADME.mdの記載値を同時更新してください。"
    )
