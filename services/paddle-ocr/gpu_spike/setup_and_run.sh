#!/usr/bin/env bash
# ADR-0025 PR4c Phase 2: GPU実測スパイク用セットアップ・実行スクリプト(実験専用、mainへ非マージ)。
# 使い捨てCompute Engine VM(g2-standard-4, common-cu129-ubuntu-2204-nvidia-580)上で実行する前提。
set -euo pipefail

cd "$(dirname "$0")"

python3 -m venv ~/paddle-venv
source ~/paddle-venv/bin/activate
pip install --upgrade pip

# CPU側の基礎パッケージ(paddleocr本体+周辺、requirements.txtの主要パッケージのみ抜粋)
pip install paddleocr==3.7.0 pypdfium2==4.30.0 "huggingface_hub==1.31.0" numpy==2.3.5 pillow==12.3.0

# GPU版paddlepaddle(CUDA 12.9、common-cu129-ubuntu-2204-nvidia-580イメージに対応)を最後に
# インストールし、paddleocrの依存解決で入るCPU版を上書きする。
pip install paddlepaddle-gpu==3.3.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu129/

echo "=== paddle.utils.run_check() ==="
python3 -c "import paddle; paddle.utils.run_check()"

echo "=== モデルダウンロード ==="
python3 download_models.py --dest ~/paddle-ocr-models --expected expected-model-hashes.json

echo "=== CPU計測(device=cpu, cpu_threads=4) ==="
python3 measure.py --device cpu --cpu-threads 4 --warmup 1 --out ~/cpu-result.json

echo "=== GPU計測(device=gpu) ==="
python3 measure.py --device gpu --warmup 1 --out ~/gpu-result.json

echo "=== 完了 ==="
