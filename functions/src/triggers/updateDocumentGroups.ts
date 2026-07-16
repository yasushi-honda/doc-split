/**
 * ドキュメント変更時のグループ集計更新トリガー
 *
 * documentsコレクションの変更を監視し、documentGroupsコレクションを自動更新
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import {
  generateGroupKeys,
  buildContribution,
  diffContribution,
  buildGroupRefs,
  applyAggregationDeltas,
  aggregationEventLedgerRef,
  buildAggregationEventLedgerEntry,
  aggregationStateRef,
  readAggregationStateContribution,
  buildAggregationStateEntry,
} from '../utils/groupAggregation';
import { Timestamp } from 'firebase-admin/firestore';

const db = admin.firestore();

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

export interface DocumentAggregationEventInput {
  docId: string;
  eventId: string;
  eventSource: string;
  eventSubject?: string;
  eventTime: string;
  nowMillis: number;
}

export interface DocumentAggregationEventResult {
  skipped: boolean;
  groupsUpdated: number;
}

/**
 * ライブなdocumentデータから、保存済みのcustomerKey等のキャッシュが古い(または
 * 未設定)かどうかを判定し、更新すべきキー一式を返す。古くなければnull。
 *
 * 旧実装(Issue #660/ADR-0020)は、イベントの**古いafterData**を使ってトランザクション
 * **外**で事前updateしていた。これはevent.data.afterが生成時点の凍結スナップショットで
 * あるため、docId再利用(delete後に同一IDで別内容の文書が作られるケース)時に、遅延到着
 * した古いイベントが新しい文書のキーを古いデータで上書きしてしまう恐れがあった
 * (`/codex plan`セカンドオピニオン指摘)。本関数はライブ再読込みしたデータを基準にし、
 * 呼び出し元がトランザクションのwrite phaseに含めることで、この問題を解消する。
 */
function computeKeyUpdate(
  liveData: DocumentData | undefined
): ReturnType<typeof generateGroupKeys> | null {
  if (!liveData) return null;
  const keys = generateGroupKeys(liveData);
  const needsUpdate =
    liveData.customerKey !== keys.customerKey ||
    liveData.officeKey !== keys.officeKey ||
    liveData.documentTypeKey !== keys.documentTypeKey ||
    liveData.careManagerKey !== keys.careManagerKey;
  return needsUpdate ? keys : null;
}

/**
 * documents書込みイベント1件分の「グループキー正規化+集計反映」処理本体。
 *
 * `onDocumentWritten`(CloudEvent)のプラミング部分から独立させ、`event`オブジェクトの
 * 構築を必要とせず直接呼び出せるようにしている(Issue #660修正、ADR-0020)。これにより
 * `event.id`を任意の値に固定した冪等性テストを、CloudEvent構築の複雑さを介さず実
 * Firestore emulatorに対して直接実行できる。
 *
 * **計算モデル(Issue #664修正、ADR-0021)**: ADR-0020は「event.data.before/afterの
 * 履歴差分をdocumentGroupsに適用する」モデルだったが、これは異なるevent.id間の配信
 * 順序不同に対して脆弱だった(作成直後削除で削除イベントが先着すると、遅延到着した
 * 作成イベントのdeltaが永久にphantom countとして残留する)。本関数は
 * 「documentGroupsは現在のdocumentsの状態に収束すべき派生データ」と意味論を変更し、
 * 「前回このトリガーが適用したcontribution(`documentAggregationStates/{docId}`)→
 * 現在のdocumentsのライブ再読込みが示すcontribution」の差分を適用する。これにより
 * イベントの到着順序に依存せず正しく収束する(`/codex plan`セカンドオピニオンで
 * 反例チェック・並行実行安全性を検証済み)。
 */
