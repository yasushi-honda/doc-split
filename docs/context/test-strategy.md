# テスト戦略 (DocSplit functions/)

このドキュメントは DocSplit の `functions/` 配下で採用している **契約テスト (contract test)** の 3 系統の役割・手法・使い分けを一元化する。個別の contract test ファイルの docstring から本ドキュメントを参照することで、共通説明の重複を削減する。

---

## 1. 契約テストの位置づけ

`functions/` の OCR / 書類処理パスは以下の要因で unit test のみでは contract を保護できない:

- `admin.firestore()` / `storage.bucket()` / Vertex AI など **top-level で admin 初期化**する副作用を持つモジュールが多く、単体から runtime 呼出が難しい
- Firestore 旧データ (型変更前の document) 由来の discriminated union 違反が **silent に prod 分岐を通過**し Cloud Logging alert にも拾われない silent failure 経路が過去発生 ([Issue #209 / #288 item 6])
- PR merge 後の **code レベル回帰** (例: `void safeLogError(...)` 直叩き回帰 / try/catch 剥離 / anchor rename) を CI で検知する必要がある

これらを補う最小コストの層として contract test を配置している。

---

## 2. 3 系統の使い分け

### 2.1 grep-based contract test

| 項目 | 内容 |
|------|------|
| 目的 | source 構造の回帰防止 (関数名 / anchor / 文字列 pattern) |
| 手法 | `readFileSync` でソース全文を読み、brace-nesting / paren-nesting で対象ブロックを抽出 → 必須要素を正規表現で検証 |
| 適用 | prod 分岐 / silent failure 対策 / caller wiring |
| 依存 helper | [`functions/test/helpers/extractBraceBlock.ts`](../../functions/test/helpers/extractBraceBlock.ts) (`extractBraceBlock` / `extractParenBlock`, Issue #302 で共通化) |
| 既存例 | `textCapProdInvariantContract.test.ts` (#288 item 6), `aggregateCapLogErrorContract.test.ts` (#283), `handleProcessingErrorContract.test.ts` (#276), `textCapDrainSinkContract.test.ts` (#293 + #297、#304 naming refactor), `textCapErrorLoggerFallbackContract.test.ts` (#303 errorLogger require failure fallback), `ocrProcessorAggregateCallerContract.test.ts` (#293 + #297), `summaryBuilderCallerContract.test.ts` (#214/#225 count-based), `summaryCatchLogErrorContract.test.ts` (#266 anchor-window), `summaryWritePayloadContract.test.ts` (#255/#259 adjacency-window), [`types/textCapAsCastContract.test.ts`](../../functions/test/types/textCapAsCastContract.test.ts) (#284、path は `types/` だが方式は grep、命名優先規則 §2.4 の例外) |
| 限界 | 文字列/正規表現/テンプレートリテラル内の裸 `{` `}` で誤判定の可能性。将来そのケースに遭遇したら AST ベース抽出への移行を検討 |

**偽陽性対策**: 関数本体全体を対象にした regex だと無関係な同名ローカル変数 / 他 logger 呼出 / 文字列リテラルに偽陽性が出る ([silent-failure-hunter 指摘])。`extractBraceBlock` で scope を絞る + anchor を narrow することで精度を上げる。

**silent PASS リスク**: helper が空文字を返した場合 `expect(block).to.not.match(...)` は常に PASS する。各 `it` で `expect(block).to.not.equal('')` の non-empty guard を先に実行すること ([PR #311 review C1/C2])。

> **適用範囲**: 本警告は `extractBraceBlock` / `extractParenBlock` で事前抽出したブロックを `.to.not.match(...)` で検証する **brace-extracted block tests** のみに該当する (例: `textCapProdInvariantContract` / `textCapDrainSinkContract` / `textCapErrorLoggerFallbackContract` / `aggregateCapLogErrorContract` / `handleProcessingErrorContract` / `ocrProcessorAggregateCallerContract`)。以下 3 パターンは抽出結果の空文字返却という失敗モードを構造的に持たず免疫である:
> - **anchor-window スライド**: ソース全文を anchor 周辺 ±N 行のウィンドウでスキャン (`summaryCatchLogErrorContract` の `ANCHOR_WINDOW_LINES=8`)
> - **adjacency window スライド**: ソース全文を複数 pattern 共存判定のウィンドウでスキャン (`summaryWritePayloadContract` の `ADJACENCY_WINDOW_LINES=30`)
> - **count-based match**: ソース全文 (コメント除外後) に対する `countMatches >= 1` 形式 (`summaryBuilderCallerContract`、`.at.least(1)` assertion で空マッチが即 FAIL)

### 2.2 `@ts-expect-error` 型契約 test

| 項目 | 内容 |
|------|------|
| 目的 | 型レベル不変条件の lock-in (union 分解 / generics 制約) |
| 手法 | `@ts-expect-error` コメント + `tsc --noEmit` (`tsconfig.test.json` で明示検証) |
| 適用 | discriminated union 不変条件 / generics 制約 / 戻り値型の union 広がり |
| 既存例 | [`functions/test/types/pageOcrResult.types.test.ts`](../../functions/test/types/pageOcrResult.types.test.ts), [`textCapGenericsContract.test.ts`](../../functions/test/types/textCapGenericsContract.test.ts) (#294) |
| 限界 | tsd 等の専用ライブラリは未導入。本 test は baseline として機能し、より精密な型 assert が必要になった時点で tsd 導入を別 Issue 化 |

### 2.3 Runtime pattern test

| 項目 | 内容 |
|------|------|
| 目的 | admin 非依存で実 runtime 挙動を lock-in (統合 test の代替) |
| 手法 | 期待される caller パターンを inline で最小再現し、spy 注入で呼出内容を検証 |
| 適用 | caller wrapper / E2E の最小再現 / admin 初期化を避けたい箇所 |
| 既存例 | [`functions/test/ocrAggregateCallerPattern.runtime.test.ts`](../../functions/test/ocrAggregateCallerPattern.runtime.test.ts) (#294 item 8, #293/#297 補完) |
| 将来 | 完全な統合 test は `ts-node/esm` 環境整備 + `admin` mock で Issue #299 に委譲。それまでは runtime pattern test を二段防御の一翼として保持 |

### 2.4 命名規則

contract test ファイルの命名で方式系統を識別できるよう、以下の規則で統一する。

| 命名規則 | 系統 | 置き場所 |
|---------|------|---------|
| `*Contract.test.ts` | §2.1 grep-based | `functions/test/` 直下 |
| `types/*.test.ts` | §2.2 `@ts-expect-error` 型契約 | `functions/test/types/` |
| `*.runtime.test.ts` | §2.3 runtime pattern | `functions/test/` 直下 |

新規 contract 追加時は本規則に従うことで、ファイル名から `test-strategy.md §2.X` の参照先がほぼ一意に定まる (例外は下記「優先規則」を参照し、該当ファイルの docstring を確認する)。

**優先規則 (複数パターンに該当する場合)**: ファイルが複数 pattern に該当する場合は **方式が優先**する。path と basename は hint。例外ファイルは docstring で `命名優先規則 (§2.4)` を明記すること。

- `functions/test/types/` 配下の `*Contract.test.ts` — 方式が `@ts-expect-error` 型契約なら §2.2、grep-based なら §2.1 (例: `types/textCapAsCastContract.test.ts` は grep-based で §2.1、`types/textCapGenericsContract.test.ts` は @ts-expect-error で §2.2)
- 方式の識別は各ファイル docstring の `* 方式:` 行を参照する

### 2.5 共通 helper

| Helper | 用途 | Issue |
|--------|------|-------|
| [`extractBraceBlock`](../../functions/test/helpers/extractBraceBlock.ts) / `extractParenBlock` | grep-based test の brace/paren nesting 抽出 | #302 |
| [`makeInvalidPage`](../../functions/test/helpers/textCapFixtures.ts) / `makeMixedPages` | `as unknown as SummaryField` cast を集約した fixture | #307 |
| [`withNodeEnv`](../../functions/test/helpers/withNodeEnv.ts) / `withNodeEnvAsync` | `process.env.NODE_ENV` 切替の確実復元 (undefined 文字列化防止) | #306 |

ロジック持ちの helper (`extractBraceBlock` / `withNodeEnv`) には `functions/test/helpers/*.test.ts` で単体 test を配置し、helper 固有の挙動 (復元順序 / async 経路 / startAfterAnchor option) を直接 lock-in している。pure fixture の helper (`textCapFixtures`) は消費側 contract test での利用で十分と判断し専用 test は配置しない。

---

## 3. 選定フロー

新規 contract を追加する際の判断フロー:

```
Q1. source 構造 (関数名 / anchor / 呼出の存在) を保護したいか
 → Yes: grep-based (§2.1)
 → No:  Q2 へ

Q2. 型レベル不変条件を保護したいか (union / generics / 戻り値型)
 → Yes: @ts-expect-error (§2.2)
 → No:  Q3 へ

Q3. runtime 挙動を実コード無しで検証したいか (admin 依存を避けたい)
 → Yes: runtime pattern (§2.3)
 → No:  通常の unit test / integration test を検討
```

複数系統の二段防御が適切なケース (例: grep + runtime) は、両方を `Refs:` コメントで相互参照する。

**二段防御の具体例 (#294 item 8 / #293 + #297)**:

- [`ocrProcessorAggregateCallerContract.test.ts`](../../functions/test/ocrProcessorAggregateCallerContract.test.ts) (§2.1 grep-based) — caller 側 (`functions/src/ocr/ocrProcessor.ts` の `capPageResultsAggregate` 呼出周辺) の try/catch + `await Promise.allSettled(pendingInvariantLogs)` / catch の `:aggregateCap:invariant` vs `:aggregateCap:unexpected` suffix 分類など **source 構造** を lock-in
- [`ocrAggregateCallerPattern.runtime.test.ts`](../../functions/test/ocrAggregateCallerPattern.runtime.test.ts) (§2.3 runtime pattern) — caller wrapper パターンを inline 再現し spy 注入で **実 runtime 挙動** (allSettled flush / dev throw 捕捉継続 / documentId 伝搬) を検証

grep は関数名リネームや anchor 削除を即座に検知し、runtime は grep では捕捉できない制御フロー挙動 (例: dev throw が処理継続を阻害しないこと) を検証する相補関係にある。片方だけだと検知漏れ (grep-only: 挙動 silently 破壊 / runtime-only: 関数名改名で test が別 function を evaluate) を生むため、ペアで配置する。

---

## 4. docstring テンプレート

各 contract test ファイルの docstring は以下の最小テンプレートに従う:

```typescript
/**
 * <対象関数/モジュール名> の <契約の目的> テスト (Issue #XXX)
 *
 * 目的: <何を検証するか。1-2 文>
 *
 * 背景: <なぜこの contract が必要か。過去の silent failure や回帰事例を 1-3 文>
 *
 * 方式: <grep-based / @ts-expect-error / runtime pattern のどれか>
 *        <docs/context/test-strategy.md §2.X> 参照
 *
 * 将来委譲: <移行計画がある場合は Issue 番号付きで記載。恒久 contract には
 *           「現時点で委譲先なし」と明記する (記載省略は禁止)>
 */
```

「方式選定」節で 3 系統の使い分け理由を毎回書かず、本 docstring から `test-strategy.md §2.X` にリンクすることで重複を削減する。

**「将来委譲」節の必須化**: 本節は optional ではなく、全 contract test で必ず記載する。移行計画がない恒久 contract は `現時点で委譲先なし` と明記することで、「記載漏れ」と「恒久判断」の識別情報損失を防ぐ (記載なし = 将来 Issue 化したが消えた、と誤読されると Phase/owner 追跡が途絶する)。

**記載例**:

```
* 将来委譲: 動的 safeLogError invocation test は Issue #299 で追加予定
            (移行後は本 contract を削除可能)

* 将来委譲: 現時点で委譲先なし (source 構造保護が本質のため恒久 contract として保持)

* 将来委譲: false negative 実発生時に sinon spy 契約テストへ切替予定。
            それまでは恒久 contract として保持。
```

---

## 5. 参考 Issue

- [#293](https://github.com/yasushi-honda/doc-split/issues/293) caller try/catch 方針整理 (§3 二段防御具体例の由来)
- [#294](https://github.com/yasushi-honda/doc-split/issues/294) integration/mixed-input 契約 (§3 二段防御具体例の由来)
- [#297](https://github.com/yasushi-honda/doc-split/issues/297) fire-and-forget flush 保証 (§3 二段防御具体例の由来)
- [#302](https://github.com/yasushi-honda/doc-split/issues/302) brace-nesting helper 共通化
- [#306](https://github.com/yasushi-honda/doc-split/issues/306) withNodeEnv helper
- [#307](https://github.com/yasushi-honda/doc-split/issues/307) SummaryField fixture 集約
- [#308](https://github.com/yasushi-honda/doc-split/issues/308) 本ドキュメント (docstring 共通パターン抽出)
- [#317](https://github.com/yasushi-honda/doc-split/issues/317) 本ドキュメント継続改善 4 項目 (§2.1 適用範囲 / §2.4 命名規則 / §3 二段防御例 / §4 必須化)
- [#299](https://github.com/yasushi-honda/doc-split/issues/299) 動的 safeLogError invocation test (将来)
