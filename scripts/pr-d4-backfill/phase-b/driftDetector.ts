/**
 * Issue #445 PR-D4 S1-3: Phase B drift detector (pure function).
 *
 * impl-plan §4.2 step 3-4:
 *   3. Firestore getDocument() で updateTime 取得し artifact 値と比較 → drift なら skip
 *   4. GCS child.getMetadata() で generation/metageneration 取得し artifact 値と比較 → drift なら skip
 *
 * caller (orchestrator) が最新値を取得して本 pure function に渡す。drift 種別を返し、
 * artifact に分類カウンタ (BF9) として記録する。
 *
 * drift 優先順位 (UI 表示と統計の一貫性):
 *   1. firestoreUpdateTimeChanged: business doc 自体の変化 (status / fileName / 何でも)
 *   2. childGenerationChanged: child Storage の変化 (rotate / replace 等)
 *   3. parentGenerationChanged: parent Storage の変化
 *
 * MatchedByHash の re-split verify は parent generation drift 検出後にスキップする
 * (parent が変わっているなら現 parent から再 split しても child との一致を期待できない)。
 */

export interface DriftSnapshot {
  /** Firestore _updateTime を ISO8601 文字列化 */
  firestoreUpdateTime: string;
  /** child Storage object generation (null = object 不在) */
  childGeneration: string | null;
  childMetageneration: string | null;
  /** parent Storage object generation (null = parent 不在 or parentDocumentId 未指定) */
  parentGeneration: string | null;
  parentMetageneration: string | null;
}

export interface DriftDetectionInput {
  phaseA: DriftSnapshot;
  current: DriftSnapshot;
}

export type DriftKind =
  | 'no-drift'
  | 'firestoreUpdateTimeChanged'
  | 'childGenerationChanged'
  | 'parentGenerationChanged';

export interface DriftDetectionResult {
  kind: DriftKind;
}

export function detectDrift(input: DriftDetectionInput): DriftDetectionResult {
  const { phaseA, current } = input;

  if (phaseA.firestoreUpdateTime !== current.firestoreUpdateTime) {
    return { kind: 'firestoreUpdateTimeChanged' };
  }
  if (
    phaseA.childGeneration !== current.childGeneration ||
    phaseA.childMetageneration !== current.childMetageneration
  ) {
    return { kind: 'childGenerationChanged' };
  }
  if (
    phaseA.parentGeneration !== current.parentGeneration ||
    phaseA.parentMetageneration !== current.parentMetageneration
  ) {
    return { kind: 'parentGenerationChanged' };
  }
  return { kind: 'no-drift' };
}
