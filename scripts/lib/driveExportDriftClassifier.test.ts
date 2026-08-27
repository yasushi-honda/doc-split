import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyDriftEvidence,
  summarizeClassifications,
  summarizeByCareManager,
} from './driveExportDriftClassifier';

test('classifyDriftEvidence: driveFileId欠損はno-drive-file-idでblocked', () => {
  const result = classifyDriftEvidence({
    driveFileId: null,
    fileGet: null,
    expectedLeafFolderId: 'leaf-1',
  });
  assert.deepEqual(result, { kind: 'blocked', reason: 'no-drive-file-id' });
});

test('classifyDriftEvidence: driveFileIdが空文字もno-drive-file-idでblocked', () => {
  const result = classifyDriftEvidence({
    driveFileId: '',
    fileGet: null,
    expectedLeafFolderId: 'leaf-1',
  });
  assert.deepEqual(result, { kind: 'blocked', reason: 'no-drive-file-id' });
});

test('classifyDriftEvidence: fileGetがapi-errorならapi-errorでblocked(detailにメッセージを保持)', () => {
  const result = classifyDriftEvidence({
    driveFileId: 'file-1',
    fileGet: { kind: 'api-error', errorMessage: 'status=403 Forbidden' },
    expectedLeafFolderId: 'leaf-1',
  });
  assert.deepEqual(result, { kind: 'blocked', reason: 'api-error', detail: 'status=403 Forbidden' });
});

test('classifyDriftEvidence: fileGetがnot-foundならmissing-404(isDriveFileNotFoundError===trueの場合のみ到達する経路)', () => {
  const result = classifyDriftEvidence({
    driveFileId: 'file-1',
    fileGet: { kind: 'not-found' },
    expectedLeafFolderId: 'leaf-1',
  });
  assert.deepEqual(result, { kind: 'classified', category: 'missing-404' });
});

test('classifyDriftEvidence: trashed===trueならtrashed(祖先継承によるtrashedも含む、parentsの中身は見ない)', () => {
  const result = classifyDriftEvidence({
    driveFileId: 'file-1',
    fileGet: { kind: 'ok', trashed: true, parents: ['old-parent'] },
    expectedLeafFolderId: 'leaf-1',
  });
  assert.deepEqual(result, { kind: 'classified', category: 'trashed' });
});

test('classifyDriftEvidence: trashed===trueかつparents空でもtrashed優先(trashed判定はparents有無より優先)', () => {
  const result = classifyDriftEvidence({
    driveFileId: 'file-1',
    fileGet: { kind: 'ok', trashed: true, parents: [] },
    expectedLeafFolderId: 'leaf-1',
  });
  assert.deepEqual(result, { kind: 'classified', category: 'trashed' });
});

test('classifyDriftEvidence: 非trashedでparents===[expectedLeafFolderId]ならhealthy', () => {
  const result = classifyDriftEvidence({
    driveFileId: 'file-1',
    fileGet: { kind: 'ok', trashed: false, parents: ['leaf-1'] },
    expectedLeafFolderId: 'leaf-1',
  });
  assert.deepEqual(result, { kind: 'classified', category: 'healthy' });
});

test('classifyDriftEvidence: 非trashedでparents[0]がexpectedLeafFolderIdと不一致ならmisplaced', () => {
  const result = classifyDriftEvidence({
    driveFileId: 'file-1',
    fileGet: { kind: 'ok', trashed: false, parents: ['other-folder'] },
    expectedLeafFolderId: 'leaf-1',
  });
  assert.deepEqual(result, { kind: 'classified', category: 'misplaced' });
});

test('classifyDriftEvidence: 非trashedでparentsが空配列ならmisplaced(codex review 12回目指摘: 本番resolveDriveFile()はparents件数に関わらずaddParents/removeParentsで無条件に修復可能なため、multi-parentを個別扱いせずmisplacedへ統合)', () => {
  const result = classifyDriftEvidence({
    driveFileId: 'file-1',
    fileGet: { kind: 'ok', trashed: false, parents: [] },
    expectedLeafFolderId: 'leaf-1',
  });
  assert.deepEqual(result, { kind: 'classified', category: 'misplaced' });
});

test('classifyDriftEvidence: 非trashedでparentsが2件以上でもmisplaced(本番のaddParents/removeParentsで単一parentへ正規化可能)', () => {
  const result = classifyDriftEvidence({
    driveFileId: 'file-1',
    fileGet: { kind: 'ok', trashed: false, parents: ['p1', 'p2'] },
    expectedLeafFolderId: 'leaf-1',
  });
  assert.deepEqual(result, { kind: 'classified', category: 'misplaced' });
});

test('classifyDriftEvidence: 非trashedでparentsが2件以上でもexpectedLeafFolderIdが含まれていればmisplaced(健全判定はparents.length===1の場合のみ)', () => {
  const result = classifyDriftEvidence({
    driveFileId: 'file-1',
    fileGet: { kind: 'ok', trashed: false, parents: ['leaf-1', 'p2'] },
    expectedLeafFolderId: 'leaf-1',
  });
  assert.deepEqual(result, { kind: 'classified', category: 'misplaced' });
});

