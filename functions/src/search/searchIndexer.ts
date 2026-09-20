/**
 * 検索インデックス更新トリガー
 *
 * Firestoreドキュメント変更時に検索インデックスを自動更新
 * - ドキュメント作成/更新時: インデックス追加/更新
 * - ドキュメント削除時: インデックス削除
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, Timestamp, FieldValue, FieldPath } from 'firebase-admin/firestore';
import {
  generateDocumentTokens,
  generateTokenId,
  generateTokensHash,
  type TokenField,
  type TokenInfo,
} from '../utils/tokenizer';
import {
  isFirestoreNotFoundError,
  isFirestoreDocumentSizeExceededError,
} from '../utils/firestoreErrors';
import { chunkArray } from '../utils/chunkArray';
import { invalidateSearchCache } from './searchDocuments';

const db = getFirestore();

/**
 * db.getAll(...indexRefs) を一度に大量実行するとピークメモリが膨らむため
 * (Issue #217、kanameone 512MiB OOM 201件既発)、この件数単位で逐次取得する。
 *
 * 1 doc あたりのトークン数上限は MAX_TOKENS_PER_FIELD(20) × 4 フィールド
 * (customer/office/documentType/fileName) + 日付少数 ≈ 84 件(tokenizer.ts)。
 * 10 は実測ではなく初期値であり、複製flag ON後にchunkサイズ・メモリ使用量を
 * 観測して妥当性を再評価する(GOAL.md AC-e参照)。
 */
const GET_ALL_CHUNK_SIZE = 10;

/** フィールドからマスクへの変換 */
const FIELD_TO_MASK: Record<TokenField, number> = {
  customer: 1,
  office: 2,
  documentType: 4,
  fileName: 8,
  date: 16,
};

/**
 * トリガーの状態遷移ロジック本体。`onDocumentWritten`のCloudEvent配管から
 * 独立させることでテスト容易性を確保する(`driveExportTrigger.ts`の
 * `processDriveExportTrigger`と同型パターン)。
 */
export async function processSearchIndexTrigger(
  docId: string,
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData | undefined
): Promise<void> {
  // 削除の場合
  if (!after) {
    if (before?.search?.tokens) {
      await removeDocumentFromIndex(docId, before.search.tokens);
      console.log(`Search index removed for document: ${docId}`);
    }
    return;
  }

  // 処理完了したドキュメントのみインデックス更新。processed 以外へ遷移した場合
  // (例: FAX分割による status='split') は既存インデックスを持ち越さず削除する。
  // Issue #810: これを怠ると分割元ドキュメント(他利用者情報混在の複合PDF)の
  // インデックスエントリが残留し、検索結果に露出し続ける。
  if (after.status !== 'processed') {
    if (before?.search?.tokens) {
      await removeDocumentFromIndex(docId, before.search.tokens);
      // codex review指摘(PR #818, P2): search メタデータをクリアしないと、同一
      // ドキュメント(status='split'のまま)への後続書込みで before.search.tokens が
      // 残り続け、次回もこの分岐に入って df を二重減算してしまう(負値化しうる)。
      await db.doc(`documents/${docId}`).update({ search: FieldValue.delete() });
      // codex review指摘(PR #818, P1): 検索結果キャッシュ(10分TTL)は遷移前に
      // 計算済みの結果を持ち越すため、インデックス削除だけでは split ドキュメントが
      // 混在情報を含んだまま served され続けてしまう。索引削除と同時に全消去する。
      invalidateSearchCache();
      console.log(
        `Search index removed for document (status changed to ${String(after.status)}): ${docId}`
      );
    }
    return;
  }

  // トークン生成
  const fileDate = after.fileDate?.toDate?.() || null;
  const tokens = generateDocumentTokens({
    customerName: after.customerName || null,
    officeName: after.officeName || null,
    documentType: after.documentType || null,
    fileDate,
    fileName: after.fileName || null,
  });

  if (tokens.length === 0) {
    return;
  }

  // ハッシュで変更チェック（idempotent）
  const newHash = generateTokensHash(tokens);
  const oldHash = before?.search?.tokenHash || null;

  if (newHash === oldHash) {
    console.log(`Search index unchanged for document: ${docId}`);
    return;
  }

  // 古いトークンを削除
  if (before?.search?.tokens) {
    const oldTokens = before.search.tokens as string[];
    const newTokenStrings = tokens.map(t => t.token);
    const tokensToRemove = oldTokens.filter(t => !newTokenStrings.includes(t));
    if (tokensToRemove.length > 0) {
      await removeTokensFromIndex(docId, tokensToRemove);
    }
  }

  // 新しいトークンをインデックスに追加
  // 高頻度トークンが 1MiB 上限に達している場合は、そのトークンだけスキップして残りを登録する(Issue #984)
  const { skippedTokenIds } = await addDocumentToIndex(docId, tokens);
  const skippedIdSet = new Set(skippedTokenIds);
  const registeredTokens = tokens.filter(t => !skippedIdSet.has(generateTokenId(t.token)));
  // generateTokenId は 32bit ハッシュで異なる文字列が同じ ID になりうるため、ID→文字列は 1:N で逆引きする
  const skippedTokens = [
    ...new Set(tokens.filter(t => skippedIdSet.has(generateTokenId(t.token))).map(t => t.token)),
  ];

  // ドキュメントに検索メタデータを保存（idempotent用）
  // - tokens: 実際に登録できたトークンのみ(スキップ分を含めると再索引時に存在しない posting を削除して df を誤減算する)
  // - tokenHash: 期待する全トークンのハッシュ(変更なし判定と force-reindex の drift 判定を保つ。
  //   したがって tokenHash 保存済み = 全トークン登録済み、ではない)
  // - skippedTokens: スキップしたトークン文字列(段階2で対象書類を再索引するための情報。無ければ付けない)
  await db.doc(`documents/${docId}`).update({
    search: {
      version: 1,
      tokens: registeredTokens.map(t => t.token),
      tokenHash: newHash,
      indexedAt: Timestamp.now(),
      ...(skippedTokens.length > 0 ? { skippedTokens } : {}),
    },
  });

  console.log(
    `Search index updated for document: ${docId}, tokens: ${registeredTokens.length}/${tokens.length}` +
      (skippedTokens.length > 0 ? `, skipped: ${skippedTokens.length}` : '')
  );
}

