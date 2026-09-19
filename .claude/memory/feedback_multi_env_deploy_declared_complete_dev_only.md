---
name: multi-env-deploy-declared-complete-dev-only
description: dev/kanameone/cocoro構成でdevのみデプロイ・確認して「完了」と宣言してしまう再発パターン
metadata:
  type: feedback
---

devはmainマージ時にCI自動デプロイされるが、kanameone/cocoroは環境別`workflow_dispatch`(Functions/Cloud Run/監視基盤セットアップ等)が必要。この非対称性のため、devでの実機確認だけで「デプロイ完了」「監視基盤導入完了」と宣言し、kanameone/cocoroへの反映を忘れる、または「dry-run成功」を「本適用成功」と混同して未実施のまま完了報告する事象が、同一セッション内で複数回連続発生した(いずれも独立した実機再検証で発覚)。

**Why**: `multi-client-audit-matrix.md`が既に別ドメイン向けに定義している「他環境のauditは独立工程として確認する」という原則と同型の問題が、別ドメインでも構造的に繰り返された。dev/kanameone/cocoroの3環境構成である限り、この非対称デプロイモデル自体がリスク源であり、変更対象のドメインを問わず再発しうる。

**How to apply**: 環境別デプロイ・環境別運用スクリプト実行を伴う変更を「完了」と報告する前に、必ず**3環境全てで**個別に実機確認コマンド(`gcloud ... describe`等)を実行し、その出力を報告に含める。「devで確認したので大丈夫」という推論はしない。「dry-runが成功した」ことは「本適用が成功した」ことの証拠にならない——本適用コマンド自体の実行結果(exit code・作成ログ)を必ず確認する。[[multi-client-audit-matrix]](../rules/multi-client-audit-matrix.md)の監査マトリクス原則を、特定ドメイン限定ではなく「3環境デプロイを伴う変更全般」に一般化して適用する。
