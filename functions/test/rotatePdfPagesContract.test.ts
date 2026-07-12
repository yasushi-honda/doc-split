/**
 * rotatePdfPages の grep contract test (Issue #445 PR-D3)
 *
 * ADR-0016 MUST 3 「callable 内での旧 path 削除を行わない」「fileName identity 旧 path
 * 命名規則の禁止」を **source code レベルで構造的に契約化** する。コードに違反パターンが
 * 復活した場合に CI で検出可能にする。
 *
 * カバーする Acceptance Criteria:
 * - AC3 (拡張): file.delete / canSafelyDeleteStorageFile / `_r${timestamp}` / `_r\d+` 等の禁止
 * - AC4: rotation 結果 path は `processed/{docId}/rotations/{rotationId}.pdf` 形式
 * - AC11 例外: orphan rollback 専用の delete (rollbackOrphanRotation 関数内) のみ allowlist
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

// NodeNext ESM scope では __dirname 利用不可。npm test は cwd=functions 前提のため process.cwd() 経由で解決
const SOURCE_PATH = path.resolve(process.cwd(), 'src/pdf/pdfOperations.ts');

function extractRotatePdfPagesFunctionBody(): string {
  const content = fs.readFileSync(SOURCE_PATH, 'utf-8');
  // rotatePdfPages 関数の export 行から、対応する `);` までを抽出
  // パターン: `export const rotatePdfPages = onCall(` ... `);`
  const startMarker = 'export const rotatePdfPages = onCall(';
  const startIdx = content.indexOf(startMarker);
  expect(startIdx, 'rotatePdfPages 関数が見つからない').to.be.greaterThan(-1);

  // onCall の括弧バランスを追跡して関数本体終端を特定
  let depth = 0;
  let i = startIdx + startMarker.length - 1; // `(` 位置
  for (; i < content.length; i++) {
    if (content[i] === '(') depth++;
    else if (content[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  // 末尾 `;` を含めて終端
  const endIdx = content.indexOf(';', i) + 1;
  return content.slice(startIdx, endIdx);
}

function extractRollbackOrphanRotationFunctionBody(): string {
  const content = fs.readFileSync(SOURCE_PATH, 'utf-8');
  const startMarker = 'async function rollbackOrphanRotation(';
  const startIdx = content.indexOf(startMarker);
  expect(startIdx, 'rollbackOrphanRotation 関数が見つからない').to.be.greaterThan(-1);

  // Step 1: 引数リスト `(` の対応 `)` を括弧バランスで特定
  // (型注釈内の `{}` を関数本体と誤認識しないため)
  let parenDepth = 0;
  let i = startIdx + startMarker.length - 1; // `(` 位置
  for (; i < content.length; i++) {
    if (content[i] === '(') parenDepth++;
    else if (content[i] === ')') {
      parenDepth--;
      if (parenDepth === 0) break;
    }
  }
  // Step 2: `)` 以降の最初の `{` が関数本体開始
  const bodyStart = content.indexOf('{', i);
  let braceDepth = 0;
  let j = bodyStart;
  for (; j < content.length; j++) {
    if (content[j] === '{') braceDepth++;
    else if (content[j] === '}') {
      braceDepth--;
      if (braceDepth === 0) break;
    }
  }
  return content.slice(startIdx, j + 1);
}

describe('rotatePdfPages source code grep contract (PR-D3 AC3 拡張)', () => {
  let rotateBody: string;
  let fileContent: string;

  before(() => {
    rotateBody = extractRotatePdfPagesFunctionBody();
    fileContent = fs.readFileSync(SOURCE_PATH, 'utf-8');
  });

  describe('AC3: 旧 path 削除パターンの全面禁止 (rotatePdfPages 関数体内)', () => {
    it('`file.delete(` (旧 path delete) を含まない', () => {
      // rotateBody は rotatePdfPages 関数体のみ (helper 関数は除外済) なので
      // 純粋に delete 呼出が 0 件であることを確認
      const matches = rotateBody.match(/\bfile\.delete\(/g);
      expect(matches, '旧 file.delete( 呼出が rotatePdfPages 関数内に残存').to.be.null;
    });

    it('`newFile.delete(` 直接呼出を含まない (rollback は別 helper 経由)', () => {
      const matches = rotateBody.match(/\bnewFile\.delete\(/g);
      expect(matches, 'newFile.delete( 直接呼出が rotatePdfPages 関数内に残存').to.be.null;
    });

    it('`bucket.file(...).delete(` chain を含まない', () => {
      // 単純化: ".delete(" 文字列を含まない (rollbackOrphanRotation は別関数なので OK)
      const matches = rotateBody.match(/\.delete\(/g);
      expect(matches, '.delete( 呼出 chain が rotatePdfPages 関数内に残存').to.be.null;
    });

    it('`canSafelyDeleteStorageFile` への参照を含まない', () => {
      expect(rotateBody).to.not.include('canSafelyDeleteStorageFile');
    });
  });

  describe('AC3 拡張: 旧 fileName identity 命名規則の全面禁止', () => {
    it('`_r${timestamp}` テンプレート (旧 fileName suffix pattern) を含まない', () => {
      expect(rotateBody).to.not.include('_r${timestamp}');
      expect(rotateBody).to.not.match(/_r\$\{[^}]+\}/);
    });

    it('`filePath.replace(...)` で fileName を改変するパターンを含まない', () => {
      // 旧実装の `filePath.replace(/\.pdf$/i, `_r${timestamp}.pdf`)` を検出
      expect(rotateBody).to.not.match(/filePath\.replace\([^)]*_r/);
    });

    it('`Date.now()` を path 構築に使用しない (rotationId は randomUUID)', () => {
      // newObjectPath = `processed/${documentId}/rotations/${rotationId}.pdf` のように
      // Date.now() を path 内に直接埋め込まない
      // (timestamp ベースの path 命名は ADR-0016 違反)
      const datesNowMatches = rotateBody.match(/Date\.now\(\)/g);
      expect(datesNowMatches, 'Date.now() を path 構築に使用').to.be.null;
    });
  });

  describe('AC4: 新 canonical path 命名規則', () => {
    it('`processed/${documentId}/rotations/${rotationId}.pdf` 形式を使用', () => {
      expect(rotateBody).to.include('processed/${documentId}/rotations/${rotationId}.pdf');
    });

    it('rotationId は randomUUID で生成 (Node 内蔵 crypto)', () => {
      expect(rotateBody).to.include('randomUUID()');
    });
  });

  describe('PR-D2 同等の安全装置', () => {
    it('preconditionOpts.ifGenerationMatch: 0 を save に指定 (新規 object 保証)', () => {
      // newFile.save() options に preconditionOpts: { ifGenerationMatch: 0 } を含む
      expect(rotateBody).to.match(/preconditionOpts:\s*\{\s*ifGenerationMatch:\s*0\s*\}/);
    });

    it('Firestore docRef.update with lastUpdateTime precondition で optimistic locking を実施', () => {
      // EFF-M2 修正: runTransaction を撤廃し docRef.update(payload, { lastUpdateTime }) に変更
      // 理由: tx callback 内 throw が SDK 自動 retry を triggering する懸念を排除 + 1 read 節約
      expect(rotateBody).to.include('lastUpdateTime: startUpdateTime');
      // runTransaction を使用していないことの否定契約
      expect(rotateBody).to.not.include('db.runTransaction');
    });

    it('updateTime drift で HttpsError aborted を throw', () => {
      expect(rotateBody).to.include("'aborted'");
      expect(rotateBody).to.match(/Concurrent write detected/i);
    });

    it('NOT_FOUND (親doc削除) は Concurrent write と区別したメッセージになる (Issue #620)', () => {
      expect(rotateBody).to.match(/isFirestoreNotFound\(commitErr\)/);
      expect(rotateBody).to.match(/was deleted during processing/);
    });

    it('precondition mismatch 判定は splitPdf と共通の isFirestorePreconditionFailure ヘルパーを呼ぶ (Issue #539で共通化)', () => {
      // 判定ロジック自体は rotatePdfPages 関数体の外 (isFirestorePreconditionFailure) に
      // 抽出されているため、rotateBody からは呼出し箇所のみを検証する
      expect(rotateBody).to.match(/isFirestorePreconditionFailure\(commitErr\)/);
    });

    it('isFirestorePreconditionFailure: gRPC FAILED_PRECONDITION (code 9) / NOT_FOUND (code 5) を concurrent write として扱う', () => {
      // Firestore backend が precondition mismatch で発する gRPC code を catch して aborted に wrap
      expect(fileContent).to.match(/errCode === 9/);
      expect(fileContent).to.match(/errCode === 5/);
    });

    it('isFirestorePreconditionFailure: Cloud Functions 文字列 code (failed-precondition / not-found) も OR 判定対象 (Evaluator CRITICAL Q1 SDK 型変動防御)', () => {
      expect(fileContent).to.match(/errCode === ['"]failed-precondition['"]/);
      expect(fileContent).to.match(/errCode === ['"]not-found['"]/);
    });

    it('isFirestorePreconditionFailure: error.message regex fallback も OR 判定 (SDK 型変動の最終防御線)', () => {
      // FAILED_PRECONDITION / NOT_FOUND / precondition / no document to update のいずれか string match
      expect(fileContent).to.match(
        /FAILED_PRECONDITION\|NOT_FOUND\|precondition\|no document to update/
      );
    });

    it('rollback 失敗時に HttpsError details で rollbackFailed flag を露出する (silent-failure CRITICAL 2)', () => {
      expect(rotateBody).to.include('rollbackFailed: true');
      expect(rotateBody).to.include('orphanObjectPath');
    });

    it('入力 validation で pageNumber 整数性 + degrees enum を PDF download 前に検査 (code-reviewer Suggestion)', () => {
      expect(rotateBody).to.match(/Number\.isInteger\(r\.pageNumber\)/);
      expect(rotateBody).to.match(/r\.degrees !== 90 && r\.degrees !== 180 && r\.degrees !== 270/);
    });

    it('createRotationProvenance を呼出 (createSplitProvenance ではなく)', () => {
      expect(rotateBody).to.include('createRotationProvenance(');
      // createSplitProvenance は rotatePdfPages 関数体では呼ばない
      expect(rotateBody).to.not.include('createSplitProvenance(');
    });

    it('legacy provenance 無し doc を failed-precondition で reject (AC12)', () => {
      expect(rotateBody).to.include("'failed-precondition'");
      expect(rotateBody).to.match(/backfill required/i);
    });

    it('入力 validation: 空配列 + 同ページ重複を invalid-argument で reject (AC13)', () => {
      expect(rotateBody).to.match(/non-empty array/i);
      expect(rotateBody).to.match(/duplicate pageNumber/i);
    });

    it('Codex 2nd MEDIUM: fileUrl ↔ provenance.derivedObjectPath identity drift 検証 (Issue #432 root cause prevention)', () => {
      // AC15 (新規): identity 整合性検証で別 object 誤 rotate による silent provenance corruption を防止
      expect(rotateBody).to.match(/filePath !== baseProvenance\.derivedObjectPath/);
      expect(rotateBody).to.match(/identity drift detected/i);
    });

    it('Codex 2nd MEDIUM: download 後 buffer の sha256 と provenance.derivedSha256 照合 (bytes identity)', () => {
      // AC16 (新規): bytes identity check で path 一致 + bytes 改竄なしの両方を担保
      expect(rotateBody).to.match(/sha256Hex\(buffer\)/);
      expect(rotateBody).to.match(/baseProvenance\.derivedSha256\.toLowerCase\(\)/);
      expect(rotateBody).to.match(/bytes identity drift detected/i);
    });

    it('PR-D4 BF12/BF13: shouldRejectRotateForBackfill helper で provenanceBackfill gate を実装', () => {
      // ADR-0016 MUST 3 拡張: backfilled doc は confidence === derived-bytes-verified のみ allow。
      // pure helper 化 (Codex MCP 2nd review Suggestion 1 反映) で test/contract と production を共通化。
      expect(rotateBody).to.include('shouldRejectRotateForBackfill(');
      expect(rotateBody).to.include('startData.provenanceBackfill');
      expect(rotateBody).to.match(/backfill_confidence_check/);
    });

    it('PR-D4 Suggestion 2: rotate の docRef.update payload は provenanceBackfill を含まない (preserve contract)', () => {
      // update 対象 fields: fileUrl / pageRotations / rotatedAt / provenance のみ。
      // provenanceBackfill を update payload に入れると既存値を破壊するため、
      // 「rotate は provenanceBackfill を保持する (= update 対象外)」を構造的に契約化。
      const updateMatch = rotateBody.match(/docRef\.update\(\s*\{[\s\S]*?\}\s*,\s*\{\s*lastUpdateTime/);
      expect(updateMatch, 'docRef.update 呼出が見つからない').to.not.be.null;
      expect(updateMatch![0]).to.not.include('provenanceBackfill');
    });
  });
});

describe('rollbackOrphanRotation helper (AC11 例外)', () => {
  let rollbackBody: string;

  before(() => {
    rollbackBody = extractRollbackOrphanRotationFunctionBody();
  });

  it('newFile.delete() を呼ぶ (orphan rollback のみ allowlist)', () => {
    expect(rollbackBody).to.match(/newFile\.delete\(/);
  });

  it('ifGenerationMatch precondition を可能なら付与 (誤削除防止)', () => {
    expect(rollbackBody).to.include('ifGenerationMatch: derivedGeneration');
  });

  it('delete 失敗は warn log のみで throw しない (caller の元エラー保持)', () => {
    expect(rollbackBody).to.include('console.warn');
    expect(rollbackBody).to.match(/manualCleanupHint/);
    // throw キーワードが関数本体に存在しないことを確認
    expect(rollbackBody).to.not.match(/\bthrow\s+/);
  });
});

describe('mergeRotations helper (rotationMerge.ts に分離、test import 可能化)', () => {
  it('pdfOperations.ts から ./rotationMerge を import している', () => {
    const content = fs.readFileSync(SOURCE_PATH, 'utf-8');
    expect(content).to.match(/from\s+['"]\.\/rotationMerge['"]/);
    expect(content).to.match(/mergeRotations\b/);
  });

  it('mergeRotations は rotationMerge.ts で export されている (pure helper module)', () => {
    const rotationMergePath = path.resolve(process.cwd(), 'src/pdf/rotationMerge.ts');
    const content = fs.readFileSync(rotationMergePath, 'utf-8');
    expect(content).to.match(/^export function mergeRotations\(/m);
  });
});