/**
 * ドキュメント変更時に検索インデックスを更新
 */
export const onDocumentWriteSearchIndex = onDocumentWritten(
  {
    document: 'documents/{docId}',
    region: 'asia-northeast1',
    // Issue #217: 256MiB では db.getAll(...indexRefs) 時に境界を越えOOM頻発 (kanameone 04-14 12回+, 04-15 5回)。
    // 応急で 512MiB に増強。本質対応 (getAll chunk化) は GET_ALL_CHUNK_SIZE 導入で実施済み
    // (複数顧客FAX複製機能の前提整備、docs/handoff/GOAL.md参照)。複製flag ON後にchunkサイズ・
    // メモリ使用量を再実測し、本設定の妥当性(縮小余地の有無)を評価する。
    memory: '512MiB',
    timeoutSeconds: 60,
  },
  async (event) => {
    const docId = event.params.docId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    await processSearchIndexTrigger(docId, before, after);
  }
);

/** search_index へ書く1トークン分の操作 */
export interface TokenWriteOp {
  tokenId: string;
  ref: FirebaseFirestore.DocumentReference;
  /** 'set': 新規作成 / 'update': 既存文書へのドット記法の部分更新 */
  kind: 'set' | 'update';
  data: FirebaseFirestore.DocumentData;
  /**
   * この書類の posting が既に存在するか。
   * - df の増分は「index 文書の存在」ではなくこれで決める(force-reindex.js の hadPosting と同じ考え方)。
   *   トリガーの自己再発火(初回索引の直後に search メタ書込みが再発火する)やフォールバック後の再試行で
   *   同じ書類の df が二重加算されるのを防ぐ(Issue #984)。
   * - 書込みがサイズ超過で失敗しても、既に posting があれば索引に残っているので skipped 扱いにしない。
   */
  hadPosting: boolean;
}

/** テスト用の差し替え口(サイズ超過以外のエラーを注入するため)。本番コードは指定しない */
export interface AddDocumentToIndexDeps {
  /** 全トークンを原子的に書く既定経路 */
  commitOps?: (ops: TokenWriteOp[]) => Promise<void>;
  /** サイズ超過時のフォールバックで1トークンずつ書く経路 */
  writeOp?: (op: TokenWriteOp) => Promise<void>;
}

export interface AddDocumentToIndexResult {
  /** サイズ超過で登録できなかった tokenId(高頻度トークン。既に posting があるものは含まない) */
  skippedTokenIds: string[];
}

async function defaultCommitOps(ops: TokenWriteOp[]): Promise<void> {
  const batch = db.batch();
  for (const op of ops) {
    if (op.kind === 'set') batch.set(op.ref, op.data);
    else batch.update(op.ref, op.data);
  }
  await batch.commit();
}

