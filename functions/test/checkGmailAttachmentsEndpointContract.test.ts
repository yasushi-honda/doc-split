/**
 * checkGmailAttachments endpoint 設定契約テスト (Issue #200 AC2)
 *
 * 目的: scheduled function の runtime options (maxInstances / schedule / region /
 * timeoutSeconds / memory) が運用前提を満たし続けることを保証する。
 *
 * 背景: PR #199 (Gmail 重複取得の根本対策) で maxInstances:1 を導入した。同一スケジュール
 * の複数起動は gmailLogs の messageId 重複挿入レースを招くため、設定値は regression guard
 * する必要がある。既存は grep contract すら無く、settings の静かな退行を検知できない。
 *
 * 方式: grep-based (docs/context/test-strategy.md §2.1 参照)。
 * source import は `admin.firestore()` top-level 評価で副作用が大きく、unit test 環境に
 * emulator host を注入すると他テストに波及するため、ソースファイル文字列から `onSchedule`
 * の options literal を読み取って assert する。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';

const SOURCE_PATH = 'src/gmail/checkGmailAttachments.ts';
const ON_SCHEDULE_ANCHOR = /export\s+const\s+checkGmailAttachments\s*=\s*onSchedule\s*\(/;

let optionsBlock: string = '';

describe('checkGmailAttachments endpoint contract (#200 AC2)', () => {
  before(() => {
    const path = resolve(__dirname, '..', SOURCE_PATH);
    if (!existsSync(path)) {
      throw new Error(`Source file not found: ${SOURCE_PATH}`);
    }
    const source = readFileSync(path, 'utf-8');
    // onSchedule( anchor の直後から最初の `{` 〜 対応する `}` を options object として抽出
    const block = extractBraceBlock(source, ON_SCHEDULE_ANCHOR, {
      anchorMode: 'after-match',
    });
    if (block === null) {
      throw new Error(
        `onSchedule options block not found in ${SOURCE_PATH}. ` +
          `Anchor: ${ON_SCHEDULE_ANCHOR.source}`,
      );
    }
    optionsBlock = block;
  });

  it('maxInstances:1 (Gmail duplicate race guard / PR #199)', () => {
    expect(optionsBlock).to.match(/maxInstances:\s*1\b/);
  });

  it('schedule: "every 5 minutes"', () => {
    expect(optionsBlock).to.match(/schedule:\s*['"]every 5 minutes['"]/);
  });

  it('region: asia-northeast1', () => {
    expect(optionsBlock).to.match(/region:\s*['"]asia-northeast1['"]/);
  });

  it('timeoutSeconds:300', () => {
    expect(optionsBlock).to.match(/timeoutSeconds:\s*300\b/);
  });

  it('memory:"512MiB"', () => {
    expect(optionsBlock).to.match(/memory:\s*['"]512MiB['"]/);
  });
});
