/**
 * グループ集計ユーティリティ
 * ドキュメントグループの集計・更新処理
 */

import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { CONSTANTS } from '../../../shared/types';

// GroupType の定義（shared/types.ts からインポートできない場合のローカル定義）
export type GroupType = 'customer' | 'office' | 'documentType' | 'careManager';

export interface GroupPreviewDoc {
  id: string;
  fileName: string;
  documentType: string;
  processedAt: Timestamp;
}

export interface DocumentGroupData {
  groupType: GroupType;
  groupKey: string;
  displayName: string;
  count: number;
  latestAt: Timestamp;
  latestDocs: GroupPreviewDoc[];
  updatedAt: Timestamp;
}

interface DocumentData {
  customerName?: string;
  officeName?: string;
  documentType?: string;
  careManager?: string;
  customerKey?: string;
  officeKey?: string;
  documentTypeKey?: string;
  careManagerKey?: string;
  fileName?: string;
  processedAt?: Timestamp;
  status?: string;
}

/**
 * テキストを正規化してグループキーを生成
 * 全角→半角、大文字→小文字、空白除去
 */
export function normalizeGroupKey(value: string | undefined | null): string {
  if (!value) return '';

  return value
    // 全角英数字→半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 0xFEE0)
    )
    // 大文字→小文字
    .toLowerCase()
    // 空白除去
    .replace(/[\s\u3000]/g, '')
    // 連続する空白系を統合
    .trim();
}

/**
 * ドキュメントからグループキーを生成
 */
export function generateGroupKeys(data: DocumentData): {
  customerKey: string;
  officeKey: string;
  documentTypeKey: string;
  careManagerKey: string;
} {
  return {
    customerKey: normalizeGroupKey(data.customerName),
    officeKey: normalizeGroupKey(data.officeName),
    documentTypeKey: normalizeGroupKey(data.documentType),
    careManagerKey: normalizeGroupKey(data.careManager),
  };
}

/**
 * グループIDを生成
 */
export function generateGroupId(groupType: GroupType, groupKey: string): string {
  return `${groupType}_${groupKey}`;
}

/**
 * キーが空の場合に集計除外ではなく予約keyへフォールバックさせるgroupType。
 * customer/office/documentTypeはOCR成功（status:'processed'への遷移）後は
 * OCR抽出結果側で必ずフォールバック表示名（「不明顧客」「未判定」等）が
 * 付与されるためキーが空になり得ない（pending/processing/error等の未処理
 * 状態では他フィールド同様に空になり得る。このケースの扱いは下記
 * resolveGroupKeyAndDisplay()のcanFallbackToUnassigned参照）。
 * careManagerは処理完了後も任意フィールドでフォールバックがないため、ここで
 * 明示的に「CM未設定」グループへ計上する（担当CM別集計が顧客別集計より
 * 大幅に少なく表示される非対称性バグの修正）。
 */
const UNASSIGNED_FALLBACK: Partial<Record<GroupType, { key: string; displayName: string }>> = {
  careManager: {
    key: CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY,
    displayName: CONSTANTS.UNASSIGNED_CARE_MANAGER_DISPLAY_NAME,
  },
};

/**
 * groupTypeとキー・表示名から集計対象のgroupKey/displayNameを解決する。
 * キーが空でも予約keyへのフォールバックが定義されたgroupTypeなら非nullを返す。
 * getAffectedGroups()とrebuildAllGroupAggregations()で共通利用し、両者の
 * key導出ロジックを単一の関数に集約する。
 *
 * `canFallbackToUnassigned` は customerKey（正規化後）が非空かどうかを渡す。
 * customerName/officeName/documentTypeはOCR成功時のみ一括でフォールバック値が
 * 付与される（status:'processed'への遷移と同一トランザクション）ため、
 * pending/processing/error等の未処理状態ではcustomerKeyも含めて全キーが空になる。
 * この状態でcareManagerだけ無条件に予約keyへ計上すると、担当CM別合計が顧客別
 * 合計を一時的に上回る新たな非対称性を生む（本来の修正対象の逆パターン）。
 * customerKeyの非空を条件にすることで、「顧客別集計に計上されるドキュメントは
 * 必ず担当CM別集計にも（実CMまたはCM未設定として）計上される」という不変条件を
 * status値の列挙に頼らず保証する。
 */
