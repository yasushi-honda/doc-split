# ADR-0032: 複数名が載るFAXの手動複製ボタン

## Status

Accepted (2026-11-12)。仕様案を2026-11-11に先方へ送付し、先方(かなめ様)が2026-11-12に「いただいた内容でお願いします」と了承した(窓口の担当者経由、決裁者が確認)。計画は plan mode で承認済み、plan-crossreview(grip + codex 2パス)を実施済み。実装は feature ブランチ `feature/manual-fax-duplication`。

## Context

kanameoneから、福祉用具貸与事業所の提供表が最大3名分で1枚のFAXに載って届くケースへの対応依頼があった(2026-11-10)。現状は1枚の書類を1名にしか振り分けられない。「Aさん用・Bさん用・Cさん用に複製して、それぞれアプリ上で見え、それぞれのフォルダに保存したい」という内容で、先方は複製の方が分割よりシンプルと想定している。

以前は、OCR完了時に人数分を自動で複製する機能(`faxDuplication`)があった。複数の職員が同時に分割作業をして重複事故が起きたため、kanameoneでは2026-08-30に停止している(ADR-0024)。事故の詳細(発生日・件数・対象書類)は、ADR-0024の1行のほかに記録が見つからない。

## Decision

担当者が詳細画面で押したときだけ複製する、**手動の複製ボタン**にする。自動複製(`faxDuplication`)は戻さない。分割での代替は採らない(分割では同じ内容のページが並ぶだけで、目的に合いにくい)。

### 仕様

- 詳細画面に「他の利用者用に複製」を置く。押すと利用者を選ぶ画面を出し、OCRの完全一致候補を先に表示、マスター検索でも選べる。
- **元の書類は今の利用者のまま**。複製されるのは追加で選んだ利用者の分。複製した書類は利用者・担当CMが確定済み、`verified`は未。確認済みにすると、従来どおりDrive出力される。
- **1グループ(元の書類+複製)の合計は最大5名**(decision-maker決定。先方の想定は3名)。トランザクション内で既存メンバーと追加分を数えて強制する。
- 元の書類の`status`が`processed`・`isSplitSource`でない・**利用者が確定済み**のときだけ実行できる。実行できるのはログイン済みの職員全員(技術的な制限は入れない)。
- **全テナントの基本機能**(decision-maker決定。feature flagは付けない)。cocoroは停止中で反映対象外。

### 設計

- 書類の作成はサーバー側の onCall `duplicateDocumentForCustomers({ documentId, customerIds })`(クライアントから`documents`は作れない、`firestore.rules:59`)。
- **重複の防止**: 複製のdoc IDを`{元docId}_dup_{customerId}`の決まった形にする。トランザクション内で、①そのIDのdocが既にあるか、②同じ`distributionId`のグループに同じ`customerId`のdocがあるか(以前の自動複製の分を含む)を確認し、あれば作らない。IDは「作成の履歴」として扱い、複製後に利用者を変えても元の利用者用は作り直せない(削除してから複製する)。
- **グループの印**: 元の書類に`distributionId`があればそれを使い、なければ元の書類のIDを元の書類にも付ける(decision-maker承認済み)。既存のFE表示(要整理の件数・バッジ非表示)と再処理時の利用者保持(`useDocuments.ts:559`)がそのまま効く。**挙動の変更**: 付与後は元の書類を再解析しても利用者が消えず保持される。新しいフィールドは足さない。
- **複製の中身**は許可リスト方式。引き継ぐ: `fileUrl`/`fileId`/`fileName`/`mimeType`(PDFの実体は共有、既存の自動複製と同じ)・事業所・書類種別・`fileDate`・OCR抽出結果・`targetPageNumber`/`sourceType`/`messageId`・`status`・`totalPages`・`ocrExcerpt`。新たに設定: `id`・`processedAt`(**未設定だと一覧の`processedAt`降順で取得されず消える**)。上書き: `buildFaxDuplicationMemberOverride()`(`functions/src/ocr/faxDuplication.ts:180`)、`confirmedBy`は実行者のuid、`displayFileName`は作り直す。写さない: Drive出力系・`verified*`(未確認で初期化)・分割系・`multiCustomer*`・`customerCandidates`。`detail/main`は元から写す。実装前に、既存の自動複製の書き込み(`ocrProcessor.ts:895-925`)と`Document`型の必須項目を1項目ずつ突き合わせる。
- **OCR全文**(`ocrResultUrl`)は`ocr-results/{複製docId}/`に複製する(再OCR時の掃除が`ocr-results/{実docId}/`のみを対象にするため)。Storageコピー後にFirestoreの書き込みが失敗したら、コピーを削除する。
- 集計・検索・Drive出力は既存のトリガーが新しいdocを普通の書類として扱う。追加しない。

### 保証の範囲(先方へ報告済み)

- 複製ボタンの二重実行(同時押し・押し直し・自動リトライ)は防ぐ。
- 防げないもの: ①複製した書類をさらに分割した場合(分割の子は`distributionId`を引き継がない既存の契約、`splitDistributionIdNonPropagationContract.test.ts`)。②削除と複製のほぼ同時の実行(`storageDeletionGuard.ts:44`が競合を防げないと明記)。
- Driveのフォルダは利用者名・担当CMで決まり`customerId`を使わないため、同姓同名で担当CMも同じ別人は同じフォルダに入る(既存の挙動、変更しない)。

