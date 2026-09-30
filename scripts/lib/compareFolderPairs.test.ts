/**
 * `scripts/lib/compareFolderPairs.ts` の単体テスト
 *
 * Drive APIにもfirebase-adminにも依存しない純関数のため、emulator不要。
 *
 * 実行: cd scripts && npm test (node --test lib/*.test.ts)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareFolderChildren, deriveCaveats, type FolderChild } from './compareFolderPairs';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const PDF_MIME = 'application/pdf';
const DOC_MIME = 'application/vnd.google-apps.document';

function file(name: string, md5: string | null, mimeType = PDF_MIME): FolderChild {
  return { name, mimeType, md5Checksum: md5 };
}

test('両方空フォルダは全件0', () => {
  const r = compareFolderChildren([], []);
  assert.deepEqual(r, {
    aFileCount: 0,
    bFileCount: 0,
    aChildFolderCount: 0,
    bChildFolderCount: 0,
    both: 0,
    onlyA: 0,
    onlyB: 0,
    matchedByMd5: 0,
    matchedByNameAndMime: 0,
    childFolderNames: { both: 0, onlyA: 0, onlyB: 0, bothIgnoringSpaces: 0 },
  });
});

test('片方だけ空: 空でない側の全件がonlyになる', () => {
  const r = compareFolderChildren([file('a.pdf', 'm1'), file('b.pdf', 'm2')], []);
  assert.equal(r.onlyA, 2);
  assert.equal(r.onlyB, 0);
  assert.equal(r.both, 0);
});

test('md5が同じなら名前が違っても同一ファイルとして扱う', () => {
  const r = compareFolderChildren([file('新しい名前.pdf', 'same')], [file('古い名前.pdf', 'same')]);
  assert.equal(r.both, 1);
  assert.equal(r.onlyA, 0);
  assert.equal(r.onlyB, 0);
  assert.equal(r.matchedByMd5, 1);
  assert.equal(r.matchedByNameAndMime, 0);
});

test('md5が違えば名前が同じでも別ファイル(内容が異なる)', () => {
  const r = compareFolderChildren([file('a.pdf', 'm1')], [file('a.pdf', 'm2')]);
  assert.equal(r.both, 0);
  assert.equal(r.onlyA, 1);
  assert.equal(r.onlyB, 1);
});

test('md5が無いファイル(Googleドキュメント等)は名前+mimeTypeで照合する', () => {
  const r = compareFolderChildren([file('議事録', null, DOC_MIME)], [file('議事録', null, DOC_MIME)]);
  assert.equal(r.both, 1);
  assert.equal(r.matchedByNameAndMime, 1);
  assert.equal(r.matchedByMd5, 0);
});

test('md5が無く名前は同じでもmimeTypeが違えば別ファイル', () => {
  const r = compareFolderChildren([file('x', null, DOC_MIME)], [file('x', null, 'application/vnd.google-apps.spreadsheet')]);
  assert.equal(r.both, 0);
  assert.equal(r.onlyA, 1);
  assert.equal(r.onlyB, 1);
});

test('同一md5が複数ある場合は多重度で照合する(A側2件・B側1件 → 1件一致・A側のみ1件)', () => {
  const r = compareFolderChildren([file('a1.pdf', 'dup'), file('a2.pdf', 'dup')], [file('b.pdf', 'dup')]);
  assert.equal(r.both, 1);
  assert.equal(r.onlyA, 1);
  assert.equal(r.onlyB, 0);
});

test('md5の有無が混在しても互いに混線しない', () => {
  const r = compareFolderChildren(
    [file('a.pdf', 'm1'), file('議事録', null, DOC_MIME)],
    [file('a-renamed.pdf', 'm1'), file('議事録', null, DOC_MIME), file('only-b.pdf', 'm9')],
  );
  assert.equal(r.both, 2);
  assert.equal(r.onlyA, 0);
  assert.equal(r.onlyB, 1);
  assert.equal(r.matchedByMd5, 1);
  assert.equal(r.matchedByNameAndMime, 1);
});

test('子フォルダは照合対象外で件数だけ数える(ファイル件数に含めない)', () => {
  const sub: FolderChild = { name: 'sub', mimeType: FOLDER_MIME, md5Checksum: null };
  const r = compareFolderChildren([file('a.pdf', 'm1'), sub], [sub, sub]);
  assert.equal(r.aFileCount, 1);
  assert.equal(r.bFileCount, 0);
  assert.equal(r.aChildFolderCount, 1);
  assert.equal(r.bChildFolderCount, 2);
  assert.equal(r.onlyA, 1);
});

test('結果にファイル名が含まれない(PII対策)', () => {
  const r = compareFolderChildren([file('山田太郎_ケアプラン.pdf', 'm1')], [file('山田太郎_ケアプラン.pdf', 'm2')]);
  assert.equal(JSON.stringify(r).includes('山田太郎'), false);
});

test('md5が空文字・undefinedでもmd5無しとして名前+mimeTypeで照合する', () => {
  const emptyMd5: FolderChild = { name: 'x', mimeType: PDF_MIME, md5Checksum: '' };
  const noMd5Prop: FolderChild = { name: 'x', mimeType: PDF_MIME };
  const r = compareFolderChildren([emptyMd5], [noMd5Prop]);
  assert.equal(r.both, 1);
  assert.equal(r.matchedByNameAndMime, 1);
  assert.equal(r.matchedByMd5, 0);
});

test('同名でも片方md5あり・片方md5無しは別ファイル扱い(内容確認不能なので保守的に片側のみ)', () => {
  const r = compareFolderChildren([file('x', 'm1')], [file('x', null)]);
  assert.equal(r.both, 0);
  assert.equal(r.onlyA, 1);
  assert.equal(r.onlyB, 1);
});

test('deriveCaveats: 名前+mimeType一致があればweak-match(内容未検証)を付ける', () => {
  const r = compareFolderChildren([file('議事録', null, DOC_MIME)], [file('議事録', null, DOC_MIME)]);
  assert.deepEqual(deriveCaveats(r), ['weak-match']);
});

test('deriveCaveats: 子フォルダがあればhas-child-folders(中身は未照合)を付ける', () => {
  const sub: FolderChild = { name: 'sub', mimeType: FOLDER_MIME, md5Checksum: null };
  assert.deepEqual(deriveCaveats(compareFolderChildren([file('a.pdf', 'm1'), sub], [file('a.pdf', 'm1')])), [
    'has-child-folders',
  ]);
  // B側にだけ子フォルダがある場合も付く
  assert.deepEqual(deriveCaveats(compareFolderChildren([file('a.pdf', 'm1')], [file('a.pdf', 'm1'), sub])), [
    'has-child-folders',
  ]);
});

test('deriveCaveats: 両方あれば両方付き、何も無ければ空配列', () => {
  const sub: FolderChild = { name: 'sub', mimeType: FOLDER_MIME, md5Checksum: null };
  const both = compareFolderChildren([file('d', null, DOC_MIME), sub], [file('d', null, DOC_MIME)]);
  assert.deepEqual(deriveCaveats(both), ['weak-match', 'has-child-folders']);
  assert.deepEqual(deriveCaveats(compareFolderChildren([file('a.pdf', 'm1')], [file('b.pdf', 'm1')])), []);
  assert.deepEqual(deriveCaveats(compareFolderChildren([], [])), []);
});

function folder(name: string): FolderChild {
  return { name, mimeType: FOLDER_MIME, md5Checksum: null };
}

test('子フォルダ名の照合: 完全一致・A側のみ・B側のみを件数で返す', () => {
  const r = compareFolderChildren([folder('s1'), folder('s2')], [folder('s1'), folder('s3')]);
  assert.deepEqual(r.childFolderNames, { both: 1, onlyA: 1, onlyB: 1, bothIgnoringSpaces: 1 });
});

test('子フォルダ名の照合: 全角/半角スペースの差は完全一致では別扱い、空白無視では一致', () => {
  const r = compareFolderChildren([folder('ア　新井')], [folder('ア 新井')]);
  assert.equal(r.childFolderNames.both, 0);
  assert.equal(r.childFolderNames.onlyA, 1);
  assert.equal(r.childFolderNames.onlyB, 1);
  assert.equal(r.childFolderNames.bothIgnoringSpaces, 1);
});

test('子フォルダ名の照合: 同名が複数ある場合は多重度で対応付ける(A側2件・B側1件 → 1件一致・A側のみ1件)', () => {
  const r = compareFolderChildren([folder('dup'), folder('dup')], [folder('dup')]);
  assert.deepEqual(r.childFolderNames, { both: 1, onlyA: 1, onlyB: 0, bothIgnoringSpaces: 1 });
});

test('子フォルダ名の照合: 子フォルダが無ければ全て0', () => {
  const r = compareFolderChildren([file('a.pdf', 'm1')], [file('b.pdf', 'm2')]);
  assert.deepEqual(r.childFolderNames, { both: 0, onlyA: 0, onlyB: 0, bothIgnoringSpaces: 0 });
});

test('子フォルダ名の照合: ファイルと同名でも子フォルダ照合に混ざらない', () => {
  const r = compareFolderChildren([file('x', 'm1'), folder('y')], [folder('x'), file('y', 'm2')]);
  assert.deepEqual(r.childFolderNames, { both: 0, onlyA: 1, onlyB: 1, bothIgnoringSpaces: 0 });
});

test('子フォルダ名の照合: 結果にフォルダ名が含まれない(PII対策)', () => {
  const r = compareFolderChildren([folder('山田太郎')], [folder('山田太郎')]);
  assert.equal(JSON.stringify(r).includes('山田太郎'), false);
});
