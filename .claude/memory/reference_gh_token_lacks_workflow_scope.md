---
name: gh-token-lacks-workflow-scope
description: この端末のghトークンにはworkflowスコープが無く、.github/workflows/配下の変更はpushが拒否される。スコープ付与で回避せず、生成スクリプト側で対応する
metadata:
  type: reference
---

2026-10-25、`.github/workflows/paddle-ocr-downscale-accuracy.yml` に入力を1つ足したコミットを push したところ、GitHub が拒否した(`refusing to allow an OAuth App to create or update workflow ... without workflow scope`)。ワークフローファイルを含むコミットが1つでも範囲にあると、ブランチ全体の push が通らない。

**Why:** この端末の `gh` のOAuthトークンに `workflow` スコープが付いていない。スコープを足す(`gh auth refresh -s workflow`)とトークンでワークフローを書き換えられるようになるが、グローバルの脅威調査(2026-10-24)で、トークンのスコープは「残る穴」の一つとされている。decision-makerも、権限を拡げる回避ではなく生成スクリプト側の対応を選んだ(2026-10-25)。

**How to apply:**
- ワークフローの変更が必要に見えたら、まず `.github/scripts/` や `scripts/` 側で実現できないかを考える(2026-10-25は、画像を作る既存スクリプトに大判PDFの出力を足して解決した)。ワークフローが固定の手順で呼ぶスクリプトの出力を増やせば、ワークフロー自体は変えずに済む。
- ワークフローの変更が避けられない場合は、自分でスコープを付与せず、decision-makerに方法(UIで編集する、スコープ付与は本人が判断する等)を相談する。
- 未push のコミットにワークフローの変更が入ってしまったら、`git reset --soft` で戻し、ワークフローを元に戻してから、変更のないコミットとして切り直す(リモートに何も出ていないことを先に確認する)。
- 既存のワークフローは、push 済みのブランチを指定して実行できる(`gh workflow run <workflow>.yml --ref <branch>`)。2026-10-25の精度確認では、マージ前に、ブランチ上の生成スクリプトで dev に対して実行できた(run 40188163163)。**`deploy-paddle-ocr.yml` のブランチ指定の展開は、まだ実機で試していない**。