## Consequences

- 先方が、1枚のFAXから利用者別の書類を作り、それぞれのフォルダに保存できる。
- 元の書類の再解析の挙動が変わる(利用者が保持される)ことを、先方へ報告済み。
- 全テナントに複製ボタンが表示される。

## 実装時の確認結果(2026-11-12)

実装中に確認した結果。計画時点の「未確定事項」を、確認できたものから順に確定させた。

- **複製した書類の回転**: 複製には`provenance`・`parentDocumentId`を写さず、`isSplitSource`でもない。元のPDFが受信原本(`original/`配下)なら、既存の`isGenesisEligible`(`genesisEligibility.ts`)を満たすため回転できる。**分割・回転で加工済みのPDF(`processed/`配下)を元にした複製は、`provenance`が無く`original/`でもないため、回転が`failed-precondition`で拒否される**(`pdfOperations.ts:1080`)。`provenance`を写す案は採らない(ADR-0016: 別の書類のバイト証跡を持たせると、`rotatePdfPages`の整合性検証の前提が崩れる)。対処: 回転が必要な書類は、**複製の前に元の書類を回転しておく**(複製は回転後のPDFを共有する)。
- **「利用者が確定済み」の判定**: Drive出力のゲートと同じ`isCustomerUnconfirmed`(`functions/src/drive/customerAmbiguityGate.ts`、内部で`shared/customerIdentity.ts`の`precheckCustomerIdentity`を使う)をそのまま呼ぶ。条件は①利用者名が空・未判定・不明顧客でない、②`customerId`とマスター名が食い違わない(`customerId`のマスターが無い場合も未確定)、③人が確定済み(`customerConfirmed`優先)または同名マスターが2件未満、の3点。`verified`は条件に含めない(先方へ「緑ボタンの前でも複製できる」と回答済みと整合)。統合テストで、未判定・名前の食い違い・同名で未確定は拒否、同名でも人が確定済みなら複製できること、`verified:false`でも複製できることを確認した。
- **同姓同名マスターがあるときのOCRの挙動(実測)**: 実関数(`extractCustomerCandidates`)を架空データで実行した。同名マスターが2件あり、OCR全文にその名前があると、両方がスコア100の完全一致候補になり、先頭のマスターが`bestMatch`として`customerId`・`customerName`・`careManager`に**自動で入る**が、候補の差が0点のため`needsManualSelection=true`、`customerConfirmed=false`になる。**マスターの`isDuplicate`フラグの有無・値によらず同じ**(両方false/未設定でも、両方trueでも同じ結果)。同名が1件だけなら`customerConfirmed=true`。先方へ説明済みの「同名で人が確定するまで未確定、未確定の間はDrive出力が止まる」と一致する。確定後のマスター側の保存内容は、このADRの範囲外のため未実測。
- **OCR全文のコピーと補償削除の限界**: Storageコピー後にFirestoreの書き込みが失敗した場合はコピーを削除する。ただし最終transactionのthrowは「未commitの確証」にならないため、複製docが存在し`ocrResultUrl`がコピーと一致するときは削除しない(`shouldSkipCompensatingDelete`と同じ考え方)。保存先が複製docのIDで決まるため、**同じ複製を同時に実行した2つの呼び出しの片方だけが失敗した場合**は、相手のコピーを消してしまう余地が理論上ある(両方が同時に同じ複製を作ろうとし、かつ片方が書き込みで失敗する場合に限る。孤児を残すより複製docの全文消失の方が影響が大きいため完全には塞げていない)。実害が出た場合は、削除せず孤児として残す方式へ変える。
- **要約は写さない**: `summary*`は元の利用者名を含みうるため複製に写さない。必要なら複製した書類で要約を手動で再生成する。
- **日付**: 保存済みの`fileDateFormatted`があれば写し、`displayFileName`は選んだ利用者名で作り直す(無ければ`fileDate`から作る)。
- 削除と複製のほぼ同時の実行によるPDF消失は、設計では防げない(上の「保証の範囲」)。実害は同じ数秒に重なった場合に限られると見ている。

## plan-crossreview(2026-11-11)

grip(自白可視化)とcodex(独立診断11件、自白を踏まえた更新8件)で実施。計画に反映した主な指摘: `processedAt`/`totalPages`の欠落(High)、グループ合計人数の強制、決定的IDと利用者変更の関係、未確定の元の書類、OCR全文の保存先、Driveの同姓同名、統合テストのCI配線(`ci.yml`の個別列挙への追加が必要)、`verified*`の記述の矛盾、元の書類への`distributionId`付与の挙動変更の明記。採用しなかった提案: kanameone限定のfeature flag(decision-maker判断で全テナントの基本機能)、実行者の技術的な制限(追加スコープ)。限界: grip・codexは同じ計画文書から派生しており、一致しても正しさの保証ではない。

## 関連

- [ADR-0024: 複数人記載FAX検出機能](./0024-multi-customer-detection.md) — 自動複製の停止の経緯
- [ADR-0009: Feature Flags Per Client](./0009-feature-flags-per-client.md)
- `functions/src/ocr/faxDuplication.ts` / `functions/src/ocr/ocrProcessor.ts` — 既存の自動複製(流用元)
