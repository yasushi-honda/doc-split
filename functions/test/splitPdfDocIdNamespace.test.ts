/**
 * splitPdf docId namespace 設計の grep contract テスト (Issue #432 PR-B)
 *
 * Storage path 衝突を根治する docId namespace 分離 (processed/{docId}/{fileName})
 * と、Storage save 成功 → Firestore set 失敗時の orphan cleanup 補償処理を、
 * リファクタで silently 退化させないために grep で固定する。
 *
 * splitPdf は副作用が大きく (pdf-lib / Storage / Firestore) emulator + Storage
 * emulator + pdf-lib 依存のため、純粋関数化が困難。grep contract で設計意図を保護。
 *
 * 実体動作の AC 検証 (path 衝突なし / 旧 path doc の rotate/delete 動作) は
 * dev/kanameone の実環境ログで観測 (PR-A safety net 構造化ログを併用)。
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
// 削除すると Mocha esm-utils がこのファイルを ESM として load し、
// `ReferenceError: __dirname is not defined in ES module scope` で test 全体が
// load 失敗する (NodeNext + ローカル import なし時の挙動)。
// 副作用ゼロの local import を 1 つ追加することで CJS loader に推論させる workaround。
// PR-A の helper を選んだ理由: 同 Issue (#432) に直接関連 + 安定実装で削除/移動リスク低。
import '../src/storage/storageDeletionGuard';

const sourcePath = path.resolve(process.cwd(), 'src/pdf/pdfOperations.ts');
const content = fs.readFileSync(sourcePath, 'utf-8');

describe('splitPdf docId namespace 設計 (Issue #432 PR-B 衝突根治)', () => {
  it('Storage path に docId namespace を含む (processed/${newDocRef.id}/${fileName} 形式)', () => {
    expect(content).to.match(/processed\/\$\{newDocRef\.id\}\//);
  });

  it('旧 path 形式 processed/${fileName} (docId namespace なし) を直接書かない', () => {
    // processed/${fileName} 直書きは衝突回避の責務を負わない設計欠陥のため禁止
    expect(content).not.to.match(/['"`]processed\/\$\{fileName\}/);
  });

  it('newDocRef は Storage save 前に作成される (docId を path 採番に組み込む前提)', () => {
    const newDocRefIdx = content.indexOf('const newDocRef = db.collection');
    const newPathIdx = content.indexOf('processed/${newDocRef.id}/');
    expect(newDocRefIdx).to.be.greaterThan(-1, 'newDocRef declaration not found');
    expect(newPathIdx).to.be.greaterThan(-1, 'docId namespace path not found');
    expect(newDocRefIdx).to.be.lessThan(
      newPathIdx,
      'newDocRef must be declared before Storage path uses its id'
    );
  });

  it('newDocRef は for-loop 内で宣言される (segment ごとに独立した docId 確保)', () => {
    // hoist されると全 segment が同 docId → 同 path を共有 → 衝突再発 (#432 回帰)
    const loopIdx = content.indexOf('for (const segment of segments)');
    const newDocRefIdx = content.indexOf('const newDocRef = db.collection');
    expect(loopIdx).to.be.greaterThan(-1, 'segments loop not found');
    expect(newDocRefIdx).to.be.greaterThan(
      loopIdx,
      'newDocRef must be declared inside the segment loop, not hoisted'
    );
  });

  it('Firestore fileUrl は newFilePath 変数から構築される (path の二重定義による silent 不整合を防ぐ)', () => {
    // gs://bucket/processed/{fileName} 等を直接 fileUrl に書くと Storage save path と乖離して silent 破壊
    expect(content).to.match(/fileUrl:\s*`gs:\/\/\$\{bucket\.name\}\/\$\{newFilePath\}`/);
  });
});

describe('splitPdf cleanup / atomic write 設計 (Issue #445 PR-D2 atomic batch)', () => {
  it('Firestore 書込は db.batch().commit() で atomic (Codex H3: partial state 排除)', () => {
    // 個別 newDocRef.set() ループは PR-D2 で廃止し、accumulated payload を batch で一括書込
    expect(content).to.match(/const\s+batch\s*=\s*db\.batch\(\)/);
    expect(content).to.match(/batch\.set\(item\.newDocRef/);
    expect(content).to.match(/await\s+batch\.commit\(\)/);
  });

  it('segments を一旦 accumulate してから batch 書込する (atomic 化の前提)', () => {
    // accumulated: AccumulatedSegment[] を build → final drift check 通過後 batch.commit
    expect(content).to.match(/const\s+accumulated\s*:\s*AccumulatedSegment\[\]/);
    expect(content).to.match(/accumulated\.push\(/);
  });

  it('drift / batch 失敗時の Storage cleanup は専用 helper で実行する', () => {
    expect(content).to.include('cleanupAccumulatedStorageFiles');
    // Promise.allSettled で best-effort
    expect(content).to.match(/Promise\.allSettled/);
  });

  it('cleanup は ifGenerationMatch precondition で誤削除を防ぐ (Codex M3)', () => {
    expect(content).to.match(/ifGenerationMatch\s*:\s*item\.derivedGeneration/);
  });

  it('cleanup helper の構造化ログキー (Cloud Logging 監視 contract)', () => {
    expect(content).to.include("operation: 'splitPdf'");
    // 3 つの cleanup 発火 stage を区別できる
    expect(content).to.match(/stage:\s*['"]segmentsLoop['"]/);
    expect(content).to.match(/stage:\s*['"]finalDrift['"]/);
    expect(content).to.match(/stage:\s*['"]firestoreBatch['"]/);
    // 失敗件数 + manual cleanup hint
    expect(content).to.match(/failedCount/);
    expect(content).to.match(/manualCleanupHint/);
  });

  it('Firestore batch 失敗時は HttpsError(internal) で原因 message を client へ surface する (/review-pr silent-failure-hunter C1)', () => {
    // 旧: throw wrapped (Error.cause) → INTERNAL に潰れる
    // 新: throw new HttpsError('internal', ...message + originalErr.message..., { stage: 'firestoreBatch', ... })
    // Issue #539: errMessage = unwrapErrorMessage(firestoreErr) の中間変数経由になったため
    // firestoreErr直接参照ではなく errMessage を検索する (値の由来は unwrapErrorMessage(firestoreErr) 呼出で保証)
    expect(content).to.match(/const errMessage = unwrapErrorMessage\(firestoreErr\)/);
    expect(content).to.match(/HttpsError\(\s*['"]internal['"][\s\S]{0,400}errMessage/);
    expect(content).to.match(/stage:\s*['"]firestoreBatch['"]/);
  });

  it('Firestore batch commit の precondition mismatch (二重split race) は HttpsError(aborted) で区別される (Issue #539)', () => {
    expect(content).to.match(/isFirestorePreconditionFailure\(firestoreErr\)/);
    expect(content).to.match(
      /HttpsError\(\s*['"]aborted['"][\s\S]{0,200}concurrent split detected/
    );
  });

  it('drift 検出時は HttpsError aborted で投げ retry max 後に最終 fail する', () => {
    expect(content).to.match(
      /HttpsError\(\s*['"]aborted['"][\s\S]{0,200}concurrent write detected/
    );
    expect(content).to.match(/MAX_RETRIES\s*=\s*2/);
  });
});