export async function processDocumentAggregationEvent(
  db: admin.firestore.Firestore,
  input: DocumentAggregationEventInput
): Promise<DocumentAggregationEventResult> {
  const { docId, eventId, eventSource, eventSubject, eventTime, nowMillis } = input;

  const documentRef = db.collection('documents').doc(docId);
  const ledgerRef = aggregationEventLedgerRef(db, eventId);
  const stateRef = aggregationStateRef(db, docId);

  try {
    // review指摘対応(`/codex review`P3): skipped/groupsUpdatedはトランザクション
    // コールバックの戻り値として返す(コールバック外の変数を書き換えない)。Firestore
    // トランザクションはコミット時の競合(ABORTED)でコールバック全体を再実行することが
    // あり、外側の変数に書き込む実装だと、ある試行が値をセットした後に別の試行が
    // 異なる経路(例: 早期returnのtrue no-op)を通った場合、最終的な戻り値が
    // 直近の試行と矛盾する古い値のまま残ってしまう。`db.runTransaction()`の戻り値は
    // 実際にコミットされた(あるいは書込みなしで解決した)試行のコールバック戻り値と
    // 保証されるため、これを直接呼び出し元へ返す。
    const result = await db.runTransaction(async (transaction) => {
      // read phase 1: 台帳 + ライブdocument + 直前のcontribution状態を一括読み取り
      const [ledgerSnap, documentSnap, stateSnap] = await transaction.getAll(
        ledgerRef,
        documentRef,
        stateRef
      );

      if (ledgerSnap.exists) {
        // 既に処理済みのイベント(再配信・リトライ) — 集計を再適用せずskip
        console.log(`[onDocumentWrite] event ${eventId} already processed for doc ${docId}, skipping`);
        return { skipped: true, groupsUpdated: 0 };
      }

      const liveData = documentSnap.exists ? (documentSnap.data() as DocumentData) : undefined;
      const keyUpdate = computeKeyUpdate(liveData);
      const previousContribution = readAggregationStateContribution(stateSnap);
      const targetContribution = buildContribution(liveData);
      const deltas = diffContribution(previousContribution, targetContribution);

      if (!keyUpdate && deltas.length === 0) {
        // キー正規化・集計いずれにも変化なし(自己書込みの再帰発火等の真のno-op) —
        // Firestore書込みを一切発生させずreturnする(旧isAggregationUnchanged()の
        // 早期returnと同じ意図)。台帳も書かないため、同一event.idの再配信時も
        // 同じ判定を繰り返すだけで安全(冪等)。
        return { skipped: false, groupsUpdated: 0 };
      }

      // read phase 2: affected groupsを読み取り(全読み取り→全書込みの順序制約を
      // 満たすため、write phase開始前にここで完了させる)
      const groupRefs = buildGroupRefs(db, deltas);
      const groupSnaps = deltas.length > 0 ? await transaction.getAll(...groupRefs) : [];

      // write phase
      if (keyUpdate) {
        transaction.update(documentRef, keyUpdate);
      }
      let groupsUpdated = 0;
      if (deltas.length > 0) {
        const docDataForPreview = liveData ? { ...liveData, id: docId } : undefined;
        applyAggregationDeltas(transaction, deltas, groupRefs, groupSnaps, docDataForPreview);
        groupsUpdated = deltas.length;
      }
      transaction.set(stateRef, buildAggregationStateEntry(targetContribution));
      transaction.create(ledgerRef, buildAggregationEventLedgerEntry({
        source: eventSource,
        subject: eventSubject,
        eventTime,
        nowMillis,
      }));
      return { skipped: false, groupsUpdated };
    });
    if (!result.skipped && result.groupsUpdated > 0) {
      console.log(`[onDocumentWrite] Applied ${result.groupsUpdated} group deltas for doc ${docId} (event ${eventId})`);
    }
    return result;
  } catch (error) {
    console.error(`[onDocumentWrite] Failed to process event ${eventId} for doc ${docId}:`, error);
    throw error;
  }
}

/**
 * ドキュメント書き込み時にグループキーを設定し、グループ集計を更新
 *
 * `retry: true`(Issue #660修正、ADR-0020): 冪等台帳方式により同一event.idの
 * 再試行は安全にskipされるため、処理失敗時はCloud Functions/Eventarc側の
 * 自動再試行に委ねる。`retry: false`(既定)のままだと、トランザクション失敗
 * (競合リトライ上限超過等)時にイベントが再試行されず静かにdropされ、その
 * 1件分の集計deltaが永久に失われる — 本Issueが解決しようとしている
 * ドリフトを別の入口から再導入してしまう(/codex plan指摘)。
 */
export const onDocumentWrite = onDocumentWritten(
  {
    document: 'documents/{docId}',
    region: 'asia-northeast1',
    retry: true,
  },
  async (event) => {
    await processDocumentAggregationEvent(db, {
      docId: event.params.docId,
      eventId: event.id,
      eventSource: event.source,
      eventSubject: event.subject,
      eventTime: event.time,
      nowMillis: Date.now(),
    });
  }
);