export function resolveGroupKeyAndDisplay(
  type: GroupType,
  rawKey: string | undefined,
  rawDisplay: string | undefined,
  canFallbackToUnassigned: boolean
): { key: string; displayName: string } | null {
  if (rawKey) {
    return { key: rawKey, displayName: rawDisplay || rawKey };
  }
  if (!canFallbackToUnassigned) return null;
  const fallback = UNASSIGNED_FALLBACK[type];
  return fallback ? { ...fallback } : null;
}

/**
 * 集計に関わる全フィールド（グループキー・表示名・status）が before/after で
 * 完全に不変かどうかを判定する。
 *
 * Issue #547 Phase E: ocrResult/pageResults 削除等、集計に無関係なフィールドの
 * 書き込みでも onDocumentWritten が発火し、getAffectedGroups() が無条件に
 * delta:0 のグループ更新（実質 updatedAt のみ更新する no-op transaction）を
 * pushしていた。これがdocuments全件に対する破壊的マイグレーション時の
 * 「トリガーストーム」の一因となるため、集計対象フィールドが完全一致する
 * 場合は早期returnで下流のgroup transaction/writeを一切発生させない。
 */
function isAggregationUnchanged(before: DocumentData, after: DocumentData): boolean {
  return (
    before.customerKey === after.customerKey &&
    before.officeKey === after.officeKey &&
    before.documentTypeKey === after.documentTypeKey &&
    before.careManagerKey === after.careManagerKey &&
    before.customerName === after.customerName &&
    before.officeName === after.officeName &&
    before.documentType === after.documentType &&
    before.careManager === after.careManager &&
    before.status === after.status
  );
}

/**
 * 影響を受けるグループを特定
 */
export function getAffectedGroups(
  before: DocumentData | undefined,
  after: DocumentData | undefined
): Array<{ groupType: GroupType; groupKey: string; displayName: string; delta: number }> {
  // create（before未定義）/ delete（after未定義）は必ず処理対象。
  // update時のみ、集計対象フィールドが完全不変なら早期returnで下流writeを回避。
  if (before && after && isAggregationUnchanged(before, after)) {
    return [];
  }

  const affected: Array<{ groupType: GroupType; groupKey: string; displayName: string; delta: number }> = [];

  const types: Array<{ type: GroupType; keyField: keyof DocumentData; displayField: keyof DocumentData }> = [
    { type: 'customer', keyField: 'customerKey', displayField: 'customerName' },
    { type: 'office', keyField: 'officeKey', displayField: 'officeName' },
    { type: 'documentType', keyField: 'documentTypeKey', displayField: 'documentType' },
    { type: 'careManager', keyField: 'careManagerKey', displayField: 'careManager' },
  ];

  for (const { type, keyField, displayField } of types) {
    const beforeKey = before?.[keyField] as string | undefined;
    const afterKey = after?.[keyField] as string | undefined;
    const beforeDisplay = before?.[displayField] as string | undefined;
    const afterDisplay = after?.[displayField] as string | undefined;

    // 分割済みステータス、およびbefore/after自体が未定義（create/delete）の場合は
    // resolveGroupKeyAndDisplayを呼ばず、その側を無効（null）として扱う
    const beforeResolved = before && before.status !== 'split'
      ? resolveGroupKeyAndDisplay(type, beforeKey, beforeDisplay, !!before.customerKey)
      : null;
    const afterResolved = after && after.status !== 'split'
      ? resolveGroupKeyAndDisplay(type, afterKey, afterDisplay, !!after.customerKey)
      : null;

    if (beforeResolved && afterResolved && beforeResolved.key === afterResolved.key) {
      // キーが変わらない場合は更新のみ（latestDocs更新用）
      affected.push({ groupType: type, groupKey: afterResolved.key, displayName: afterResolved.displayName, delta: 0 });
    } else {
      // 削除または変更：古いグループから-1
      if (beforeResolved) {
        affected.push({ groupType: type, groupKey: beforeResolved.key, displayName: beforeResolved.displayName, delta: -1 });
      }
      // 追加または変更：新しいグループに+1
      if (afterResolved) {
        affected.push({ groupType: type, groupKey: afterResolved.key, displayName: afterResolved.displayName, delta: 1 });
      }
    }
  }

  return affected;
}

