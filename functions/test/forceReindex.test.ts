/**
 * force-reindex.js の pure logic テスト (Issue #229, ADR-0015 Follow-up)
 *
 * 対象: `scripts/force-reindex.js` の parseArgs / computeExpectedIndex / detectDrift
 *
 * Firestore 書き込み系 (reindexDocument の execute=true パス) は emulator 必須のため、
 * 別テスト (SOP で emulator 手順記載) に委譲する。ここでは pure function のみ扱う。
 */

import { expect } from 'chai';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

// ESM スコープ配下でも CommonJS script を読めるよう createRequire を使用。
// NodeNext module では __dirname が未定義のため import.meta.url から解決する。
const requireCjs = createRequire(import.meta.url);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const forceReindex = requireCjs(path.resolve(testDir, '../../scripts/force-reindex.js'));

describe('force-reindex: parseArgs', () => {
  it('--doc-id のみで値が設定される', () => {
    const args = forceReindex.parseArgs(['--doc-id', 'abc123']);
    expect(args.docId).to.equal('abc123');
    expect(args.allDrift).to.equal(false);
    expect(args.execute).to.equal(false);
  });

  it('--all-drift フラグが有効になる', () => {
    const args = forceReindex.parseArgs(['--all-drift']);
    expect(args.allDrift).to.equal(true);
    expect(args.docId).to.equal(null);
  });

  it('--execute 未指定時は dry-run (execute=false)', () => {
    const args = forceReindex.parseArgs(['--doc-id', 'abc123']);
    expect(args.execute).to.equal(false);
  });

  it('--execute 指定時は execute=true', () => {
    const args = forceReindex.parseArgs(['--doc-id', 'abc123', '--execute']);
    expect(args.execute).to.equal(true);
  });

  it('--sample=10 を数値として受理', () => {
    const args = forceReindex.parseArgs(['--all-drift', '--sample=10']);
    expect(args.sample).to.equal(10);
  });

  it('--batch-size=250 を数値として受理', () => {
    const args = forceReindex.parseArgs(['--all-drift', '--batch-size=250']);
    expect(args.batchSize).to.equal(250);
  });

  it('--dry-run はデフォルト動作のため無視される (互換性維持)', () => {
    const args = forceReindex.parseArgs(['--doc-id', 'abc', '--dry-run']);
    expect(args.execute).to.equal(false);
  });

  it('--doc-id と --all-drift 同時指定はエラー', () => {
    expect(() => forceReindex.parseArgs(['--doc-id', 'abc', '--all-drift'])).to.throw(
      '--doc-id と --all-drift は同時指定できません'
    );
  });

  it('モード未指定はエラー', () => {
    expect(() => forceReindex.parseArgs(['--execute'])).to.throw(
      '--doc-id または --all-drift のいずれかを指定してください'
    );
  });

  it('--doc-id 直後に値が無いとエラー', () => {
    expect(() => forceReindex.parseArgs(['--doc-id', '--execute'])).to.throw(
      '--doc-id には値が必要です'
    );
  });

  it('未知のオプションはエラー', () => {
    expect(() => forceReindex.parseArgs(['--doc-id', 'abc', '--unknown'])).to.throw(
      '未知のオプション: --unknown'
    );
  });

  it('--sample に負数はエラー', () => {
    expect(() => forceReindex.parseArgs(['--all-drift', '--sample=-1'])).to.throw(
      '--sample には正の整数を指定してください'
    );
  });

  it('--sample に 0 はエラー', () => {
    expect(() => forceReindex.parseArgs(['--all-drift', '--sample=0'])).to.throw(
      '--sample には正の整数を指定してください'
    );
  });

  it('--help はエラーなしで args.help=true', () => {
    const args = forceReindex.parseArgs(['--help']);
    expect(args.help).to.equal(true);
  });
});

