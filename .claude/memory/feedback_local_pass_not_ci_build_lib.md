---
name: feedback_local_pass_not_ci_build_lib
description: ローカルのテスト全PASSはCIのPASSを意味しない。ビルド成果物(functions/lib)に依存するテストがあるため、push前はビルドしてからunit testを実行する。2回再発
metadata:
  type: feedback
---

ローカルで unit test が全 PASS でも、CI で失敗することがある。「ローカル PASS」を「CI PASS」として報告しない。

**Why:** 同一セッション内で 2 回再発した。(1) 型注釈のないジェネリックのヘルパーが、ローカルでは通ったが CI の型検査(strict 設定)で失敗した。(2) `scripts/` 配下のスクリプトが `functions/lib`(ビルド済み成果物)を読み込むため、ローカルは `lib` が古いまま旧仕様のテストが通り、CI は build 後に unit test を実行するので新仕様との不一致で失敗した。共通の根本原因は、ローカル検証が CI の実行条件(functions を build してから unit test、型検査は `type-check:test`)と揃っていないこと。

**How to apply:**
- ビルド成果物を読むスクリプト/テストがあるリポジトリでは、push 前に `npm run build:functions` → `cd functions && npm test`(型検査込み)の順で実行する。tokenizer 等の共有ロジックを変えたときは必ず。
- CI 完了を確認するまで「CI PASS」と言わない。マージ認可を受けても CI が pending ならマージせず、全 PASS を確認してから実行する。
- 既存テストが旧仕様を固定していないかを、変更した関数の出力を使う全テスト(スクリプト経由を含む)で grep する。

関連: [[feedback_completion_declaration_needs_fresh_verification]] / [[feedback_integration_test_local_verify]]
