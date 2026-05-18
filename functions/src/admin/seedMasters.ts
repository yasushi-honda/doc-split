/**
 * マスターデータシード用Cloud Function
 *
 * 使用方法:
 *   firebase functions:shell
 *   > seedDocumentMasters()
 *
 * または HTTP経由:
 *   curl -X POST https://asia-northeast1-doc-split-dev.cloudfunctions.net/seedDocumentMasters \
 *     -H "Authorization: Bearer $(gcloud auth print-identity-token)"
 */

import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore'
import { initializeApp, getApps } from 'firebase-admin/app'
import {
  normalizeForMatching,
  COMMON_SHORT_LENGTH_THRESHOLD,
} from '../../../shared/officeMasterValidation'

if (getApps().length === 0) {
  initializeApp()
}

const db = getFirestore()

/**
 * シードマスター name の最小許容長 (Issue #506)。
 *
 * 短マスター ("ケア" 2/「ニック」3 等) はそれ自体が CSV import 由来の汚染パターンで
 * あり、seed には絶対に混入させない。`shared/officeMasterValidation.ts` の
 * `COMMON_SHORT_LENGTH_THRESHOLD` を共有 (Evaluator 指摘 HIGH #4: 定数 drift 防止)。
 * 判定は **normalize 後の length** で行う (raw length と shared 側挙動の不一致を回避)。
 */
const MIN_SEED_MASTER_NAME_LENGTH = COMMON_SHORT_LENGTH_THRESHOLD

/**
 * 既存マスターを name で lookup し、あれば merge update、なければ auto ID で create
 * する upsert pattern (Issue #506)。
 *
 * 旧実装の `db.collection(...).doc(name)` + `{ merge: true }` は id=name で固定する
 * 副作用で「ケア」「ニック」のような日本語 ID 汚染を生み出す経路だった。本関数は
 * id を auto-generate しつつ name 単位の冪等性を担保する。
 */
