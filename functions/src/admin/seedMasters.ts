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
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { initializeApp, getApps } from 'firebase-admin/app'

if (getApps().length === 0) {
  initializeApp()
}

const db = getFirestore()

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
      const batch = db.batch()

      for (const doc of DOCUMENT_MASTERS) {
        const ref = db.collection('masters/documents/items').doc(doc.name)
        batch.set(ref, {
          ...doc,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }

      await batch.commit()

      const message = `書類種別マスター ${DOCUMENT_MASTERS.length}件 シード完了`
      console.log(message)
      res.json({ success: true, message, count: DOCUMENT_MASTERS.length })
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

      // 書類種別
      const docBatch = db.batch()
      for (const doc of DOCUMENT_MASTERS) {
        const ref = db.collection('masters/documents/items').doc(doc.name)
        docBatch.set(ref, {
          ...doc,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      await docBatch.commit()
      results.documents = DOCUMENT_MASTERS.length

      // 顧客
      const custBatch = db.batch()
      for (const cust of CUSTOMER_MASTERS) {
        const ref = db.collection('masters/customers/items').doc(cust.name)
        custBatch.set(ref, {
          ...cust,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      await custBatch.commit()
      results.customers = CUSTOMER_MASTERS.length

      // 事業所
      const officeBatch = db.batch()
      for (const office of OFFICE_MASTERS) {
        const ref = db.collection('masters/offices/items').doc(office.name)
        officeBatch.set(ref, {
          ...office,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      await officeBatch.commit()
      results.offices = OFFICE_MASTERS.length

      // ケアマネジャー
      const cmBatch = db.batch()
      for (const cm of CAREMANAGER_MASTERS) {
        const ref = db.collection('masters/caremanagers/items').doc(cm.name)
        cmBatch.set(ref, {
          ...cm,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      await cmBatch.commit()
      results.caremanagers = CAREMANAGER_MASTERS.length

      console.log('全マスターデータシード完了:', results)
      res.json({ success: true, results })
    } catch (error) {
      console.error('シードエラー:', error)
      res.status(500).json({ success: false, error: String(error) })
    }
  }
)