export interface AggregationDelta {
  groupType: GroupType;
  groupKey: string;
  displayName: string;
  delta: number;
}

/**
 * deltasの各要素に対応するdocumentGroupsのDocumentReferenceを、同じ順序で生成する。
 * `transaction.getAll(...refs)`（read phase）と`applyAggregationDeltas()`（write phase）の
 * 両方に同じ配列を渡すことで、インデックスの対応関係を保証する（Issue #660修正、ADR-0020）。
 */
export function buildGroupRefs(
  db: admin.firestore.Firestore,
  deltas: AggregationDelta[]
): admin.firestore.DocumentReference[] {
  return deltas.map((d) => db.collection('documentGroups').doc(generateGroupId(d.groupType, d.groupKey)));
}

/**
 * 単一トランザクションのwrite phaseで、複数グループの集計を一括更新する（Issue #660修正）。
 *
 * Firestoreトランザクションは「全読み取り→全書込み」の順序制約があるため、本関数は
 * read phase（`transaction.getAll(...groupRefs)`）を呼び出し元が事前に実行済みである
 * ことを前提とし、write phaseのみを担当する。`groupRefs`/`groupSnaps`は`deltas`と
 * 同じ順序・同じ長さであること（`buildGroupRefs(db, deltas)`で生成したrefsをそのまま
 * `transaction.getAll()`に渡すことで順序を保証する）。
 */
export function applyAggregationDeltas(
  transaction: admin.firestore.Transaction,
  deltas: AggregationDelta[],
  groupRefs: admin.firestore.DocumentReference[],
  groupSnaps: admin.firestore.DocumentSnapshot[],
  docData?: DocumentData & { id?: string }
): void {
  if (groupRefs.length !== deltas.length || groupSnaps.length !== deltas.length) {
    throw new Error(
      `applyAggregationDeltas: deltas/groupRefs/groupSnaps length mismatch ` +
      `(${deltas.length}/${groupRefs.length}/${groupSnaps.length}). ` +
      'groupRefs/groupSnaps must be derived from buildGroupRefs(db, deltas) in the same order.'
    );
  }

  deltas.forEach((d, i) => {
    if (!d.groupKey) return;

    const groupRef = groupRefs[i];
    const groupSnap = groupSnaps[i];
    const { groupType, groupKey, displayName, delta } = d;

    if (groupSnap.exists) {
      const currentData = groupSnap.data() as DocumentGroupData;
      if (!Number.isFinite(currentData.count)) {
        throw new Error(
          `applyAggregationDeltas: documentGroups/${groupRef.id} has non-finite count ` +
          `(${currentData.count}). Refusing to compute a new count from corrupted data.`
        );
      }
      const newCount = Math.max(0, currentData.count + delta);

      if (newCount === 0) {
        // カウントが0になったらグループを削除
        transaction.delete(groupRef);
      } else {
        // カウント更新 & latestDocs更新
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: any = {
          count: newCount,
          displayName: displayName || currentData.displayName,
          updatedAt: FieldValue.serverTimestamp(),
        };

        // delta > 0（追加）の場合はlatestDocsを更新
        if (delta > 0 && docData?.id) {
          const newDoc: GroupPreviewDoc = {
            id: docData.id,
            fileName: docData.fileName || '',
            documentType: docData.documentType || '',
            processedAt: docData.processedAt || Timestamp.now(),
          };

          // 既存のlatestDocsから重複を除去し、新しいドキュメントを先頭に追加
          const existingDocs = (currentData.latestDocs || []).filter(dd => dd.id !== docData.id);
          const newLatestDocs = [newDoc, ...existingDocs].slice(0, 3);

          updateData.latestDocs = newLatestDocs;
          updateData.latestAt = docData.processedAt || Timestamp.now();
        }

        transaction.update(groupRef, updateData);
      }
    } else if (delta > 0) {
      // 新規グループ作成
      const latestDocs: GroupPreviewDoc[] = docData?.id ? [{
        id: docData.id,
        fileName: docData.fileName || '',
        documentType: docData.documentType || '',
        processedAt: docData.processedAt || Timestamp.now(),
      }] : [];

      const newGroupData: DocumentGroupData = {
        groupType,
        groupKey,
        displayName: displayName || groupKey,
        count: 1,
        latestAt: docData?.processedAt || Timestamp.now(),
        latestDocs,
        updatedAt: Timestamp.now(),
      };

      transaction.set(groupRef, newGroupData);
    }
  });
}

