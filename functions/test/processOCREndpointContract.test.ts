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
const STALLED_ALERT_TEMPLATE_PATH =
  '../../scripts/monitoring-templates/alert-processocr-stalled.yaml';
const TIMEOUT_ALERT_TEMPLATE_PATH =
  '../../scripts/monitoring-templates/alert-processocr-request-timeout.yaml';
const SETUP_METRICS_SCRIPT_PATH = '../../scripts/setup-log-based-metrics.sh';
const ON_SCHEDULE_ANCHOR = /export\s+const\s+processOCR\s*=\s*onSchedule\s*\(/;
const SCHEDULE_INTERVAL_SECONDS = 60;

let optionsBlock = '';
let migrateScriptSource = '';
let stalledAlertTemplateSource = '';
let timeoutAlertTemplateSource = '';
let setupMetricsScriptSource = '';

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

    const stalledAlertPath = resolve(__dirname, STALLED_ALERT_TEMPLATE_PATH);
    if (!existsSync(stalledAlertPath)) {
      throw new Error(`Source file not found: ${STALLED_ALERT_TEMPLATE_PATH}`);
    }
    stalledAlertTemplateSource = readFileSync(stalledAlertPath, 'utf-8');

    for (const relPath of [TIMEOUT_ALERT_TEMPLATE_PATH, SETUP_METRICS_SCRIPT_PATH]) {
      if (!existsSync(resolve(__dirname, relPath))) {
        throw new Error(`Source file not found: ${relPath}`);
      }
    }
    timeoutAlertTemplateSource = readFileSync(resolve(__dirname, TIMEOUT_ALERT_TEMPLATE_PATH), 'utf-8');
    setupMetricsScriptSource = readFileSync(resolve(__dirname, SETUP_METRICS_SCRIPT_PATH), 'utf-8');
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

  it('concurrency: 1 (ADR-0025 PR6、tick重複防止の前提)', () => {
    expect(optionsBlock).to.match(/concurrency:\s*1\b/);
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

  it('processocr_stalled absence alertのdurationは、正当に長いOCRサイクル1回では誤発火しない (ADR-0025 PR6、Issue #966 H1)', () => {
    // concurrency:1 下では、'completed' ログ間隔は最大で
    // (1サイクルの所要時間 <= PROCESS_OCR_TIMEOUT_SECONDS) + (次tickまでの待ち <= SCHEDULE_INTERVAL_SECONDS)
    // まで正当に伸びうる。alertのdurationがこれ以下だと、異常のない長時間サイクル1回で誤発火する。
    const match = stalledAlertTemplateSource.match(/duration:\s*(\d+)s/);
    expect(
      match,
      `${STALLED_ALERT_TEMPLATE_PATH} に 'duration: <N>s' 形式の値が見つからない`,
    ).to.not.be.null;
    const durationSeconds = Number(match![1]);
    const maxLegitimateGapSeconds =
      PROCESS_OCR_TIMEOUT_SECONDS + SCHEDULE_INTERVAL_SECONDS;
    expect(durationSeconds).to.be.greaterThan(
      maxLegitimateGapSeconds,
      `duration(${durationSeconds}s) が PROCESS_OCR_TIMEOUT_SECONDS + SCHEDULE_INTERVAL_SECONDS` +
        `(${maxLegitimateGapSeconds}s) 以下だと、異常のない長時間OCRサイクル1回だけで` +
        'absenceアラートが誤発火する',
    );
  });

  it('processocr_request_timeout: log-based metric定義が processocr の HTTP 504/499 を対象にし、アラートがそのメトリクスを参照する (900秒request timeoutの強制終了検知)', () => {
    // 強制終了(504)はアプリログを残さず processocr_error では検知できない。
    // metric定義側のフィルタが対象サービス・status条件を失う(例: service_name の typo、
    // status条件の欠落)と、アラートが構造的に発火しなくなるため、両者の整合を固定する。
    const metricLine = setupMetricsScriptSource
      .split('\n')
      .find((line) => line.includes('"processocr_request_timeout|'));
    expect(metricLine, `${SETUP_METRICS_SCRIPT_PATH} に processocr_request_timeout の定義が無い`).to.not.be.undefined;
    expect(metricLine).to.include('resource.type=\\"cloud_run_revision\\"');
    expect(metricLine).to.include('resource.labels.service_name=\\"processocr\\"');
    // Scheduler の attemptDeadline も900秒のため、Scheduler側が先に切れると Cloud Run のログは 499 になりうる
    expect(metricLine).to.include('httpRequest.status=(499 OR 504)');

    expect(timeoutAlertTemplateSource).to.include(
      'metric.type="logging.googleapis.com/user/processocr_request_timeout"',
    );
    // 1件でも発生したら即時通知する(強制終了は発生自体が異常)。durationを付けると単発504を取りこぼす。
    expect(timeoutAlertTemplateSource).to.match(/comparison:\s*COMPARISON_GT\s*$/m);
    expect(timeoutAlertTemplateSource).to.match(/thresholdValue:\s*0\s*$/m);
    expect(timeoutAlertTemplateSource).to.match(/duration:\s*0s\s*$/m);
  });
});
