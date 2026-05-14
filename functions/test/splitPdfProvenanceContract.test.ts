/**
 * splitPdf provenance 書込パターン契約テスト (Issue #445 PR-D2)
 *
 * 目的: ADR-0016 MUST 2 (10 fields 必須) / MUST 5 (read snapshot 整合) の実装が
 * splitPdf 内で恒久的に守られることを source grep で lock-in する。
 *
 * Codex MCP review Low 3 指摘:「createSplitProvenance( 呼び出し、10 field mapping、
 * processed/${newDocRef.id}/ 由来の derivedObjectPath まで固定した方が価値がある」を反映。
 *
 * 方式: splitPdfPayloadContract.test.ts と同形式の grep-based contract。
 * 実 emulator での 10 fields 完備 / drift retry / orphan 0 件 は別 integration test で検証。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
// 相対 import で ts-node の CJS resolution を維持 (純粋 package import のみだと
// node が ESM 自動判定して __dirname が undefined になる)。
// 検証対象モジュールの import なので semantic にも自然。
import { ProvenanceValidationError as _AnchorImport } from '../src/pdf/provenance';

const SOURCE_PATH = 'src/pdf/pdfOperations.ts';
void _AnchorImport;

let sourceText = '';

describe('splitPdf provenance 書込契約 (Issue #445 PR-D2 AC6 + Codex L3)', () => {
  before(() => {
    const path = resolve(__dirname, '..', SOURCE_PATH);
    if (!existsSync(path)) {
      throw new Error(`Source file not found: ${SOURCE_PATH}`);
    }
    sourceText = readFileSync(path, 'utf-8');
  });

  it('createSplitProvenance を provenance/splitSnapshot helper として import している', () => {
    // PR-D3 (#445) で createRotationProvenance が同一 import 文に併記されたため、
    // 単独形式 `{ createSplitProvenance }` ではなく `{ createSplitProvenance[, ...] }` を許容
    expect(sourceText).to.match(
      /import\s*\{[^}]*\bcreateSplitProvenance\b[^}]*\}\s*from\s*['"]\.\/provenance['"]/
    );
  });

  it('splitSnapshot helpers を import している (acquireSourceSnapshot / verifyFinalDrift / parseGcsUri / backoffSleep / SourceDriftError)', () => {
    expect(sourceText).to.match(/SourceDriftError/);
    expect(sourceText).to.match(/acquireSourceSnapshot/);
    expect(sourceText).to.match(/verifyFinalDrift/);
    expect(sourceText).to.match(/parseGcsUri/);
    expect(sourceText).to.match(/backoffSleep/);
  });

  it('splitPdf 内で createSplitProvenance( を 1 箇所以上呼出している', () => {
    const matches = sourceText.match(/createSplitProvenance\s*\(/g) ?? [];
    expect(matches.length, 'createSplitProvenance must be called').to.be.at.least(1);
  });

  it('createSplitProvenance 呼出 block 内に 9 個の input fields が全て含まれる (createdAt は省略可)', () => {
    // createSplitProvenance({ ... }) の中身を非貪欲に抽出
    const block = sourceText.match(/createSplitProvenance\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    expect(block, 'createSplitProvenance({...}) block must exist').to.not.be.null;
    const body = block![1];
    for (const field of [
      'sourceGeneration',
      'sourceMetageneration',
      'sourceSha256',
      'sourcePath',
      'sourceBucket',
      'derivedObjectPath',
      'derivedGeneration',
      'derivedMetageneration',
      'derivedSha256',
    ]) {
      expect(body, `createSplitProvenance must include ${field}`).to.match(
        new RegExp(`\\b${field}\\s*[:,]`)
      );
    }
  });

  it('derivedObjectPath は processed/${docId}/${fileName} 形式を維持している', () => {
    // newFilePath assignment が `processed/${...id}/${fileName}` パターン
    expect(sourceText).to.match(
      /newFilePath\s*=\s*`processed\/\$\{[^}]*newDocRef\.id[^`]*\}\/\$\{fileName\}`/
    );
  });

  it('source\\* snapshot 取得は acquireSourceSnapshot helper 経由で 3-stage 実装されている (ADR MUST 5 / Codex H1)', () => {
    // splitPdf 側で helper 呼出
    expect(sourceText).to.match(/await\s+acquireSourceSnapshot\(file\)/);
    // splitSnapshot.ts 側で 3-stage (getMetadata → download → getMetadata) 実装
    const snapshotPath = resolve(__dirname, '..', 'src/pdf/splitSnapshot.ts');
    const snapshotText = readFileSync(snapshotPath, 'utf-8');
    const threeStage = snapshotText.match(
      /file\.getMetadata\(\)[\s\S]*?file\.download\(\)[\s\S]*?file\.getMetadata\(\)/
    );
    expect(
      threeStage,
      '3-stage metadata-download-metadata in splitSnapshot.ts must exist'
    ).to.not.be.null;
  });

  it('source sha256 は実際の download buffer から compute している (ADR MUST 5)', () => {
    // sha256Hex(buffer) で download した buffer から compute
    expect(sourceText).to.match(/sha256Hex\(buffer\)/);
  });

  it('derived sha256 は newPdfBytes (pdf-lib 出力) から compute している', () => {
    // sha256Hex(newPdfBytes) を直接呼出 (Buffer.from で 2 重 allocate しない)
    expect(sourceText).to.match(/sha256Hex\(newPdfBytes\)/);
  });

  it('sha256 計算は共通 helper sha256Hex を経由する (inline crypto.createHash 禁止)', () => {
    expect(sourceText).to.match(/import\s*\{\s*sha256Hex\s*\}\s*from\s*['"]\.\.\/utils\/hash['"]/);
    // pdfOperations.ts 内で inline createHash('sha256') を直接呼ばない (重複排除)
    expect(sourceText).not.to.match(/crypto\.createHash\(['"]sha256['"]\)/);
  });

  it('Firestore は db.batch() で原子書込している (Codex H3 反映: partial state 排除)', () => {
    expect(sourceText).to.match(/db\.batch\(\)/);
    expect(sourceText).to.match(/batch\.set\(/);
    expect(sourceText).to.match(/batch\.commit\(\)/);
  });

  it('drift cleanup は ifGenerationMatch precondition を使っている (Codex M3)', () => {
    expect(sourceText).to.match(/ifGenerationMatch\s*:\s*(item\.)?derivedGeneration/);
  });

  it('retry 間に backoffSleep を実施している (Codex M2)', () => {
    expect(sourceText).to.match(/await\s+backoffSleep\(/);
  });

  it('parseGcsUri で bucket mismatch を failed-precondition に変換している (Codex M1)', () => {
    expect(sourceText).to.match(/parseGcsUri\(/);
    expect(sourceText).to.match(
      /HttpsError\(\s*['"]failed-precondition['"][\s\S]*?gs:\/\//
    );
  });

  it('drift 検出時の HttpsError は aborted code で投げられる', () => {
    expect(sourceText).to.match(
      /HttpsError\(\s*['"]aborted['"][\s\S]*?concurrent write detected/
    );
  });

  it('segments runtime 検証で startPage/endPage 範囲を invalid-argument で弾く (Codex L2)', () => {
    expect(sourceText).to.match(
      /HttpsError\(\s*['"]invalid-argument['"][\s\S]*?segments\[/
    );
  });
});
