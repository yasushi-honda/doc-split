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
(例外の記録: 2026-11-04にページ向き補正(use_doc_orientation_classify)を追加した。golden生成スクリプトは
意図的に補正なしのまま据え置いている(既存goldenの再現性を保つため)。補正なしと補正ありの照合は
golden 6ページで別途行い完全一致を確認した(ローカルMac、ADR-0031)。det/recの重みと結合順序は不変。)
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from hashutil import sha256_file

DET_MODEL_NAME = "PP-OCRv6_medium_det"
REC_MODEL_NAME = "PP-OCRv6_medium_rec"
DOC_ORI_MODEL_NAME = "PP-LCNet_x1_0_doc_ori"

logger = logging.getLogger("paddle-ocr.engine")

# expected-model-hashes.jsonのキー -> モデルディレクトリ名。起動時検証(_verify_model_hashes)の対象で、
# download_models.MODEL_KINDSと同一でなければならない(tests/test_ocr_engine.pyが一致を固定する)。
MODEL_DIRS = {
    "textDetection": DET_MODEL_NAME,
    "textRecognition": REC_MODEL_NAME,
    "docOrientation": DOC_ORI_MODEL_NAME,
}


def _verify_model_hashes(model_root: Path, expected: dict) -> None:
    """起動時にモデルファイルのSHA-256を再検証する(fail-loud)。

    ビルド時のdownload_models.pyでの検証に加え、実行時にも再検証するのは、レイヤ破損や
    誤ったイメージへの差し替えを実行時に検知するため。100MB級のファイルでもSHA-256計算は
    数百ms程度でcold startへの影響は無視できる。
    """
    for kind, dirname in MODEL_DIRS.items():
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
            texts = list(result[0]["rec_texts"])
        except (KeyError, IndexError, TypeError) as e:
            raise RuntimeError(f"PaddleOCR実行結果の形状が想定外です: {e}") from e
        self._log_orientation(result[0])
        return texts

    @staticmethod
    def _log_orientation(page_result) -> None:
        """向き補正で回したページを運用者が数えられるよう、適用角度が0度以外のときだけ警告ログを出す。

        向き分類は信頼度の閾値なしで必ず適用される(正常な向きのページを誤って回せば、読み取りが劣化する)。
        本番(uvicorn、rootロガーはWARNING)で出力されるようwarningにする(PDF_PAGE_DOWNSCALEDと同じ扱い)。
        書類名・内容は含めず角度だけ。角度を取れなくてもOCR自体は止めない(観測のための情報のため)が、
        黙って欠けないよう、取れなかったことをログに残す。
        """
        try:
            angle = page_result["doc_preprocessor_res"]["angle"]
        except (KeyError, IndexError, TypeError):
            logger.warning("PAGE_ORIENTATION_ANGLE_UNAVAILABLE: 向き補正の適用角度を結果から取得できませんでした")
            return
        if angle not in (0, None):
            logger.warning("PAGE_ORIENTATION_CORRECTED: 適用角度=%s度", angle)

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
    doc_ori_dir = model_root / DOC_ORI_MODEL_NAME

    # lang指定はtext_detection_model_name/text_recognition_model_name指定時は無視される
    # (scripts/generate-paddle-ocr-golden-text.pyで実測済みの挙動)ため渡さない。
    #
    # enable_mkldnn=True + paddlepaddle==3.2.2(ADR-0025 PR4c、2026-09-14 CPU速度改善):
    # PR4a実機検証時点ではenable_mkldnn=True(paddlepaddle 3.3.1)がlinux/amd64コンテナで
    # "(Unimplemented) ConvertPirAttribute2RuntimeAttribute not support [...]"
    # (onednn_instruction.cc)によりクラッシュしたため無効化していた。原因を追跡した結果、
    # paddlepaddle 3.3.0で導入された新IR(PIR)とoneDNN命令変換の組み合わせバグと判明
    # (公式Issue: PaddlePaddle/Paddle#77340。修正PR#77430はdevelopへ2026-04-16マージ済みだが
    # 2026-09時点のどのPyPI公開版にも未反映)。paddlepaddle==3.2.2(このバグ導入前の最終安定版)
    # へrequirements.txtを切り戻すことでenable_mkldnn=Trueが正常動作することを実機確認した。
    #
    # cpu_threads=4/--cpu=4(.github/workflows/deploy-paddle-ocr.yml、vCPU数に一致させ
    # オーバーサブスクリプションを回避)・execution-environment=gen2(Cloud Run新実行環境、
    # 公式にCPU性能向上と明記)と合わせて、1ページあたりp50=6.4秒/p95=7.4秒まで改善
    # (旧構成93.3秒から約14.6倍)。承認済みゲート基準(1p<=30秒/20p<=400秒/71p<=850秒)を
    # 全て満たすことを実機golden計測(18/18文字単位一致)で確認済み。
    engine = PaddleOCR(
        text_detection_model_name=DET_MODEL_NAME,
        text_detection_model_dir=str(det_dir),
        text_recognition_model_name=REC_MODEL_NAME,
        text_recognition_model_dir=str(rec_dir),
        # ページ向きの自動補正(0/90/180/270度)。Gemini時代は画像を見て向きを吸収できたが、PaddleOCRは
        # 補正しないと横向き・上下逆のFAX帳票を読めない(合成の横向き帳票で、90度の片方向と180度が
        # 重要語0/13、出力が数字だけになることを再現。補正ありは4方向とも13/13。ADR-0031)。
        # 正常な向きのgolden 6ページ(ローカルMac)では、補正なしと補正ありのOCRテキストが完全一致した。
        # 24文書全体の再評価は未実施(ADR-0031の「限界」参照)。保存される modelVersion は det/rec のハッシュ
        # のままで、向き分類モデルは含めない(paddle-ocr-verify.tsの期待値導出と一致させるため)。
        doc_orientation_classify_model_name=DOC_ORI_MODEL_NAME,
        doc_orientation_classify_model_dir=str(doc_ori_dir),
        use_doc_orientation_classify=True,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=True,
        cpu_threads=4,
    )

    det_hash12 = expected_hashes["textDetection"]["fileHashes"]["inference.pdiparams"][:12]
    rec_hash12 = expected_hashes["textRecognition"]["fileHashes"]["inference.pdiparams"][:12]
    model_version = f"PP-OCRv6_medium/det:{det_hash12}/rec:{rec_hash12}"

    return PaddleOcrEngine(engine, model_version)
