/**
 * searchIndexer の固定ログ文言と log-based metric filter の契約 (Issue #984)
 *
 * 2 本の metric を textPayload の部分一致で検知する:
 * - `search_index_token_skipped`: 高頻度トークンのスキップ(アラートなし。kanameone では段階2まで常時発生)
 * - `search_index_write_failed`: サイズ超過以外の索引書込み失敗(アラートあり。0 が正常)
 * ソース側の文言だけを変更して metric filter が無音で外れる(#981 と同型の失敗)のを防ぐため、
 * `setup-log-based-metrics.sh` の filter が `searchIndexer.ts` の固定文言と一字一句一致していることを、
 * ファイルを読んで検証する。emulator・Firestore 初期化は不要(文言を副作用のない別モジュールに切り出している)。
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { TOKEN_SKIPPED_LOG, INDEX_WRITE_FAILED_LOG } from '../src/search/searchIndexLogMessages';

const ROOT = path.resolve(process.cwd(), '..');
const SKIPPED_METRIC = 'search_index_token_skipped';
const FAILED_METRIC = 'search_index_write_failed';

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

/** setup-log-based-metrics.sh の METRICS 配列から、対象 metric の定義行(名前|説明|filter)を取り出す */
function metricDefinition(setupScript: string, metricName: string): string {
  const line = setupScript.split('\n').find((l) => l.trimStart().startsWith(`"${metricName}|`));
  if (!line) throw new Error(`setup-log-based-metrics.sh に ${metricName} の定義が見つかりません`);
  return line;
}

describe('searchIndexer 固定ログ文言 と log-based metric filter の契約', () => {
  const setupScript = read('scripts/setup-log-based-metrics.sh');
  const skippedDef = metricDefinition(setupScript, SKIPPED_METRIC);
  const failedDef = metricDefinition(setupScript, FAILED_METRIC);

  it('search_index_token_skipped の filter が、スキップの固定ログ文言に一字一句一致する', () => {
    expect(skippedDef).to.include(`textPayload:\\"${TOKEN_SKIPPED_LOG}\\"`);
  });

  it('search_index_write_failed の filter が、未分類の書込み失敗の固定ログ文言に一字一句一致する', () => {
    expect(failedDef).to.include(`textPayload:\\"${INDEX_WRITE_FAILED_LOG}\\"`);
  });

  it('2 本の metric は互いの文言を拾わない(スキップの常時発生が失敗アラートを汚さない)', () => {
    expect(skippedDef).to.not.include(INDEX_WRITE_FAILED_LOG);
    expect(failedDef).to.not.include(TOKEN_SKIPPED_LOG);
  });

  it('両 metric の filter が ondocumentwritesearchindex(索引更新トリガー)に限定されている', () => {
    for (const definition of [skippedDef, failedDef]) {
      expect(definition).to.include('resource.labels.service_name=\\"ondocumentwritesearchindex\\"');
    }
  });

  it('severity 条件を含まない(console.error は Cloud Logging で DEFAULT severity のため、#981)', () => {
    for (const definition of [skippedDef, failedDef]) {
      expect(definition).to.not.match(/severity\s*[=>]/);
    }
  });

  it('固定ログ文言は、引数1個の単一文字列で出す前提のため、角括弧で始まる識別用の接頭辞を持つ', () => {
    for (const message of [TOKEN_SKIPPED_LOG, INDEX_WRITE_FAILED_LOG]) {
      expect(message.startsWith('[searchIndexer] ')).to.equal(true);
    }
  });

  it('teardown の削除対象に両 metric が含まれ、アラートは失敗側の metric だけを参照している', () => {
    const teardown = read('scripts/teardown-log-based-metrics.sh');
    expect(teardown).to.include(SKIPPED_METRIC);
    expect(teardown).to.include(FAILED_METRIC);
    const alert = read('scripts/monitoring-templates/alert-search-index-write-failed.yaml');
    expect(alert).to.include(`logging.googleapis.com/user/${FAILED_METRIC}`);
    expect(alert).to.not.include(`logging.googleapis.com/user/${SKIPPED_METRIC}`);
  });
});
