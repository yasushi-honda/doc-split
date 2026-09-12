# ADR-0025 PR4a: PaddleOCR Cloud Runサービス。
#
# 単一ステージを採用する理由: マルチステージにしてもpaddlepaddle本体(約425MB)のサイズ削減
# 効果は薄く(モデル取得スクリプト自体は数十KBに過ぎない)、構成の複雑化に見合わないと判断した。
#
# モデル取得(download_models.py)はHugging Face Hubのimmutable revisionから直接取得し、
# SHA-256検証を行う(services/paddle-ocr/expected-model-hashes.json参照)。PaddleOCR/PaddleXの
# モデルロード機構は経由しない(model_dir指定時は取得を行わずFileNotFoundErrorになる制約のため、
# 取得と実行時ロードを明確に分離している。詳細はocr_engine.py/download_models.pyのdocstring参照)。
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=2 \
    PADDLE_MODEL_DIR=/opt/paddle-ocr/models \
    PADDLE_EXPECTED_HASHES=/app/expected-model-hashes.json \
    PADDLE_PDF_RENDER_DPI=200

# opencv-contrib-python(非headless)がリンクするlibGL等をpaddleocrが要求する。
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 libglib2.0-0 libsm6 libxext6 libxrender1 libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# モデル取得+SHA-256検証(ビルド時専用、fail-loud)。HOME=/tmp/paddle-buildでHFキャッシュを
# 隔離し、同一RUN内で削除することで最終イメージにキャッシュが残らないようにする。
# hashutil.pyはdownload_models.py(ビルド時)とocr_engine.py(実行時)の両方が共有する
# 依存ゼロのSHA-256ヘルパー(code-review指摘反映、重複実装の解消)。
COPY expected-model-hashes.json download_models.py hashutil.py ./
RUN HOME=/tmp/paddle-build python3 download_models.py \
      --dest "$PADDLE_MODEL_DIR" --expected expected-model-hashes.json \
    && rm -rf /tmp/paddle-build

COPY ocr_engine.py raster.py app.py ./

# 非rootユーザーで実行する。モデルは読み取り専用にし、rootで取得したキャッシュを非rootが
# 見失う問題を、固定の絶対パスへの明示コピー+読み取り専用化で構造的に解消する。
RUN useradd --create-home --uid 1001 --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app /opt/paddle-ocr \
    && chmod -R a=rX /opt/paddle-ocr/models \
    && mkdir -p /home/appuser/.paddlex \
    && chown appuser:appuser /home/appuser/.paddlex
USER appuser
ENV HOME=/home/appuser

EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