describe('force-reindex: computeExpectedIndex', () => {
  it('最小ドキュメント (顧客名のみ) でトークンと tokenHash を返す', () => {
    const result = forceReindex.computeExpectedIndex({
      customerName: 'テスト太郎',
      fileDate: null,
    });
    expect(result.tokens).to.be.an('array').with.length.greaterThan(0);
    expect(result.tokenHash).to.be.a('string').with.length.greaterThan(0);
  });

  it('空ドキュメントでも tokenHash を返す (空配列の hash)', () => {
    const result = forceReindex.computeExpectedIndex({});
    expect(result.tokens).to.deep.equal([]);
    expect(result.tokenHash).to.be.a('string');
  });

  it('同一内容のドキュメントは同一 tokenHash を返す (idempotent)', () => {
    const doc = { customerName: 'A社', officeName: 'B事業所', fileName: 'test.pdf' };
    const result1 = forceReindex.computeExpectedIndex(doc);
    const result2 = forceReindex.computeExpectedIndex(doc);
    expect(result1.tokenHash).to.equal(result2.tokenHash);
  });

  it('Firestore Timestamp 型の fileDate を Date に変換する', () => {
    const mockTimestamp = {
      toDate: () => new Date('2026-04-16'),
    };
    const result = forceReindex.computeExpectedIndex({
      customerName: 'X',
      fileDate: mockTimestamp,
    });
    // 日付トークンが含まれていること
    const dateTokens = result.tokens.filter((t: { field: string }) => t.field === 'date');
    expect(dateTokens.length).to.be.greaterThan(0);
  });
});

describe('force-reindex: detectDrift', () => {
  it('search.tokenHash 未設定のドキュメントは drift 判定', () => {
    const result = forceReindex.detectDrift({
      customerName: 'テスト',
    });
    expect(result.isDrifted).to.equal(true);
    expect(result.actualHash).to.equal(null);
    expect(result.expectedHash).to.be.a('string');
  });

  it('tokenHash が再計算結果と一致すれば drift なし', () => {
    const doc = { customerName: '一致テスト' };
    const expected = forceReindex.computeExpectedIndex(doc);
    const result = forceReindex.detectDrift({
      ...doc,
      search: { tokenHash: expected.tokenHash },
    });
    expect(result.isDrifted).to.equal(false);
    expect(result.actualHash).to.equal(expected.tokenHash);
    expect(result.expectedHash).to.equal(expected.tokenHash);
  });

  it('tokenHash が再計算結果と不一致なら drift 判定', () => {
    const result = forceReindex.detectDrift({
      customerName: '不一致テスト',
      search: { tokenHash: 'stale-hash-xxxxxxxx' },
    });
    expect(result.isDrifted).to.equal(true);
    expect(result.actualHash).to.equal('stale-hash-xxxxxxxx');
    expect(result.expectedHash).to.not.equal('stale-hash-xxxxxxxx');
  });
});

describe('force-reindex: reindexDocument (dry-run)', () => {
  it('execute=false の場合は plan を返すだけで Firestore 呼び出しなし', async () => {
    // execute=false 時は db / tokenizer の Firestore 書き込み系を呼ばない
    const fakeDb = {} as Parameters<typeof forceReindex.reindexDocument>[0];
    const result = await forceReindex.reindexDocument(
      fakeDb,
      'test-doc-id',
      { customerName: 'A社', fileName: 'test.pdf' },
      { execute: false }
    );
    expect(result.docId).to.equal('test-doc-id');
    expect(result.tokensToAdd).to.be.greaterThan(0);
    expect(result.tokensToRemove).to.equal(0);
    expect(result.expectedHash).to.be.a('string');
    expect(result.skipped).to.equal(false);
  });

  it('execute=false で search.tokens がある場合 tokensToRemove を計算', async () => {
    const fakeDb = {} as Parameters<typeof forceReindex.reindexDocument>[0];
    const result = await forceReindex.reindexDocument(
      fakeDb,
      'test-doc-id',
      {
        customerName: 'A社',
        search: { tokens: ['削除されるべき古いトークン'], tokenHash: 'old' },
      },
      { execute: false }
    );
    // 古いトークン 1件は新トークンに含まれないため tokensToRemove=1
    expect(result.tokensToRemove).to.equal(1);
  });
});
