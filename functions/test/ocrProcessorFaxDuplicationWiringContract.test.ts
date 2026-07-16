/**
 * 複数顧客FAX複製機能(kanameone現場要件、GOAL.md D1-D5) 配線契約テスト
 *
 * processDocument()内の複製判定・書込みロジック本体はapplyOcrCompletionTransaction()に
 * 抽出済み(OCR/Storage副作用を含まないため、実際にIntegration testで直接呼び出して
 * 検証できる。ocrCompletionTransactionIntegration.test.ts参照)。本テストは
 * processDocument()がapplyOcrCompletionTransaction()を正しい順序・データで呼び出して
 * いること、および同関数内部の分岐構造をソース文字列レベルでlock-inする
 * (maintenanceGateWiringContract.test.tsと同方針)。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

// applyOcrCompletionTransaction(input: { ... 多数のフィールド ... }): Promise<void> { という
// シグネチャは `export async function applyOcrCompletionTransaction(` の直後にパラメータの
// 型注釈オブジェクトリテラル自体が `{` で始まるため、そのまま extractBraceBlock すると
// 関数本体ではなくパラメータ型ブロックを抽出してしまう。シグネチャ終端の一意な文字列
// `}): Promise<void> {` をanchorにして実際の関数本体の開始位置を特定する。
const TX_FN_BODY_ANCHOR = /\}\): Promise<void> \{/;

describe('processDocument() / applyOcrCompletionTransaction() faxDuplication配線契約 (GOAL.md D1-D5)', () => {
  const absPath = resolve(process.cwd(), 'src/ocr/ocrProcessor.ts');
  const source = readFileSync(absPath, 'utf-8');

  it('featureFlags/faxDuplicationからのimportが存在する', () => {
    expect(source).to.match(
      /import\s*\{\s*isFaxDuplicationEnabled\s*\}\s*from\s*'\.\.\/utils\/featureFlags'/
    );
    expect(source).to.match(
      /import\s*\{\s*planFaxDuplication,\s*buildFaxDuplicationMemberOverride\s*\}\s*from\s*'\.\/faxDuplication'/
    );
  });

  it('applyOcrCompletionTransaction()がexportされている', () => {
    expect(source).to.match(/export async function applyOcrCompletionTransaction\(/);
  });

  it('processDocument()/applyOcrCompletionTransaction()両関数本体を抽出できる', () => {
    const processDocumentBody = extractBraceBlock(source, /export async function processDocument\(/);
    const txFnBody = extractBraceBlock(source, TX_FN_BODY_ANCHOR);
    expect(processDocumentBody, 'processDocument本体の抽出に失敗した').to.not.be.null;
    expect(txFnBody, 'applyOcrCompletionTransaction本体の抽出に失敗した').to.not.be.null;
    // 誤ってパラメータ型ブロックを拾っていないことの回帰確認(本文にはtx.updateが必ず含まれる)
    expect(txFnBody).to.match(/tx\.update\(/);
  });

  it('flag読取(isFaxDuplicationEnabled)はapplyOcrCompletionTransaction呼出より前に1回だけ呼ばれる', () => {
    const processDocumentBody = extractBraceBlock(source, /export async function processDocument\(/)!;

    const flagCallCount = (processDocumentBody.match(/isFaxDuplicationEnabled\s*\(\s*db\s*\)/g) ?? []).length;
    expect(flagCallCount, 'isFaxDuplicationEnabled(db)呼出は1箇所のみのはず').to.equal(1);

    const flagIdx = processDocumentBody.search(/isFaxDuplicationEnabled\s*\(\s*db\s*\)/);
    const callIdx = processDocumentBody.search(/await applyOcrCompletionTransaction\(\{/);
    expect(flagIdx).to.be.greaterThan(-1);
    expect(callIdx).to.be.greaterThan(-1);
    expect(
      flagIdx,
      'flag読取はapplyOcrCompletionTransaction呼出より前でなければならない(トランザクション再試行毎の無駄な読取を避ける)'
    ).to.be.lessThan(callIdx);
  });

  it('processDocument()はfaxDuplicationEnabled/customerCandidates/fileDateFormattedをapplyOcrCompletionTransactionへ渡す', () => {
    const processDocumentBody = extractBraceBlock(source, /export async function processDocument\(/)!;
    // `await applyOcrCompletionTransaction({` のanchor自体が末尾に開き波括弧を含むため、
    // デフォルト(from-start)モードでそのままそこを開始位置として使う。
    const callAnchor = /await applyOcrCompletionTransaction\(\{/;
    const callArgs = extractBraceBlock(processDocumentBody, callAnchor);
    expect(callArgs, 'applyOcrCompletionTransaction呼出引数の抽出に失敗した').to.not.be.null;

    expect(callArgs).to.match(/faxDuplicationEnabled,/);
    expect(callArgs).to.match(/customerCandidates: customerResult\.candidates,/);
    expect(callArgs).to.match(/fileDateFormatted: dateResult\.formattedDate \?\? undefined,/);
  });

  it('複製判定(planFaxDuplication)はfreshData取得・存在チェックより後、confirmed保護マージ(merged)より後に呼ばれる', () => {
    const txFnBody = extractBraceBlock(source, TX_FN_BODY_ANCHOR)!;
    const txAnchor = /await db\.runTransaction\(async \(tx\) => \{/;
    const txBody = extractBraceBlock(txFnBody, txAnchor);
    expect(txBody, 'runTransactionハンドラ本体の抽出に失敗した').to.not.be.null;

    const freshDataIdx = txBody!.search(/const freshData = freshSnap\.data\(\)!;/);
    const mergedIdx = txBody!.search(/const merged = applyConfirmedFieldProtection\(/);
    const alreadyDistributedIdx = txBody!.search(/const alreadyDistributed =/);
    const planIdx = txBody!.search(/const distributionPlan = planFaxDuplication\(/);

    expect(freshDataIdx).to.be.greaterThan(-1);
    expect(mergedIdx).to.be.greaterThan(-1);
    expect(alreadyDistributedIdx).to.be.greaterThan(-1);
    expect(planIdx).to.be.greaterThan(-1);

    expect(alreadyDistributedIdx, 'alreadyDistributed判定はfreshData取得より後').to.be.greaterThan(freshDataIdx);
    expect(planIdx, '複製判定はconfirmed保護マージより後').to.be.greaterThan(mergedIdx);
  });

  it('alreadyDistributed判定はfreshData.distributionIdを参照する(AC-c: 再複製防止)', () => {
    expect(source).to.match(
      /const alreadyDistributed =\s*\n\s*typeof freshData\.distributionId === 'string' && freshData\.distributionId\.length > 0;/
    );
  });

  it('alreadyConfirmedOrVerified判定はfreshData.customerConfirmed/verifiedを参照し、planFaxDuplicationへ渡される(code-review high指摘: 確定済み割当の保護)', () => {
    expect(source).to.match(
      /const alreadyConfirmedOrVerified =\s*\n\s*freshData\.customerConfirmed === true \|\| freshData\.verified === true;/
    );

    const txFnBody = extractBraceBlock(source, TX_FN_BODY_ANCHOR)!;
    const txAnchor = /await db\.runTransaction\(async \(tx\) => \{/;
    const txBody = extractBraceBlock(txFnBody, txAnchor)!;
    const planCallArgs = extractBraceBlock(txBody, /const distributionPlan = planFaxDuplication\(\{/);
    expect(planCallArgs, 'planFaxDuplication呼出引数の抽出に失敗した').to.not.be.null;
    expect(planCallArgs).to.match(/alreadyConfirmedOrVerified,/);
  });

  it('複製時はtx.update(docRef)に続けてrestAssignments分のtx.set(newDocRef)を行い、既存の単一doc更新にfallthroughしない(return文で分岐)', () => {
    const txFnBody = extractBraceBlock(source, TX_FN_BODY_ANCHOR)!;
    const txAnchor = /await db\.runTransaction\(async \(tx\) => \{/;
    const txBody = extractBraceBlock(txFnBody, txAnchor)!;

    const ifAnchor = /if \(distributionPlan\.shouldDuplicate\) \{/;
    const ifBlock = extractBraceBlock(txBody, ifAnchor);
    expect(ifBlock, 'distributionPlan.shouldDuplicate分岐ブロックの抽出に失敗した').to.not.be.null;

    expect(ifBlock).to.match(/tx\.update\(docRef,/);
    expect(ifBlock).to.match(/for \(const assignment of restAssignments\)/);
    expect(ifBlock).to.match(/db\.collection\('documents'\)\.doc\(\)/);
    expect(ifBlock).to.match(/tx\.set\(newDocRef,/);
    expect(ifBlock).to.match(/tx\.set\(newDocRef\.collection\('detail'\)\.doc\('main'\),/);
    expect(ifBlock, '複製分岐は早期returnし、後続の単一doc用tx.updateへfallthroughしてはならない').to.match(
      /return;/
    );

    // fallback(既存の単一doc更新)がifブロック後にも存在すること自体は回帰確認(regression guard)
    const fallbackIdx = txBody.indexOf(ifBlock!) + ifBlock!.length;
    const fallbackRemainder = txBody.slice(fallbackIdx);
    expect(fallbackRemainder, '既存の単一doc更新フォールバックが残っていること').to.match(
      /tx\.update\(docRef, \{\s*\n\s*\.\.\.merged,/
    );
  });

  it('新規コピーはStorage実体を共有する(D2): fileId/fileUrl/mimeType/fileNameをfreshDataから引き継ぐ', () => {
    const txFnBody = extractBraceBlock(source, TX_FN_BODY_ANCHOR)!;
    const txAnchor = /await db\.runTransaction\(async \(tx\) => \{/;
    const txBody = extractBraceBlock(txFnBody, txAnchor)!;
    const ifAnchor = /if \(distributionPlan\.shouldDuplicate\) \{/;
    const ifBlock = extractBraceBlock(txBody, ifAnchor)!;

    expect(ifBlock).to.match(/fileId: freshData\.fileId,/);
    expect(ifBlock).to.match(/fileUrl: freshData\.fileUrl,/);
    expect(ifBlock).to.match(/mimeType: freshData\.mimeType,/);
    expect(ifBlock).to.match(/fileName: freshData\.fileName,/);
  });

  it('offload済みOCR結果(ocrResultUrl)は各コピー自身のdocId配下へ複製し、元docのURLをそのまま共有しない(Codexセカンドオピニオン指摘P1: 元docの再処理でIssue #625 cleanupがコピー分も削除してしまう問題の修正)', () => {
    expect(source).to.match(
      /async function copyOcrResultForDistributionMember\(/,
      'copyOcrResultForDistributionMember関数が定義されていること'
    );
    const helperBody = extractBraceBlock(source, /async function copyOcrResultForDistributionMember\(/)!;
    expect(helperBody, 'copyOcrResultForDistributionMember本体の抽出に失敗した').to.not.be.null;
    expect(helperBody).to.match(/bucket\.file\(sourcePath\)\.copy\(bucket\.file\(destPath\)\)/);
    expect(helperBody).to.match(/ocr-results\/\$\{newDocId\}\/\$\{ocrRunId\}\.txt/);

    const txFnBody = extractBraceBlock(source, TX_FN_BODY_ANCHOR)!;
    const txAnchor = /await db\.runTransaction\(async \(tx\) => \{/;
    const txBody = extractBraceBlock(txFnBody, txAnchor)!;
    const ifAnchor = /if \(distributionPlan\.shouldDuplicate\) \{/;
    const ifBlock = extractBraceBlock(txBody, ifAnchor)!;
    const loopAnchor = /for \(const assignment of restAssignments\) \{/;
    const loopBlock = extractBraceBlock(ifBlock, loopAnchor);
    expect(loopBlock, 'restAssignmentsループ本体の抽出に失敗した').to.not.be.null;

    expect(loopBlock, 'merged.ocrResultUrlが設定されている場合のみ複製呼出しを行うこと').to.match(
      /merged\.ocrResultUrl\s*\n?\s*\? await copyOcrResultForDistributionMember\(/
    );
    expect(loopBlock, '複製先はnewDocRef.id(そのコピー自身のdocId)配下であること').to.match(
      /newDocRef\.id,\s*\n\s*ownershipExpectation\.ocrRunId/
    );
    expect(
      loopBlock,
      'memberFieldsのocrResultUrlは元docと共有のmergedの値ではなく、複製後の新URLで上書きされること'
    ).to.match(/ocrResultUrl: memberOcrResultUrl,/);
  });
});
