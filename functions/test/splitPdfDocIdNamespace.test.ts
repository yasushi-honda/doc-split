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
// ローカル import を追加することで Mocha esm-utils が CJS として load する
// (副作用ゼロの import: テスト本体は使わないが loader 推論用)
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
});

describe('splitPdf orphan cleanup 補償処理 (Issue #432 PR-B Codex 補強)', () => {
  it('Firestore set を try/catch でラップしている (補償処理の前提)', () => {
    // 'await newDocRef.set(' が try ブロック内に存在することの近傍チェック
    expect(content).to.match(/try\s*\{[\s\S]{0,2000}await newDocRef\.set\(/);
  });

  it('Firestore set 失敗時に Storage orphan cleanup を試行する', () => {
    expect(content).to.include('orphanCleanup');
    // newFile.delete() が catch ブロック内で呼ばれる (近傍チェック)
    expect(content).to.match(/catch\s*\(firestoreErr[\s\S]{0,2000}await newFile\.delete\(\)/);
  });

  it('orphan cleanup の構造化ログキー (Cloud Logging 監視 contract)', () => {
    expect(content).to.include("operation: 'splitPdf'");
    expect(content).to.match(/stage:\s*['"]firestoreSet['"]/);
    expect(content).to.match(/stage:\s*['"]orphanCleanup['"]/);
    expect(content).to.match(/cleanupResult:\s*['"]success['"]/);
    expect(content).to.match(/cleanupResult:\s*['"]failed['"]/);
  });

  it('Firestore set 失敗時に元の例外を caller に伝播する (silent failure 防止)', () => {
    // catch (firestoreErr) ブロックの末尾で throw firestoreErr する
    expect(content).to.match(/cleanupError[\s\S]{0,500}\}\);\s*\}\s*throw firestoreErr;/);
  });
});
