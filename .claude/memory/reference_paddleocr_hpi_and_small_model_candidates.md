---
name: reference-paddleocr-hpi-and-small-model-candidates
description: PaddleOCR(ADR-0025)の速度改善候補2件(enable_hpi・PP-OCRv6_small)。次回ADR-0025関連作業時の検討候補として拾う
metadata:
  type: reference
---

2026-09-22、別セッション(local-ai-lab-19、OCR速度改善を調査中)からの共有。ADR-0027(Sarashina要約移行)作業中に受領し、decision-maker確認のうえ「拾っておいて、次回でいい」との指示。**まだ検証・導入は一切行っていない**。次回ADR-0025(PaddleOCR)関連のタスクに着手する際、以下2点を検討候補として思い出すこと。

## 候補1: `enable_hpi=True`(PaddleOCR公式ワンクリック高速化、Linux x86-64専用)

公式ドキュメント([PaddleOCR high_performance_inference.md](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/inference_deployment/local_inference/high_performance_inference.md))によると、`paddleocr install_hpi_deps cpu`(またはgpu)実行後に`PaddleOCR(enable_hpi=True)`とするだけで、事前知識に基づき最適な推論バックエンド(OpenVINO/ONNX Runtime/TensorRT等)とFP16等の高速化設定を自動選択してくれる機能。

- **対象環境の一致**: doc-splitのPaddleOCRはCloud Run(Linux x86-64)で稼働しており、この機能の対象環境そのもの。共有元(local-ai-lab-19)はmacOS/arm64のため未検証(Apple Silicon固有の話は別セッションで矛盾が出た実績あり、と申告あり)。
- **未確認事項**: `services/paddle-ocr/`側で現在この機能が使われているか未確認。手動でのONNX変換なしに速度改善が見込める可能性がある、という共有元の推測のみで、doc-split側での実測はまだ無い。

## 候補2: PP-OCRv6_smallは実文書でもmedium相当の精度を維持(共有元の実測)

共有元が実施した帳票画像16枚(表形式・自由記述混在)での計測: medium(現行採用モデル)が文字一致率98.8%に対し、smallは98.6%とほぼ同水準。tinyは69.9%に精度崩壊するため不採用、との報告。

- doc-split側はmedium選定時、v5比精度改善(+5.1%/+4.6%)を理由にしており、speed目的でのsmall/tiny検証は実施していない(現状の判断根拠は精度面のみ)。
- 共有元の16枚という検証データ規模はdoc-split標準(D1〜D10相当の複数書類種別での固有名詞捏造テスト等)より小さいため、導入検討時はdoc-split側の実データ・実書類種別で改めて精度検証すること(共有元の数値をそのまま採用しない)。

## 次回検討時の進め方

- [[feedback_check_existing_implementation_before_new_infra]]と同様、まず`services/paddle-ocr/`の現状実装(`enable_hpi`未導入か、モデルサイズ設定箇所)を確認してから着手する
- 精度検証はdoc-split標準の固有名詞捏造テスト・カバー率テストの枠組みを流用する(ADR-0025既存の検証資産を再利用)
- ADR-0025はGA済みでPass1稼働中のため、変更する場合は既存運用への影響評価(ロールバック手順込み)を先に行う