test('classifyDriftEvidence: 非trashedでparentsがundefinedでもmisplaced(0件と同じ扱い)', () => {
  const result = classifyDriftEvidence({
    driveFileId: 'file-1',
    fileGet: { kind: 'ok', trashed: false, parents: undefined },
    expectedLeafFolderId: 'leaf-1',
  });
  assert.deepEqual(result, { kind: 'classified', category: 'misplaced' });
});

test('classifyDriftEvidence: expectedLeafFolderIdが空文字列(対象フォルダ未作成)ならmisplacedにせずtarget-path-not-createdでblocked', () => {
  const result = classifyDriftEvidence({
    driveFileId: 'file-1',
    fileGet: { kind: 'ok', trashed: false, parents: ['some-other-existing-folder'] },
    expectedLeafFolderId: '',
  });
  assert.deepEqual(result, { kind: 'blocked', reason: 'target-path-not-created' });
});

test('classifyDriftEvidence: expectedLeafFolderIdが空文字列でもtrashed判定はそのまま優先される', () => {
  const result = classifyDriftEvidence({
    driveFileId: 'file-1',
    fileGet: { kind: 'ok', trashed: true, parents: ['old-parent'] },
    expectedLeafFolderId: '',
  });
  assert.deepEqual(result, { kind: 'classified', category: 'trashed' });
});

test('classifyDriftEvidence: expectedLeafFolderIdが空文字列でもmissing-404判定はそのまま優先される', () => {
  const result = classifyDriftEvidence({
    driveFileId: 'file-1',
    fileGet: { kind: 'not-found' },
    expectedLeafFolderId: '',
  });
  assert.deepEqual(result, { kind: 'classified', category: 'missing-404' });
});

test('classifyDriftEvidence: driveFileIdありなのにfileGetがnullは呼び出し契約違反としてthrow', () => {
  assert.throws(
    () => classifyDriftEvidence({ driveFileId: 'file-1', fileGet: null, expectedLeafFolderId: 'leaf-1' }),
    /fileGet/
  );
});

test('summarizeClassifications: scanned = healthy+missing404+trashed+misplaced+blocked合計', () => {
  const summary = summarizeClassifications([
    { kind: 'classified', category: 'healthy' },
    { kind: 'classified', category: 'healthy' },
    { kind: 'classified', category: 'missing-404' },
    { kind: 'classified', category: 'trashed' },
    { kind: 'classified', category: 'misplaced' },
    { kind: 'blocked', reason: 'api-error', detail: 'x' },
    { kind: 'blocked', reason: 'no-drive-file-id' },
    { kind: 'blocked', reason: 'no-drive-file-id' },
  ]);
  assert.equal(summary.scanned, 8);
  assert.equal(summary.healthy, 2);
  assert.equal(summary.missing404, 1);
  assert.equal(summary.trashed, 1);
  assert.equal(summary.misplaced, 1);
  assert.equal(summary.blocked['api-error'], 1);
  assert.equal(summary.blocked['no-drive-file-id'], 2);
  assert.equal(summary.blocked['segment-unresolvable'], 0, '出現しなかったreasonも0で必ずキーを持つ(集計の網羅性)');
  assert.equal(summary.blocked['ambiguous-path'], 0);
  assert.equal(summary.blocked['customer-unconfirmed'], 0);
  assert.equal(summary.blocked['target-path-not-created'], 0);
});

test('summarizeClassifications: 空配列は全項目0', () => {
  const summary = summarizeClassifications([]);
  assert.equal(summary.scanned, 0);
  assert.equal(summary.healthy, 0);
  assert.equal(summary.missing404, 0);
  assert.equal(summary.trashed, 0);
  assert.equal(summary.misplaced, 0);
});

test('summarizeByCareManager: ケアマネ名ごとにグルーピングして集計する', () => {
  const rows = [
    { careManager: '森 奈穂美', classification: { kind: 'classified', category: 'healthy' } as const },
    { careManager: '森 奈穂美', classification: { kind: 'classified', category: 'trashed' } as const },
    { careManager: '山田 太郎', classification: { kind: 'classified', category: 'missing-404' } as const },
  ];
  const result = summarizeByCareManager(rows);
  assert.equal(result.length, 2);
  const mori = result.find((r) => r.careManager === '森 奈穂美');
  const yamada = result.find((r) => r.careManager === '山田 太郎');
  assert.ok(mori);
  assert.equal(mori!.scanned, 2);
  assert.equal(mori!.healthy, 1);
  assert.equal(mori!.trashed, 1);
  assert.ok(yamada);
  assert.equal(yamada!.scanned, 1);
  assert.equal(yamada!.missing404, 1);
});

test('summarizeByCareManager: 空配列は空配列を返す', () => {
  assert.deepEqual(summarizeByCareManager([]), []);
});
