/**
 * processOCR endpoint 設定契約テスト (ADR-0023)
 *
 * 目的: onSchedule の runtime options (timeoutSeconds 等) が、STUCK_PROCESSING_THRESHOLD_MS
 * や scripts/migrate-document-groups.js の drainWaitMs 既定値と整合し続けることを保証する。
 *
 * 背景: kanameone本番でOCRタイムアウトエラー(ADR-0023参照)が発生し、processOCRの
 * timeoutSeconds を540→900秒(PROCESS_OCR_TIMEOUT_SECONDS)に引き上げた。この値は
 * functions/src/ocr/constants.ts の STUCK_PROCESSING_THRESHOLD_MS
 * (= PROCESS_OCR_TIMEOUT_SECONDS*1000 + margin)や、scripts/migrate-document-groups.js の
 * ADR-0019ドレイン待機に既成事実として埋め込まれており、timeoutSeconds だけをリテラルで
 * 変更すると以下の不変条件が壊れる:
 *
 *   1. STUCK_PROCESSING_THRESHOLD_MS > PROCESS_OCR_TIMEOUT_SECONDS*1000 でなければならない。
 *      逆転すると、まだ正当に実行中の run を rescueStuckProcessingDocs が誤って pending に
 *      戻してしまい、その run が最終transactionで OcrRunSupersededError となって成果物が
 *      丸ごと破棄される(functions/src/ocr/constants.ts の STUCK_PROCESSING_THRESHOLD_MS
 *      doc comment参照)。
 *   2. scripts/migrate-document-groups.js の drainWaitMs 既定値は
 *      STUCK_PROCESSING_THRESHOLD_MS 以上でなければならない(ADR-0019のドレイン保証)。
 *
 * 方式: grep-based (docs/context/test-strategy.md §2.1 参照、checkGmailAttachmentsEndpointContract
 * と同方針)。processOCR.ts の timeoutSeconds はリテラルではなく PROCESS_OCR_TIMEOUT_SECONDS
 * 識別子であることまで確認する(リテラル retrogression の検知)。
 */

import { expect } from 'chai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { extractBraceBlock } from './helpers/extractBraceBlock';
import {
  PROCESS_OCR_TIMEOUT_SECONDS,
  STUCK_PROCESSING_THRESHOLD_MS,
} from '../src/ocr/constants';

const PROCESS_OCR_SOURCE_PATH = 'src/ocr/processOCR.ts';
const MIGRATE_SCRIPT_PATH = '../../scripts/migrate-document-groups.js';
const ON_SCHEDULE_ANCHOR = /export\s+const\s+processOCR\s*=\s*onSchedule\s*\(/;

let optionsBlock = '';
let migrateScriptSource = '';

describe('processOCR endpoint contract (ADR-0023)', () => {
  before(() => {
    const path = resolve(__dirname, '..', PROCESS_OCR_SOURCE_PATH);
    if (!existsSync(path)) {
      throw new Error(`Source file not found: ${PROCESS_OCR_SOURCE_PATH}`);
    }
    const source = readFileSync(path, 'utf-8');
    const block = extractBraceBlock(source, ON_SCHEDULE_ANCHOR, {
      anchorMode: 'after-match',
    });
    if (block === null) {
      throw new Error(
        `onSchedule options block not found in ${PROCESS_OCR_SOURCE_PATH}. ` +
          `Anchor: ${ON_SCHEDULE_ANCHOR.source}`,
      );
    }
    optionsBlock = block;

    const migratePath = resolve(__dirname, MIGRATE_SCRIPT_PATH);
    if (!existsSync(migratePath)) {
      throw new Error(`Source file not found: ${MIGRATE_SCRIPT_PATH}`);
    }
    migrateScriptSource = readFileSync(migratePath, 'utf-8');
  });

  it('schedule: "every 1 minutes"', () => {
    expect(optionsBlock).to.match(/schedule:\s*['"]every 1 minutes['"]/);
  });

  it('region: asia-northeast1', () => {
    expect(optionsBlock).to.match(/region:\s*['"]asia-northeast1['"]/);
  });

  it('memory: "1GiB"', () => {
    expect(optionsBlock).to.match(/memory:\s*['"]1GiB['"]/);
  });

  it('maxInstances: 1 (non-transactional read-then-write の前提)', () => {
    expect(optionsBlock).to.match(/maxInstances:\s*1\b/);
  });

  it('timeoutSeconds は PROCESS_OCR_TIMEOUT_SECONDS 識別子参照であり、リテラルに退行していない', () => {
    expect(optionsBlock).to.match(/timeoutSeconds:\s*PROCESS_OCR_TIMEOUT_SECONDS\b/);
    // リテラルへの退行 (例: `timeoutSeconds: 540`) を明示的に弾く
    expect(optionsBlock).to.not.match(/timeoutSeconds:\s*\d/);
  });

  it('STUCK_PROCESSING_THRESHOLD_MS は PROCESS_OCR_TIMEOUT_SECONDS より大きい (不変条件)', () => {
    expect(STUCK_PROCESSING_THRESHOLD_MS).to.be.greaterThan(
      PROCESS_OCR_TIMEOUT_SECONDS * 1000,
      'STUCK_PROCESSING_THRESHOLD_MS が timeoutSeconds 以下だと、走行中のrunが誤って' +
        'rescueされ成果物が破棄される (functions/src/ocr/constants.ts 不変条件コメント参照)',
    );
  });

  it('scripts/migrate-document-groups.js の drainWaitMs 既定値は STUCK_PROCESSING_THRESHOLD_MS 以上 (ADR-0019ドレイン保証)', () => {
    const match = migrateScriptSource.match(
      /let\s+drainWaitMs\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)\s*;/,
    );
    expect(
      match,
      'scripts/migrate-document-groups.js の `let drainWaitMs = N * N * N;` 形式の初期値が見つからない',
    ).to.not.be.null;
    const [, a, b, c] = match!;
    const drainWaitMs = Number(a) * Number(b) * Number(c);
    expect(drainWaitMs).to.be.at.least(
      STUCK_PROCESSING_THRESHOLD_MS,
      'drainWaitMs が STUCK_PROCESSING_THRESHOLD_MS 未満だと、ADR-0019のドレイン待機中に' +
        'processOCR runが生存し得て集計の二重計上リスクが生じる',
    );
  });
});
