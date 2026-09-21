"""ADR-0027 PR1a: expected-model-hashes.jsonの形式検証。

本サービスはPaddleOCRと異なり実行時Pythonコードを持たない(Dockerfileのcurl+jqで
モデル取得・検証が完結する)ため、このテストがビルド前に検証できる唯一の
Sarashina固有ロジックになる。CIでの早期検知が目的。

expected-model-hashes.json / Dockerfile / README.md の3者間で、以下の値を
それぞれ実際にドリフトガードする(pr-review-toolkit pr-test-analyzer指摘反映、
「README.mdが3者間の一致をCIで検証すると主張しているのに実際はdigest/sha256の
2値しかテストされていない」というギャップを解消):
- textGeneration: hfRepoId / hfRevision / fileName / sizeBytes / sha256
- baseImage: digest / tag / buildInfo

fixture(scripts/fixtures/sarashina-summary-golden/)とのgolden突合はPR2のスコープ。
"""

import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
EXPECTED_HASHES_PATH = os.path.join(HERE, "..", "expected-model-hashes.json")
README_PATH = os.path.join(HERE, "..", "README.md")
DOCKERFILE_PATH = os.path.join(HERE, "..", "Dockerfile")

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
# DockerfileのFROM行を特定してdigestを抽出する(単純な部分文字列一致だと、
# コメント中に古いdigestが残存していても誤ってPASSしうるため、pr-review-toolkit
# silent-failure-hunter指摘を反映し行を特定する)。
DOCKERFILE_FROM_DIGEST_RE = re.compile(
    r"^FROM\s+\S+@(sha256:[0-9a-f]{64})", re.MULTILINE
)


def load_expected_hashes():
    with open(EXPECTED_HASHES_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


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


def test_dockerfile_from_line_matches_digest():
    """DockerfileのFROM行(実行ステージ)のdigestがexpected-model-hashes.jsonの
    baseImage.digestと一致することをドリフトガードする。単純な部分文字列一致
    ではなく`FROM ...@sha256:...`形式の行を正規表現で特定して比較する
    (コメント中の残存文字列による偽陽性PASSを防ぐ、silent-failure-hunter指摘)。"""
    data = load_expected_hashes()
    expected_digest = data["baseImage"]["digest"]
    dockerfile = load_text(DOCKERFILE_PATH)
    m = DOCKERFILE_FROM_DIGEST_RE.search(dockerfile)
    assert m, "DockerfileにFROM ...@sha256:...形式の行が見つかりません"
    assert m.group(1) == expected_digest, (
        f"DockerfileのFROM行のdigest({m.group(1)})がexpected-model-hashes.jsonの"
        f"baseImage.digest({expected_digest})と一致しません。"
        "両方を同時更新してください。"
    )


def test_dockerfile_comment_documents_build_info():
    """Dockerfileのコメントが記載するtag/buildInfoがJSON側の値とドリフトしていないか
    検証する(comment-analyzer指摘: digestのみのガードでは41行目付近のtag/buildInfo
    コメントの更新漏れを検知できなかった)。"""
    data = load_expected_hashes()
    bi = data["baseImage"]
    dockerfile = load_text(DOCKERFILE_PATH)
    assert bi["tag"] in dockerfile, (
        f"Dockerfileのコメントに{bi['tag']}が見つかりません。"
        "expected-model-hashes.jsonのbaseImage.tagとDockerfileのコメントを同時更新してください。"
    )
    assert bi["buildInfo"] in dockerfile, (
        f"Dockerfileのコメントに{bi['buildInfo']}が見つかりません。"
        "expected-model-hashes.jsonのbaseImage.buildInfoとDockerfileのコメントを同時更新してください。"
    )


def test_readme_documents_model_metadata():
    """README.mdに記載されたモデルのメタデータ(pinned revision/ファイル名/サイズ/
    SHA-256)がexpected-model-hashes.jsonと一致することを確認する。sha256のみの
    検証では「READMEが3者間ドリフトガードすると主張しているのに実際は一部の値しか
    テストされていない」というギャップがあった(pr-test-analyzer指摘、High)。"""
    data = load_expected_hashes()
    tg = data["textGeneration"]
    readme = load_text(README_PATH)
    assert tg["hfRepoId"] in readme, f"README.mdに{tg['hfRepoId']}が見つかりません"
    assert tg["hfRevision"] in readme, f"README.mdに{tg['hfRevision']}が見つかりません"
    assert tg["fileName"] in readme, f"README.mdに{tg['fileName']}が見つかりません"
    # sizeBytesはREADME.md上で桁区切りカンマ付きで記載されている(例: 3,568,393,312 bytes)
    size_with_commas = f"{tg['sizeBytes']:,}"
    assert size_with_commas in readme, f"README.mdに{size_with_commas}が見つかりません"
    assert tg["sha256"] in readme, f"README.mdに{tg['sha256']}が見つかりません"


def test_readme_documents_base_image_build_info():
    """README.mdに記載されたベースイメージのbuild_infoがexpected-model-hashes.json
    と一致することを確認する(モデル同様、README側の記載値もドリフトガード対象にする)。"""
    data = load_expected_hashes()
    bi = data["baseImage"]
    readme = load_text(README_PATH)
    assert bi["buildInfo"] in readme, f"README.mdに{bi['buildInfo']}が見つかりません"
