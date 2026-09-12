"""ADR-0025 PR4a: PaddleOCR実行モジュール(実行時ロード専用)。

重要(取得と実行の分離、v2で設計変更): 本モジュールはモデルの「取得」を一切行わない。
download_models.py がビルド時に /opt/paddle-ocr/models/<name>/ へモデルを配置・検証済みである
ことを前提とし、build_engine() は常にこの固定パスを text_*_model_dir として渡す。

この分離が必要な理由: PaddleXの _resolve_model_dir()
(.venv-paddle/lib/python3.12/site-packages/paddlex/inference/models/__init__.py:92-108)は、
model_dir が指定されている場合はディレクトリの存在確認のみを行い、存在しなければ
FileNotFoundError を送出する(ダウンロードしない)。取得ロジックと実行時ロードを同じ関数で
行おうとすると、初回ビルド時に必ず失敗する(v1の設計バグ、codex review pass2で指摘・検証済み)。

コンストラクタ引数・結合順序はscripts/generate-paddle-ocr-golden-text.pyのocr_single_page_pdf()と
一字一句一致させること。変更した場合、ADR-0025が実測した94/96正解という結果が無効になるため、
scripts/generate-paddle-ocr-golden-text.pyの再実行による再検証が必須。
"""

from __future__ import annotations

import threading
from pathlib import Path

from hashutil import sha256_file

DET_MODEL_NAME = "PP-OCRv6_medium_det"
REC_MODEL_NAME = "PP-OCRv6_medium_rec"


def _verify_model_hashes(model_root: Path, expected: dict) -> None:
    """起動時にモデルファイルのSHA-256を再検証する(fail-loud)。

    ビルド時のdownload_models.pyでの検証に加え、実行時にも再検証するのは、レイヤ破損や
    誤ったイメージへの差し替えを実行時に検知するため。100MB級のファイルでもSHA-256計算は
    数百ms程度でcold startへの影響は無視できる。
    """
    for kind, dirname in (("textDetection", DET_MODEL_NAME), ("textRecognition", REC_MODEL_NAME)):
        spec = expected[kind]
        model_dir = model_root / dirname
        for fname, expected_hash in spec["fileHashes"].items():
            fpath = model_dir / fname
            if not fpath.exists():
                raise RuntimeError(
                    f"モデルファイルが見つかりません: {fpath}。"
                    "download_models.pyがビルド時に正しく実行されたか確認してください。"
                )
            actual_hash = sha256_file(fpath)
            if actual_hash != expected_hash:
                raise RuntimeError(
                    f"モデルファイルのSHA-256が不一致です: {fpath}\n"
                    f"  期待値: {expected_hash}\n"
                    f"  実測値: {actual_hash}\n"
                    "イメージが破損しているか、意図しないモデルに差し替わっている可能性があります。"
                )


class PaddleOcrEngine:
    """PaddleOCR実行のラッパー。engine.predictをthreading.Lockで直列化する。

    --concurrency=1 はCloud Run配送上の約束(1インスタンスに同時配送されるリクエストは1つ)であり、
    プロセス内の完全排他を保証しない(ヘルスチェックと重なる可能性がある)。PaddleOCRのスレッド
    安全性は保証されていないため、安価な保険としてLockで直列化する。
    """

    def __init__(self, engine, model_version: str):
        self._engine = engine
        self._lock = threading.Lock()
        self.model_version = model_version

    def page_texts(self, rgb_array) -> list[str]:
        """1ページ分のRGB配列からPaddleOCRの生rec_texts(結合前)を返す。"""
        with self._lock:
            result = self._engine.predict(rgb_array)
        try:
            return list(result[0]["rec_texts"])
        except (KeyError, IndexError, TypeError) as e:
            raise RuntimeError(f"PaddleOCR実行結果の形状が想定外です: {e}") from e

    def page_text(self, rgb_array) -> str:
        """1ページ分のRGB配列から結合済みテキストを返す。

        "\\n".join(rec_texts) という結合順序は
        scripts/generate-paddle-ocr-golden-text.py:ocr_single_page_pdf() と完全同一。
        """
        return "\n".join(self.page_texts(rgb_array))


def build_engine(model_root: Path, expected_hashes: dict) -> PaddleOcrEngine:
    """固定パスからPaddleOCRエンジンを構築する。モデルは事前に配置・検証済みである前提。"""
    _verify_model_hashes(model_root, expected_hashes)

    from paddleocr import PaddleOCR

    det_dir = model_root / DET_MODEL_NAME
    rec_dir = model_root / REC_MODEL_NAME

    # lang指定はtext_detection_model_name/text_recognition_model_name指定時は無視される
    # (scripts/generate-paddle-ocr-golden-text.pyで実測済みの挙動)ため渡さない。
    #
    # enable_mkldnn=False(PR4a実機検証で追加): linux/amd64コンテナ(Cloud Run想定環境)で
    # デフォルトのmkldnn実行パスを使うと
    # "(Unimplemented) ConvertPirAttribute2RuntimeAttribute not support [...]"
    # (onednn_instruction.cc)で推論が例外終了することを実機確認した。mkldnnはCPU推論の
    # 高速化オプションであり正解性には影響しないため、無効化して安全側に倒す。
    # 無効化後、golden fixture(golden_plain_01.pdf)でarm64生成時と文字単位で完全一致する
    # OCR結果が得られることを確認済み。
    engine = PaddleOCR(
        text_detection_model_name=DET_MODEL_NAME,
        text_detection_model_dir=str(det_dir),
        text_recognition_model_name=REC_MODEL_NAME,
        text_recognition_model_dir=str(rec_dir),
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=False,
    )

    det_hash12 = expected_hashes["textDetection"]["fileHashes"]["inference.pdiparams"][:12]
    rec_hash12 = expected_hashes["textRecognition"]["fileHashes"]["inference.pdiparams"][:12]
    model_version = f"PP-OCRv6_medium/det:{det_hash12}/rec:{rec_hash12}"

    return PaddleOcrEngine(engine, model_version)