/**
 * 集計イベント冪等台帳（`documentAggregationEvents`コレクション）関連のユーティリティ
 * （Issue #660修正、ADR-0020）。
 *
 * Firestore/EventarcのCloudEventはat-least-once配信であり、`onDocumentWrite`が同一
 * イベントに対して複数回呼び出される可能性がある。さらにこれらのイベントは順序も
 * 保証されない。`documents/{docId}`に「直近処理済みevent.id」を1件だけ記録する方式
 * （却下案）は、イベントA処理後にイベントBを処理し、その後Aが遅れて再配信された
 * 場合に`last=B≠A`となり誤って再適用してしまうため不採用とした（/codex plan
 * セカンドオピニオンで指摘）。event.idごとに独立したドキュメントを持つ台帳
 * コレクションにすることで、配信順序に依存せず各イベントを厳密に一度だけ処理できる。
 */
export const AGGREGATION_EVENT_LEDGER_COLLECTION = 'documentAggregationEvents';
const AGGREGATION_EVENT_LEDGER_TTL_DAYS = 30;

export interface AggregationEventLedgerEntry {
  source: string;
  subject?: string;
  eventTime: string;
  processedAt: FirebaseFirestore.FieldValue;
  expireAt: Timestamp;
}

export function aggregationEventLedgerRef(
  db: admin.firestore.Firestore,
  eventId: string
): admin.firestore.DocumentReference {
  return db.collection(AGGREGATION_EVENT_LEDGER_COLLECTION).doc(eventId);
}

/**
 * TTLは冪等性保証のためのFirestore/Eventarcの最大再試行期間を十分に上回る期間とする
 * （コスト削減目的であり、短くしすぎて冪等性の保証を失わないこと。/codex plan指摘）。
 */
export function buildAggregationEventLedgerEntry(params: {
  source: string;
  subject?: string;
  eventTime: string;
  nowMillis: number;
}): AggregationEventLedgerEntry {
  return {
    source: params.source,
    subject: params.subject,
    eventTime: params.eventTime,
    processedAt: FieldValue.serverTimestamp(),
    expireAt: Timestamp.fromMillis(params.nowMillis + AGGREGATION_EVENT_LEDGER_TTL_DAYS * 24 * 60 * 60 * 1000),
  };
}

/**
 * 全グループ集計を再構築（マイグレーション用）
 */