async function upsertMastersByName(
  firestore: Firestore,
  collection: string,
  items: Array<Record<string, unknown> & { name: string }>,
): Promise<number> {
  let count = 0
  for (const item of items) {
    if (typeof item.name !== 'string' || item.name.length === 0) {
      throw new Error(`Seed master name is empty or non-string: ${JSON.stringify(item)}`)
    }
    // #506 #507 Evaluator HIGH #4: normalize 後 length で判定 (shared と同一仕様)
    const normalizedLength = normalizeForMatching(item.name).length
    if (normalizedLength < MIN_SEED_MASTER_NAME_LENGTH) {
      throw new Error(
        `Seed master name too short: "${item.name}" (normalized length=${normalizedLength} < ${MIN_SEED_MASTER_NAME_LENGTH}). 短マスターは CSV import 由来の汚染パターンであり seed では拒否します。`,
      )
    }
    const existing = await firestore.collection(collection).where('name', '==', item.name).limit(1).get()
    if (!existing.empty) {
      await existing.docs[0]!.ref.set(
        { ...item, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
    } else {
      await firestore.collection(collection).add({
        ...item,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    count++
  }
  return count
}

// 書類種別マスターデータ
const DOCUMENT_MASTERS = [
  { name: 'フェースシート', dateMarker: '作成日', category: '基本情報', keywords: ['フェイスシート', '基本情報', '利用者情報'] },
  { name: '介護保険被保険者証', dateMarker: '有効期限', category: '保険証', keywords: ['被保険者証', '介護保険', '要介護'] },
  { name: '負担割合証', dateMarker: '適用期間', category: '保険証', keywords: ['負担割合', '利用者負担'] },
  { name: '居宅サービス計画書（1）', dateMarker: '作成年月日', category: 'ケアプラン', keywords: ['居宅サービス計画', '援助の方針'] },
  { name: '居宅サービス計画書（2）', dateMarker: '作成年月日', category: 'ケアプラン', keywords: ['週間サービス計画表'] },
  { name: 'サービス担当者会議の要点', dateMarker: '開催日', category: '会議録', keywords: ['サービス担当者会議', '会議の要点'] },
  { name: '訪問介護計画書', dateMarker: '作成日', category: 'サービス計画', keywords: ['訪問介護', 'サービス内容'] },
  { name: '訪問看護計画書', dateMarker: '作成日', category: 'サービス計画', keywords: ['訪問看護', '看護計画'] },
  { name: '通所介護計画書', dateMarker: '作成日', category: 'サービス計画', keywords: ['通所介護', 'デイサービス'] },
  { name: '福祉用具貸与計画書', dateMarker: '作成日', category: 'サービス計画', keywords: ['福祉用具', '貸与'] },
  { name: '住宅改修理由書', dateMarker: '作成日', category: '申請書類', keywords: ['住宅改修', '理由書'] },
  { name: '主治医意見書', dateMarker: '記載日', category: '医療', keywords: ['主治医', '意見書', '要介護認定'] },
  { name: '診断書', dateMarker: '発行日', category: '医療', keywords: ['診断書', '診断名'] },
  { name: '情報提供書', dateMarker: '発行日', category: '医療', keywords: ['情報提供', '病状'] },
  { name: '同意書', dateMarker: '同意日', category: '契約', keywords: ['同意書', '重要事項説明'] },
  { name: '契約書', dateMarker: '契約日', category: '契約', keywords: ['契約書', '利用契約'] },
]

// 顧客マスターサンプルデータ
const CUSTOMER_MASTERS = [
  { name: '山田太郎', furigana: 'やまだたろう', isDuplicate: false },
  { name: '鈴木花子', furigana: 'すずきはなこ', isDuplicate: false },
  { name: '佐藤一郎', furigana: 'さとういちろう', isDuplicate: false },
  { name: '田中美咲', furigana: 'たなかみさき', isDuplicate: false },
  { name: '伊藤健太', furigana: 'いとうけんた', isDuplicate: false },
]

// 事業所マスターサンプルデータ
const OFFICE_MASTERS = [
  { name: 'ケアステーション山田' },
  { name: '訪問介護センター鈴木' },
  { name: 'デイサービスさくら' },
  { name: '居宅介護支援事業所あおば' },
  { name: '訪問看護ステーションひまわり' },
]

// ケアマネジャーマスターサンプルデータ
const CAREMANAGER_MASTERS = [
  { name: '高橋和子', office: '居宅介護支援事業所あおば', phone: '03-1234-5678', email: '', notes: '' },
  { name: '渡辺誠', office: 'ケアステーション山田', phone: '03-2345-6789', email: '', notes: '' },
  { name: '中村由美', office: '居宅介護支援事業所あおば', phone: '03-3456-7890', email: '', notes: '' },
]

/**
 * 書類種別マスターをシード
 */
export const seedDocumentMasters = onRequest(
  { region: 'asia-northeast1', memory: '256MiB' },
  async (req, res) => {
    try {
      // #506: doc(name) → name lookup + auto ID upsert に統一 (汚染経路潰し)
      const count = await upsertMastersByName(db, 'masters/documents/items', DOCUMENT_MASTERS)

      const message = `書類種別マスター ${count}件 シード完了`
      console.log(message)
      res.json({ success: true, message, count })
    } catch (error) {
      console.error('シードエラー:', error)
      res.status(500).json({ success: false, error: String(error) })
    }
  }
)

/**
 * 全マスターデータをシード
 */
export const seedAllMasters = onRequest(
  { region: 'asia-northeast1', memory: '256MiB' },
  async (req, res) => {
    try {
      const results: Record<string, number> = {}

      // #506: 全 master を name lookup + auto ID upsert pattern に統一
      // (旧実装の doc(name) は id=name 固定で「ケア」「ニック」等の日本語 ID 汚染を
      // 生む経路だった。新実装は冪等性を name 一意性で担保しつつ auto ID 化)
      results.documents = await upsertMastersByName(db, 'masters/documents/items', DOCUMENT_MASTERS)
      results.customers = await upsertMastersByName(db, 'masters/customers/items', CUSTOMER_MASTERS)
      results.offices = await upsertMastersByName(db, 'masters/offices/items', OFFICE_MASTERS)
      results.caremanagers = await upsertMastersByName(db, 'masters/caremanagers/items', CAREMANAGER_MASTERS)

      console.log('全マスターデータシード完了:', results)
      res.json({ success: true, results })
    } catch (error) {
      console.error('シードエラー:', error)
      res.status(500).json({ success: false, error: String(error) })
    }
  }
)
