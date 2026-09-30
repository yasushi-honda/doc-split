---
name: feedback-gha-dispatch-read-new-run-id-before-result
description: gh workflow runをdispatch直後に「最新run」を読むと、起動前の旧runを拾って旧結果を現在の結果と誤読する。新しいrun IDに切り替わったことを確認してから読む
metadata:
  type: feedback
---

`gh workflow run`の直後に`gh run list --limit 1`で最新runを取ると、dispatchがまだ反映されておらず**直前のrun**を返すことがある。固定の`sleep`では足りない。

**Why**: 再帰統合ツールのdevリハーサルで、冪等性確認の再実行結果として前回executeのrun(`completed`・`finalize=resolved`)を読み、新しい再実行の結果のように報告しかけた。ログを見ると旧runのIDのままで、気付いて新しいrunを待ち直した。bashの`timeout`コマンドはmacOSに無く、待機が無言で失敗して`queued`のまま戻ったこともあった。

**How to apply**:
- dispatch前に最新run IDを`PREV`へ控え、dispatch後は`PREV`と異なるIDになるまでループで待ってから、そのIDでwatch・ログ取得する
- 読んだrunの実行時刻/ID、結果の`status=`行が期待する種別(dry-run/completed/already-completed)かも確認する
- 長い待機は`run_in_background`で`gh run watch`する。macOSでは`timeout`を使わない
