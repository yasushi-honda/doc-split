/**
 * 集計所属変更メンテナンスゲート 配線契約テスト (GOAL.md タスクG)
 *
 * OCR完了処理(processOCR.ts)・split(pdfOperations.ts)・顧客マスター同期
 * (syncCareManager.ts)の各書込み経路が、実際の集計対象フィールド確定処理より前に
 * isGroupAggregationGateOpen()のチェックを挟んでいることをソース文字列レベルで
 * lock-inする。これらの経路はOCR/PDF/外部API副作用が大きく直接呼び出せないため
 * (ocrProcessorEarlyOwnershipCheckWiringContract.test.ts等と同方針)、判定ロジック自体の
 * 動作は maintenanceGateIntegration.test.ts (emulator) で検証する。
 */

import { expect } from 'chai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock, extractParenBlock } from './helpers/extractBraceBlock';

const GATE_CHECK_PATTERN = /isGroupAggregationGateOpen\s*\(/;

function expectSingleDefinition(source: string, pattern: RegExp, label: string): void {
  const count = (source.match(pattern) ?? []).length;
  expect(count, `${label} の定義が複数存在する場合は anchor の narrow が必要`).to.equal(1);
}

describe('集計所属変更メンテナンスゲート配線契約 (GOAL.md タスクG)', () => {
  it('processOCR.ts: スケジュール実行ハンドラの先頭でゲートを確認する', () => {
    const absPath = resolve(process.cwd(), 'src/ocr/processOCR.ts');
    const source = readFileSync(absPath, 'utf-8');

    const importPattern = /import\s*\{\s*isGroupAggregationGateOpen\s*\}\s*from\s*'\.\.\/utils\/maintenanceGate'/;
    expect(source, 'maintenanceGateからのimportが必要').to.match(importPattern);

    // onSchedule(第1引数: optionsオブジェクト, 第2引数: asyncハンドラ)のうち、
    // 第2引数のハンドラ本体自体を抽出する(optionsオブジェクトの{}を誤って拾わないよう、
    // async () => { のasyncキーワード位置をanchorにする)
    expectSingleDefinition(source, /export const processOCR = onSchedule\(/g, 'processOCR');
    const handlerAnchor = /async \(\) => \{/;
    const handlerBody = extractBraceBlock(source, handlerAnchor);
    expect(handlerBody, 'processOCRハンドラ本体の抽出に失敗した').to.not.be.null;
    expect(handlerBody, 'ハンドラ内でゲートチェックが呼ばれていない').to.match(GATE_CHECK_PATTERN);

    // ゲートチェックがpending文書取得クエリより前に配置されていること
    // (取得後にチェックすると、無駄なFirestore読み取り+ゲート閉中もrescue処理が走ってしまう)
    const gateCheckIdx = handlerBody!.search(GATE_CHECK_PATTERN);
    const pendingQueryIdx = handlerBody!.search(/status',\s*'==',\s*'pending'/);
    expect(gateCheckIdx).to.be.greaterThan(-1);
    expect(pendingQueryIdx).to.be.greaterThan(-1);
    expect(gateCheckIdx, 'ゲートチェックはpending文書取得クエリより前に配置する').to.be.lessThan(pendingQueryIdx);
  });

  it('syncCareManager.ts: onCustomerMasterWriteの先頭でゲートを確認する', () => {
    const absPath = resolve(process.cwd(), 'src/triggers/syncCareManager.ts');
    const source = readFileSync(absPath, 'utf-8');

    const importPattern = /import\s*\{\s*isGroupAggregationGateOpen\s*\}\s*from\s*'\.\.\/utils\/maintenanceGate'/;
    expect(source, 'maintenanceGateからのimportが必要').to.match(importPattern);

    expectSingleDefinition(source, /export const onCustomerMasterWrite = onDocumentWritten\(/g, 'onCustomerMasterWrite');
    const handlerAnchor = /async \(event\) => \{/;
    const handlerBody = extractBraceBlock(source, handlerAnchor);
    expect(handlerBody, 'onCustomerMasterWriteハンドラ本体の抽出に失敗した').to.not.be.null;
    expect(handlerBody, 'ハンドラ内でゲートチェックが呼ばれていない').to.match(GATE_CHECK_PATTERN);

    // ゲートチェックがdocuments一括更新(batch)より前に配置されていること
    const gateCheckIdx = handlerBody!.search(GATE_CHECK_PATTERN);
    const batchIdx = handlerBody!.search(/db\.batch\(\)/);
    expect(gateCheckIdx).to.be.greaterThan(-1);
    expect(batchIdx).to.be.greaterThan(-1);
    expect(gateCheckIdx, 'ゲートチェックはdocuments一括更新より前に配置する').to.be.lessThan(batchIdx);
  });

  it('pdfOperations.ts: splitPdfの先頭(バリデーション後・重い処理の前)でゲートを確認する', () => {
    const absPath = resolve(process.cwd(), 'src/pdf/pdfOperations.ts');
    const source = readFileSync(absPath, 'utf-8');

    const importPattern = /import\s*\{\s*isGroupAggregationGateOpen\s*\}\s*from\s*'\.\.\/utils\/maintenanceGate'/;
    expect(source, 'maintenanceGateからのimportが必要').to.match(importPattern);

    // splitPdfのonCall(...)呼出全体をまずスコープとして切り出す(async (request) => { は
    // ファイル内に他のonCallハンドラでも複数出現するため、splitPdf自身の範囲に絞ってから
    // 内部でハンドラ本体を探す)
    expectSingleDefinition(source, /export const splitPdf = onCall\(/g, 'splitPdf');
    const outerAnchor = /export const splitPdf = onCall\(/;
    const outerBlock = extractParenBlock(source, outerAnchor);
    expect(outerBlock, 'splitPdfのonCall(...)呼出全体の抽出に失敗した').to.not.be.null;

    const handlerAnchor = /async \(request\) => \{/;
    const handlerBody = extractBraceBlock(outerBlock, handlerAnchor);
    expect(handlerBody, 'splitPdfハンドラ本体の抽出に失敗した').to.not.be.null;
    expect(handlerBody, 'ハンドラ内でゲートチェックが呼ばれていない').to.match(GATE_CHECK_PATTERN);

    // ゲートチェックが認証・ホワイトリスト確認より後、実際のPDF分割処理(pdf-lib読込)より前に
    // 配置されていること(未認証ユーザーにゲート状態を漏らさない、かつ無駄な重い処理を避ける)
    const authIdx = handlerBody!.search(/permission-denied/);
    const gateCheckIdx = handlerBody!.search(GATE_CHECK_PATTERN);
    const heavyWorkIdx = handlerBody!.search(/PDFDocument\.load/);
    expect(authIdx).to.be.greaterThan(-1);
    expect(gateCheckIdx).to.be.greaterThan(-1);
    expect(gateCheckIdx, 'ゲートチェックは認証チェックより後に配置する').to.be.greaterThan(authIdx);
    if (heavyWorkIdx > -1) {
      expect(gateCheckIdx, 'ゲートチェックはPDF読込等の重い処理より前に配置する').to.be.lessThan(heavyWorkIdx);
    }
  });
});