async function defaultWriteOp(op: TokenWriteOp): Promise<void> {
  if (op.kind === 'set') await op.ref.set(op.data);
  else await op.ref.update(op.data);
}

/**
 * この書類の posting が index 文書に既に存在するか。
 * ネスト形 `postings[docId]` と、旧 addDocumentToIndex が作ったルート直下の `postings.<docId>`
 * (set() はドットをパスとして解釈せず文字どおりのフィールド名になる。searchDocuments.ts の互換処理と同じ事情)の
 * どちらかがあれば true。FieldPath で対象キーだけを取り出す(postings 全体の JS 変換を避ける意図)。
 */
function hasPostingFor(snapshot: FirebaseFirestore.DocumentSnapshot, docId: string): boolean {
  return (
    snapshot.get(new FieldPath('postings', docId)) !== undefined ||
    snapshot.get(new FieldPath(`postings.${docId}`)) !== undefined
  );
}

/**
 * サイズ超過と判定できなかった索引書込みの失敗を、throw の前に固定文言で記録する。
 * 判定関数が SDK/バックエンドの文言変更で外れても log-based metric(search_index_write_degraded)で
 * 検知できるようにする備え。
 * ログは引数1個の単一文字列に固定する(第2引数を渡すとペイロード形状が変わり、textPayload 前提の
 * metric に当たらなくなる。Issue #981 と同型の失敗を避ける)。
 */
