/**
 * Issue #432 PR-C3c (AC15-3 強化): survey artifact の sourceManifestEntries と
 * classify 実行時の現在 GCS state を比較する pure functions。
 *
 * 設計背景 (Codex MCP セカンドオピニオン session `019e1e7b-...` の NO-GO 指摘反映):
 *   - PR-C3c 初版では loadAndValidateSurveyArtifact 内で artifact 内部の
 *     `sourceManifestHash === recompute(entries)` のみ自己整合性チェックしていた。
 *     これは「artifact が破損していない」ことは検証できるが、計画書 v2 の AC15-3 が
 *     要求する「現在 GCS 状態との再計算照合」(survey 時と classify 時の drift 検出)
 *     には到達しない。
 *   - 本 lib は classify 時点で GCS から listing + getMetadata(並列 8) で取得した
 *     `CurrentGcsState` と、survey artifact の `SourceManifestEntry[]` を比較し、
 *     drift 4 種 (missingInGcs / extraInGcs / generationMismatch / metagenerationMismatch)
 *     を構造化して返す。drift があれば classify は exit 2 する (caller 側)。
 *   - Pure function として lib 化することで、I/O を伴う GCS listing は呼び出し側、
 *     比較ロジックは本 lib で単体テスト可能にする (functions/test/sourceManifestDrift.test.ts)。
 *
 * 比較対象 field の選定 (handoff 着手指示 A 案):
 *   - generation / metageneration のみ比較。bytes/sha256 は計算しない (kanameone ~135 docs
 *     で download 全件は重い、survey 時点の sha256 が artifact に記録済で間接的に保証される)。
 *   - size も比較対象外 (generation が一致すれば bytes 不変、size も不変)。
 *
 * 注意:
 *   - survey artifact の bucket='local' (local 固定 fixture モード) の場合、本 lib は
 *     呼び出し側で skip 判定する (GCS が存在しないので比較不能)。
 *   - bucket/prefix mismatch は本 lib より前の段階 (caller) で fail-fast する設計。
 */

import type { SourceManifestEntry } from './collisionPlanTypes';

/**
 * classify 実行時に GCS から listing + getMetadata で取得した object set の snapshot。
 *
 * - `objectNames`: prefix 配下に listing で見つかった全 object name (PDF のみ、survey 側と同条件)
 * - `metadata`: objectName -> {generation, metageneration} の Map (getMetadata 結果)
 *   listing で見つかったが getMetadata が失敗した object は metadata に entry なし。
 *   呼び出し側で fetch error を別 list として保持する設計 (本型には混入させない)。
 */
export interface CurrentGcsState {
  objectNames: Set<string>;
  metadata: Map<string, { generation: string; metageneration: string }>;
}

/**
 * survey 時点と classify 時点の drift 種別ごとの一覧。
 *
 * - `missingInGcs`: survey にあったが現在 GCS に無い (= survey 後に削除)
 * - `extraInGcs`: 現在 GCS にあるが survey に無い (= survey 後に追加 / Firestore quiesce 失敗)
 * - `generationMismatches`: 同 objectName で generation が異なる (= 同名で再 upload された)
 * - `metagenerationMismatches`: generation 同じだが metageneration が異なる
 *   (= metadata 変更があった、bytes は不変だが ACL/customMetadata 等が変わった可能性)
 * - `metadataFetchErrors`: getMetadata 自体が失敗した object (transient 503 等、別系統エラー)
 */
export interface ManifestDriftResult {
  missingInGcs: string[];
  extraInGcs: string[];
  generationMismatches: Array<{
    objectName: string;
    surveyGeneration: string;
    currentGeneration: string;
  }>;
  metagenerationMismatches: Array<{
    objectName: string;
    surveyMetageneration: string;
    currentMetageneration: string;
  }>;
  metadataFetchErrors: Array<{ objectName: string; error: string }>;
}

/**
 * survey artifact の sourceManifestEntries と現在 GCS state を比較し、drift を抽出する。
 *
 * @param surveyEntries survey artifact 内の全 manifest entry (全 GCS object が対象、PDF filter は survey 側で実施済)
 * @param current 現在 GCS state (caller が listing + getMetadata で構築)
 * @param metadataFetchErrors getMetadata が失敗した object 一覧 (transient エラー、別系統)
 * @returns drift 4 種 + metadataFetchErrors を構造化した結果
 */