export async function rebuildAllGroupAggregations(
  db: admin.firestore.Firestore,
  batchSize: number = 500
): Promise<{ processed: number; groups: number }> {
  // 既存のdocumentGroupsを削除
  const existingGroups = await db.collection('documentGroups').get();
  const deletePromises = existingGroups.docs.map(doc => doc.ref.delete());
  await Promise.all(deletePromises);

  // グループ集計用のマップ
  const groupMap = new Map<string, {
    groupType: GroupType;
    groupKey: string;
    displayName: string;
    count: number;
    latestAt: Timestamp;
    latestDocs: GroupPreviewDoc[];
  }>();

  // documentsを全件スキャン
  let processed = 0;
  let lastDoc: admin.firestore.QueryDocumentSnapshot | undefined;

  while (true) {
    let query = db.collection('documents')
      .where('status', '!=', 'split')
      .orderBy('status')
      .orderBy('processedAt', 'desc')
      .limit(batchSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as DocumentData;
      const keys = generateGroupKeys(data);

      // 各グループタイプに対して集計
      const types: Array<{ type: GroupType; key: string; display: string }> = [
        { type: 'customer', key: keys.customerKey, display: data.customerName || '' },
        { type: 'office', key: keys.officeKey, display: data.officeName || '' },
        { type: 'documentType', key: keys.documentTypeKey, display: data.documentType || '' },
        { type: 'careManager', key: keys.careManagerKey, display: data.careManager || '' },
      ];

      for (const { type, key, display } of types) {
        const resolved = resolveGroupKeyAndDisplay(type, key, display, !!keys.customerKey);
        if (!resolved) continue;

        const groupId = generateGroupId(type, resolved.key);
        const existing = groupMap.get(groupId);

        const previewDoc: GroupPreviewDoc = {
          id: docSnap.id,
          fileName: data.fileName || '',
          documentType: data.documentType || '',
          processedAt: data.processedAt || Timestamp.now(),
        };

        if (existing) {
          existing.count++;
          if (existing.latestDocs.length < 3) {
            existing.latestDocs.push(previewDoc);
          }
          // latestAtの更新（より新しい場合）
          if (data.processedAt && data.processedAt.toMillis() > existing.latestAt.toMillis()) {
            existing.latestAt = data.processedAt;
          }
        } else {
          groupMap.set(groupId, {
            groupType: type,
            groupKey: resolved.key,
            displayName: resolved.displayName,
            count: 1,
            latestAt: data.processedAt || Timestamp.now(),
            latestDocs: [previewDoc],
          });
        }
      }

      processed++;
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  // グループデータをFirestoreに書き込み
  const batch = db.batch();
  let batchCount = 0;
  const batches: admin.firestore.WriteBatch[] = [batch];

  for (const [groupId, data] of groupMap) {
    const currentBatch = batches[batches.length - 1];
    const groupRef = db.collection('documentGroups').doc(groupId);

    currentBatch.set(groupRef, {
      ...data,
      updatedAt: FieldValue.serverTimestamp(),
    });

    batchCount++;
    if (batchCount >= 500) {
      batches.push(db.batch());
      batchCount = 0;
    }
  }

  // バッチコミット
  await Promise.all(batches.map(b => b.commit()));

  return { processed, groups: groupMap.size };
}

export interface RebuildSingleGroupAggregationResult {
  groupId: string;
  matched: number;
  count: number;
  deleted: boolean;
}

/**
 * 単一グループ(groupType/groupKey)を生データから完全再導出して置換する
 * (Issue #660 派生ミッション タスクJ4、`/codex plan`セカンドオピニオン指摘)。
 *
 * `rebuildAllGroupAggregations()`(documentGroups全体1191グループの全削除+再構築)は、
 * 実運用データが載った本番環境で影響範囲が過大かつ、全件再構築中はライブトリガーとの
 * 競合リスクがある(ADR-0020)。Issue #660の非冪等トリガーによって蓄積したドリフトが
 * 特定少数のgroupIdに局在している場合、対象groupIdだけを個別に生データから完全再導出
 * して置換するほうが安全かつ影響範囲が小さい。
 *
 * `count`だけを補正する差分方式ではなく、`displayName`/`latestAt`/`latestDocs`を含めて
 * 完全に再計算しset()で置換する(count=0ならdelete)。理由: 差分方式だと過去のイベント
 * 非冪等性により蓄積した`latestDocs`のstaleなpreview(削除されたはずの古いdocumentが
 * 残留する等)が補正されない。
 *
 * `latestDocs`は`rebuildAllGroupAggregations()`と異なり、対象groupIdに一致した全
 * documentを一旦収集してから`processedAt`降順(同値時はdocId昇順でtie-break)に厳密
 * ソートして先頭3件を採用する。`rebuildAllGroupAggregations()`のクエリは
 * `orderBy('status').orderBy('processedAt', 'desc')`でstatusが第一ソートキーのため、
 * status境界をまたぐと真のprocessedAt降順にならない(先着3件embed方式の既知の限界、
 * 今回は対象groupが少数のため全件収集後ソートのコストが許容できる)。
 *
 * 呼び出し前提: `functions/src/utils/maintenanceGate.ts`のゲートが閉じており、
 * documentsへの集計所属変更を伴う書込みが十分な時間停止・ドレイン済みであること
 * (`backfillUnassignedCareManagerGroup()`と同じ前提、本関数自体はゲート状態を
 * 検証しない、呼び出し元の責務)。
 */
export async function rebuildSingleGroupAggregation(
  db: admin.firestore.Firestore,
  groupType: GroupType,
  groupKey: string,
  batchSize: number = 500
): Promise<RebuildSingleGroupAggregationResult> {
  const groupId = generateGroupId(groupType, groupKey);
  const groupRef = db.collection('documentGroups').doc(groupId);

  let matched = 0;
  let displayName = '';
  let displayNameSet = false;
  const candidates: GroupPreviewDoc[] = [];
  let lastDoc: admin.firestore.QueryDocumentSnapshot | undefined;

  // rebuildAllGroupAggregations()と同一クエリ(母集団定義の一貫性を保つ)
  while (true) {
    let query = db.collection('documents')
      .where('status', '!=', 'split')
      .orderBy('status')
      .orderBy('processedAt', 'desc')
      .limit(batchSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as DocumentData;
      const keys = generateGroupKeys(data);

      const fieldByType: Record<GroupType, { key: string; display: string }> = {
        customer: { key: keys.customerKey, display: data.customerName || '' },
        office: { key: keys.officeKey, display: data.officeName || '' },
        documentType: { key: keys.documentTypeKey, display: data.documentType || '' },
        careManager: { key: keys.careManagerKey, display: data.careManager || '' },
      };
      const { key, display } = fieldByType[groupType];
      const resolved = resolveGroupKeyAndDisplay(groupType, key, display, !!keys.customerKey);
      if (!resolved || resolved.key !== groupKey) continue;

      matched++;
      if (!displayNameSet) {
        displayName = resolved.displayName;
        displayNameSet = true;
      }
      candidates.push({
        id: docSnap.id,
        fileName: data.fileName || '',
        documentType: data.documentType || '',
        processedAt: data.processedAt || Timestamp.now(),
      });
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  if (matched === 0) {
    await groupRef.delete();
    return { groupId, matched: 0, count: 0, deleted: true };
  }

  candidates.sort((a, b) => {
    const diff = b.processedAt.toMillis() - a.processedAt.toMillis();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
  const latestDocs = candidates.slice(0, 3);

  const newGroupData: DocumentGroupData = {
    groupType,
    groupKey,
    displayName,
    count: matched,
    latestAt: latestDocs[0].processedAt,
    latestDocs,
    updatedAt: Timestamp.now(),
  };

  await groupRef.set(newGroupData);

  return { groupId, matched, count: matched, deleted: false };
}

export interface BackfillUnassignedCareManagerGroupResult {
  scanned: number;
  matched: number;
  count: number;
  groupId: string;
}

/**
 * CM未設定グループ(予約key)の安全な初期作成（GOAL.md タスクG）
 *
 * Task A(#656)の修正(careManagerKey空文字を集計から除外していたバグ)により
 * 影響を受けるのは、新設のCM未設定グループ1件のみである。既存の顧客別/事業所別/
 * 書類種別/実在CM別グループは、UNASSIGNED_FALLBACKがcareManagerにのみ定義されて
 * いるため数学的に無影響であり、`rebuildAllGroupAggregations()`のような
 * documentGroups全体の調停は不要（かつ、全削除を伴うため並行更新との競合面が
 * 大きく、`/codex plan`セカンドオピニオンでも不採用と判断された）。
 *
 * 呼び出し前提: `functions/src/utils/maintenanceGate.ts`のゲートが閉じており、
 * documentsへの集計所属変更を伴う書込み(OCR確定・split・顧客マスター同期)が
 * 十分な時間（各書込み経路のCloud Functions最大実行時間を上回る待機）停止・
 * ドレイン済みであること。この前提を満たさない場合、並行更新との競合により
 * 誤ったcountになりうる（本関数自体はゲート状態を検証しない、呼び出し元の責務）。
 *
 * 母集団クエリは`rebuildAllGroupAggregations()`と同一の
 * `where('status','!=','split').orderBy('status').orderBy('processedAt','desc')`
 * を再利用し(既存の複合indexをそのまま使え、新規index不要)、
 * careManagerKey/customerKeyの絞り込みはFirestoreの複数不等号クエリ制約
 * (`!=`は1フィールドまで)のためJS側で行う。
 */
export async function backfillUnassignedCareManagerGroup(
  db: admin.firestore.Firestore,
  batchSize: number = 500
): Promise<BackfillUnassignedCareManagerGroupResult> {
  const groupType: GroupType = 'careManager';
  const groupKey = CONSTANTS.UNASSIGNED_CARE_MANAGER_KEY;
  const displayName = CONSTANTS.UNASSIGNED_CARE_MANAGER_DISPLAY_NAME;
  const groupId = generateGroupId(groupType, groupKey);
  const groupRef = db.collection('documentGroups').doc(groupId);

  // 事前チェック: 既にグループが存在する場合は異常終了(上書きしない)。
  // 想定外の並行作成、または誤った再実行を検知するための安全装置。
  const existing = await groupRef.get();
  if (existing.exists) {
    throw new Error(
      `backfillUnassignedCareManagerGroup: group ${groupId} already exists ` +
      `(count=${existing.data()?.count}). Aborting to avoid overwriting. ` +
      'Investigate the existing group before retrying.'
    );
  }

  let scanned = 0;
  let matched = 0;
  let lastDoc: admin.firestore.QueryDocumentSnapshot | undefined;
  const latestDocs: GroupPreviewDoc[] = [];
  let latestAt: Timestamp | undefined;

  while (true) {
    let query = db.collection('documents')
      .where('status', '!=', 'split')
      .orderBy('status')
      .orderBy('processedAt', 'desc')
      .limit(batchSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as DocumentData;
      const keys = generateGroupKeys(data);

      // resolveGroupKeyAndDisplay()を直接呼び、CM未設定グループへの判定条件を
      // getAffectedGroups()/rebuildAllGroupAggregations()と完全に共有する(手書きコピー
      // 禁止。/code-review high指摘: 条件をここで再実装すると、UNASSIGNED_FALLBACKの
      // 定義が将来変わった際にこの関数だけ乖離する「独立コピー」リスクが再発する)。
      const resolved = resolveGroupKeyAndDisplay('careManager', keys.careManagerKey, data.careManager, !!keys.customerKey);
      if (resolved && resolved.key === groupKey) {
        matched++;
        if (latestDocs.length < 3) {
          latestDocs.push({
            id: docSnap.id,
            fileName: data.fileName || '',
            documentType: data.documentType || '',
            processedAt: data.processedAt || Timestamp.now(),
          });
        }
        if (data.processedAt && (!latestAt || data.processedAt.toMillis() > latestAt.toMillis())) {
          latestAt = data.processedAt;
        }
      }

      scanned++;
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  if (matched === 0) {
    // 対象0件は異常ではない(既に全書類にcareManagerが設定済みの場合等)。作成不要。
    return { scanned, matched, count: 0, groupId };
  }

  // 単一トランザクションでの安全な作成: スキャン中に並行作成されていないか再確認する
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(groupRef);
    if (snap.exists) {
      throw new Error(
        `backfillUnassignedCareManagerGroup: group ${groupId} was created concurrently ` +
        `during scan (count=${snap.data()?.count}). Aborting to avoid overwriting.`
      );
    }
    const newGroupData: DocumentGroupData = {
      groupType,
      groupKey,
      displayName,
      count: matched,
      latestAt: latestAt || Timestamp.now(),
      latestDocs,
      updatedAt: Timestamp.now(),
    };
    transaction.set(groupRef, newGroupData);
  });

  return { scanned, matched, count: matched, groupId };
}