function logIndexWriteFailed(docId: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[searchIndexer] index write failed docId=${docId} code=${String(code)} message=${message.slice(0, 160)}`
  );
}

/**
 * ドキュメントを検索インデックスに追加
 * (integration test から直接呼び出せるよう export。トリガー本体からの呼び出しは processSearchIndexTrigger)
 *
 * 通常は単一の原子的 batch で全トークンを書く。search_index/{tokenId} の 1MiB 上限に達した高頻度トークンが
 * あると batch 全体が失敗し、その書類の全トークンが未登録になっていた(Issue #984)ため、サイズ超過の場合だけ
 * トークンごとの個別書込みへフォールバックし、超過したトークンだけをスキップする。
 * サイズ超過以外のエラーは従来どおり throw する(フォールバック中に起きた場合は一部トークンだけ書込み済みの
 * 状態で throw する。df は hadPosting で再試行しても再加算されず、部分登録は force-reindex で復旧する)。
 */
export async function addDocumentToIndex(
  docId: string,
  tokens: TokenInfo[],
  deps: AddDocumentToIndexDeps = {}
): Promise<AddDocumentToIndexResult> {
  const commitOps = deps.commitOps ?? defaultCommitOps;
  const writeOp = deps.writeOp ?? defaultWriteOp;
  const now = Timestamp.now();

  // トークンごとに集約
  const tokenMap = new Map<string, { score: number; fieldsMask: number }>();

  for (const { token, field, weight } of tokens) {
    const tokenId = generateTokenId(token);
    const existing = tokenMap.get(tokenId);
    if (existing) {
      existing.score += weight;
      existing.fieldsMask |= FIELD_TO_MASK[field];
    } else {
      tokenMap.set(tokenId, {
        score: weight,
        fieldsMask: FIELD_TO_MASK[field],
      });
    }
  }

  // 既存ドキュメントをチャンク単位で取得（ピークメモリ抑制、Issue #217）
  // スナップショットは chunk 内で真偽値に畳み、chunk をまたいで保持しない。飽和した search_index 文書は
  // 1件で最大 1MiB あり、保持すると 512MiB の関数で OOM を再発させうる(Issue #217/#984)。
  const tokenIds = Array.from(tokenMap.keys());
  const indexRefs = tokenIds.map(id => db.collection('search_index').doc(id));
  const existingSet = new Set<string>();
  const hadPostingSet = new Set<string>();
  for (const refChunk of chunkArray(indexRefs, GET_ALL_CHUNK_SIZE)) {
    const existingDocs = await db.getAll(...refChunk);
    for (const d of existingDocs) {
      if (!d.exists) continue;
      existingSet.add(d.id);
      if (hasPostingFor(d, docId)) hadPostingSet.add(d.id);
    }
  }

  // 書込み操作を組み立てる（新規と既存を分けて処理）
  const ops: TokenWriteOp[] = [];
  for (const [tokenId, data] of tokenMap) {
    const ref = db.collection('search_index').doc(tokenId);
    const posting = {
      score: data.score,
      fieldsMask: data.fieldsMask,
      updatedAt: now,
    };

    if (existingSet.has(tokenId)) {
      const hadPosting = hadPostingSet.has(tokenId);
      // 既存: updateでドット表記を使用（ネストとして解釈される）。
      // df は、この書類の posting がまだ無い場合だけ加算する。
      ops.push({
        tokenId,
        ref,
        kind: 'update',
        hadPosting,
        data: {
          updatedAt: now,
          ...(hadPosting ? {} : { df: FieldValue.increment(1) }),
          [`postings.${docId}`]: posting,
        },
      });
    } else {
      // 新規: setでpostingsをネストされたオブジェクトとして設定
      ops.push({
        tokenId,
        ref,
        kind: 'set',
        hadPosting: false,
        data: {
          updatedAt: now,
          df: 1,
          postings: { [docId]: posting },
        },
      });
    }
  }

  try {
    await commitOps(ops);
    return { skippedTokenIds: [] };
  } catch (error) {
    if (!isFirestoreDocumentSizeExceededError(error)) {
      logIndexWriteFailed(docId, error);
      throw error;
    }
  }

  // フォールバック: サイズ超過のトークンだけスキップして、残りを個別に書く。
  // 60秒 timeout と部分状態の増幅を抑えるため、chunkArray で件数を制限して並列化する。
  const startedAt = Date.now();
  const sizeFailedOps: TokenWriteOp[] = [];
  for (const opChunk of chunkArray(ops, GET_ALL_CHUNK_SIZE)) {
    const results = await Promise.allSettled(opChunk.map(op => writeOp(op)));
    let fatal: { error: unknown } | undefined;
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') return;
      if (isFirestoreDocumentSizeExceededError(result.reason)) {
        sizeFailedOps.push(opChunk[i]!);
      } else if (!fatal) {
        fatal = { error: result.reason };
      }
    });
    if (fatal) {
      logIndexWriteFailed(docId, fatal.error);
      throw fatal.error;
    }
  }

  // batch はサイズ超過で失敗したが、個別書込みは全て成功した場合(他の書込みと競合して容量が空いた等)は、
  // スキップが無いので何も記録しない(skipped=0 のログで metric を誤って動かさない)
  if (sizeFailedOps.length === 0) return { skippedTokenIds: [] };

  // 既に posting がある(=索引に残っている)トークンは skipped に含めない
  const skippedTokenIds = sizeFailedOps.filter(op => !op.hadPosting).map(op => op.tokenId);
  console.error(
    `[searchIndexer] token skipped: document size limit docId=${docId} ` +
      `skipped=${skippedTokenIds.length} keptExisting=${sizeFailedOps.length - skippedTokenIds.length} ` +
      `total=${ops.length} tokenIds=${skippedTokenIds.join(',')} elapsedMs=${Date.now() - startedAt}`
  );
  return { skippedTokenIds };
}

/**
 * ドキュメントを検索インデックスから削除
 */
async function removeDocumentFromIndex(docId: string, tokens: string[]): Promise<void> {
  await removeTokensFromIndex(docId, tokens);
}

/**
 * 特定のトークンからドキュメントを削除
 */
async function removeTokensFromIndex(docId: string, tokens: string[]): Promise<void> {
  const batch = db.batch();

  for (const token of tokens) {
    const tokenId = generateTokenId(token);
    const indexRef = db.collection('search_index').doc(tokenId);
    batch.update(indexRef, {
      [`postings.${docId}`]: FieldValue.delete(),
      df: FieldValue.increment(-1),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    if (isFirestoreNotFoundError(error)) {
      // インデックスエントリ不在は冪等な削除として正常扱い (既削除/未作成いずれも該当)
      console.warn(`Search index entry not found while removing tokens for ${docId} (idempotent skip)`);
      return;
    }
    // Firestore権限/ネットワーク/クォータ等の障害は console.error として残し監視/アラート対象化する。
    // 注意: console.error は Cloud Logging で severity=ERROR に昇格されず DEFAULT のまま記録される(Issue #981)。
    // `search_index_silent_failure` メトリクスは severity ではなく textPayload(`Failed to remove tokens`)で検知する。
    console.error(`Failed to remove tokens from search index for ${docId}:`, error);
  }
}

/**
 * dfを更新（初回インデックス作成用）
 */
export async function updateDocumentFrequency(tokenId: string, delta: number): Promise<void> {
  const indexRef = db.collection('search_index').doc(tokenId);
  await indexRef.update({
    df: FieldValue.increment(delta),
  });
}