export function compareSurveyManifestToCurrentGcs(
  surveyEntries: SourceManifestEntry[],
  current: CurrentGcsState,
  metadataFetchErrors: Array<{ objectName: string; error: string }> = []
): ManifestDriftResult {
  const surveyByName = new Map<string, SourceManifestEntry>();
  for (const e of surveyEntries) {
    surveyByName.set(e.objectName, e);
  }

  const missingInGcs: string[] = [];
  for (const name of surveyByName.keys()) {
    if (!current.objectNames.has(name)) missingInGcs.push(name);
  }
  const extraInGcs: string[] = [];
  for (const name of current.objectNames) {
    if (!surveyByName.has(name)) extraInGcs.push(name);
  }

  const generationMismatches: ManifestDriftResult['generationMismatches'] = [];
  const metagenerationMismatches: ManifestDriftResult['metagenerationMismatches'] = [];
  for (const [name, surveyEntry] of surveyByName) {
    if (!current.objectNames.has(name)) continue; // missingInGcs として既に検出
    const currentMeta = current.metadata.get(name);
    if (!currentMeta) continue; // metadataFetchErrors として別系統で検出済
    if (currentMeta.generation !== surveyEntry.generation) {
      generationMismatches.push({
        objectName: name,
        surveyGeneration: surveyEntry.generation,
        currentGeneration: currentMeta.generation,
      });
      continue; // generation 不一致なら metageneration 比較はスキップ (どの世代の meta かが意味を成さない)
    }
    if (currentMeta.metageneration !== surveyEntry.metageneration) {
      metagenerationMismatches.push({
        objectName: name,
        surveyMetageneration: surveyEntry.metageneration,
        currentMetageneration: currentMeta.metageneration,
      });
    }
  }

  // sort で出力安定化 (test の決定性 + operator が log を diff しやすい)
  missingInGcs.sort();
  extraInGcs.sort();
  generationMismatches.sort((a, b) => a.objectName.localeCompare(b.objectName));
  metagenerationMismatches.sort((a, b) => a.objectName.localeCompare(b.objectName));

  return {
    missingInGcs,
    extraInGcs,
    generationMismatches,
    metagenerationMismatches,
    metadataFetchErrors: [...metadataFetchErrors].sort((a, b) =>
      a.objectName.localeCompare(b.objectName)
    ),
  };
}

/**
 * drift が 1 件でも存在するかを判定する predicate。
 *
 * metadataFetchErrors も drift 扱い (transient エラーで「現状不明」=「一致確認できない」のため、
 * 安全側で classify は再実行を促す)。
 */
export function hasManifestDrift(result: ManifestDriftResult): boolean {
  return (
    result.missingInGcs.length > 0 ||
    result.extraInGcs.length > 0 ||
    result.generationMismatches.length > 0 ||
    result.metagenerationMismatches.length > 0 ||
    result.metadataFetchErrors.length > 0
  );
}

/**
 * drift result を operator 向けに整形した複数行 string を返す pure function。
 *
 * 各 drift 種別ごとに先頭 `maxItemsPerCategory` 件まで列挙し、超過分は `... and N more` で
 * 集計する。kanameone ~135 docs 全件 drift などの極端ケースで log が爆発しないよう保護。
 *
 * @param result drift 結果
 * @param maxItemsPerCategory 種別ごとの最大表示件数 (default 10)
 * @returns 改行区切り string (空 drift なら空文字列)
 */
export function formatDriftError(
  result: ManifestDriftResult,
  maxItemsPerCategory = 10
): string {
  const lines: string[] = [];

  const formatList = <T>(
    label: string,
    items: T[],
    render: (item: T) => string
  ): void => {
    if (items.length === 0) return;
    lines.push(`  ${label}: ${items.length}`);
    for (const item of items.slice(0, maxItemsPerCategory)) {
      lines.push(`    - ${render(item)}`);
    }
    if (items.length > maxItemsPerCategory) {
      lines.push(`    ... and ${items.length - maxItemsPerCategory} more`);
    }
  };

  formatList(
    'missing in current GCS (in survey but deleted after survey)',
    result.missingInGcs,
    (n) => n
  );
  formatList(
    'extra in current GCS (added after survey, Firestore quiesce likely failed)',
    result.extraInGcs,
    (n) => n
  );
  formatList(
    'generation mismatches (object replaced after survey)',
    result.generationMismatches,
    (m) =>
      `${m.objectName}: survey=${m.surveyGeneration} current=${m.currentGeneration}`
  );
  formatList(
    'metageneration mismatches (metadata changed after survey)',
    result.metagenerationMismatches,
    (m) =>
      `${m.objectName}: surveyMeta=${m.surveyMetageneration} currentMeta=${m.currentMetageneration}`
  );
  formatList(
    'getMetadata fetch errors (transient / permission / unknown)',
    result.metadataFetchErrors,
    (e) => `${e.objectName}: ${e.error}`
  );

  return lines.join('\n');
}

/**
 * Operator runbook (AC15-3 drift / precondition drift 共通)。classify が exit 2 する時、
 * および execute write phase の precondition drift exit 1 で出力する。
 *
 * Codex Important 反映: 再開手順を 6 ステップで明示し、artifact 保存と Firestore quiesce が
 * 抜けないようにする。drift の根本原因 (= Firestore/Storage の concurrent write) を operator が
 * 認識せず即 retry することを防ぐ。
 */
export const SURVEY_OR_PRECONDITION_DRIFT_RUNBOOK = [
  'Operator runbook (survey vs current GCS drift / precondition drift):',
  '  1. 直前 run の writeSummary / preflightSummary / plan JSON を artifact から保存 (再開判定に必要)。',
  '  2. concurrent writer (Functions / Gmail ingestion / manual edit) を全て停止し、Firestore quiesce を確認。',
  '  3. pdf-feature-survey を再実行し、新しい sourceManifestRef を含む新 artifact を取得。',
  '  4. classify-collision-docs を新 survey artifact で再実行し、新 plan を取得。',
  '  5. 直前 run で executed/idempotent-already-applied 済の op を新 plan から除外し、approval JSON を再構築。',
  '  6. execute-collision-migration を新 plan + 新 approval で再実行 (preflight + write phase)。',
].join('\n');
