/**
 * マスターデータ管理フック
 * 顧客・書類・事業所・ケアマネのCRUD操作
 */

import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  doc,
  getDocs,
  getDocsFromServer,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  type QuerySnapshot,
  type DocumentData,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { normalizeName } from '@/lib/textNormalizer'
import type {
  CustomerMaster,
  DocumentMaster,
  OfficeMaster,
  CareManagerMaster,
} from '@shared/types'
import { validateOfficeMasterImport } from '@shared/officeMasterValidation'
import { findSameNameCollisionNames } from '@shared/customerIdentity'
import { buildContractEndedLookup, type ContractEndedLookup } from '@/lib/contractEnded'

// 重複エラークラス
export class DuplicateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateError'
  }
}

/**
 * 短マスター混入 reject エラー (#506)。
 *
 * CSV import 由来の汚染パターン (「ケア」「ニック」等、length<4 で他マスター name の
 * substring に頻出するもの) を登録しようとした際に発火する。誤分類を未然に防ぐため
 * 操作者へのフィードバックとして利用。
 */
export class ShortMasterRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShortMasterRejectedError'
  }
}

// マスターデータのコレクションパス
const COLLECTION_PATHS = {
  customers: 'masters/customers/items',
  documents: 'masters/documents/items',
  offices: 'masters/offices/items',
  caremanagers: 'masters/caremanagers/items',
} as const

// ============================================
// 顧客マスター
// ============================================

function mapCustomerMastersSnapshot(snapshot: QuerySnapshot<DocumentData>): CustomerMaster[] {
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    name: doc.data().name as string,
    // #338: shared/types.ts 側を optional に統一したため、reader では `as ... | undefined` で honesty cast する。
    // 旧 `as string` / `as boolean` だと shared の optional 化が type system 上で骨抜きになり、
    // `.includes`/`.trim` 等の downstream 呼出で runtime crash する silent failure 経路が残る。
    isDuplicate: doc.data().isDuplicate as boolean | undefined,
    furigana: doc.data().furigana as string | undefined,
    careManagerName: doc.data().careManagerName as string | undefined,
    notes: doc.data().notes as string | undefined,
    aliases: doc.data().aliases as string[] | undefined,
    isContractEnded: doc.data().isContractEnded as boolean | undefined,
  }))
}

// Issue #1033: frontend/src/hooks/useDocuments.ts の useCustomerMasters もこの関数を使う
// (queryKey ['masters','customers'] を共有しているため、フィールド構成が異なる別の取得関数を
// 使うとどちらが先にキャッシュを埋めるかでフィールドが欠落する。/plan-crossreview codex指摘)
export async function fetchCustomers(): Promise<CustomerMaster[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.customers))
  return mapCustomerMastersSnapshot(snapshot)
}

export function useCustomers() {
  return useQuery({
    queryKey: ['masters', 'customers'],
    queryFn: fetchCustomers,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * 現場管理者への「同姓同名」プロアクティブ通知UI用の共通lookup(2026-07-26)。
 * useCustomers()のキャッシュ(queryKey: ['masters','customers'])をそのまま利用するため
 * 追加フェッチは発生しない。TanStack Queryのstaletime(5分)内はマスター追加が即時反映
 * されない点に注意(BE customerAmbiguityGate.tsはFirestoreへライブクエリのため常に最新)。
 *
 * コンテナ層のみで呼び出し、行コンポーネントへはpropで結果を渡すこと(単体テスト容易性のため)。
 */
export interface CustomerIdentityLookup {
  /**
   * 顧客マスターの読み込みが完了しているか(`useCustomers()`のクエリが解決済みか)。
   * falseの間は`sameNameCollisionNames`/`customerMasterNameById`が空集合になり、
   * 「同姓同名なし」と「まだ読み込んでいない」を区別できない。書き込みを伴う判定
   * (confirmOnVerify等)はisReady:trueになるまで評価を見送ること(Issue #1034)。
   */
  isReady: boolean
  /** 完全一致で2件以上あるマスター名の集合(shared/customerIdentity.tsのfindSameNameCollisionNames)。 */
  sameNameCollisionNames: ReadonlySet<string>
  /**
   * customerId → マスターのname。フィールド欠損・非文字列はnull(functions/src/drive/
   * customerAmbiguityGate.tsの`customerMaster?.name ?? null`と同一のnull集合)。
   * Map miss(id不明)はundefinedになり、customerId↔name乖離チェックをスキップする
   * (呼出元がresolveCustomerUnconfirmedReasonへ渡す際は`?? null`で吸収する)。
   */
  customerMasterNameById: ReadonlyMap<string, string | null>
}

export function useCustomerIdentityLookup(): CustomerIdentityLookup {
  const { data: customers } = useCustomers()
  return useMemo(() => ({
    // customers === undefined はクエリ未解決(読み込み中)を表す。読み込み中は
    // sameNameCollisionNames/customerMasterNameByIdが空集合になり「同姓同名なし」と
    // 区別がつかないため、isReadyで呼出元(confirmOnVerify等、書き込みを伴う判定)に
    // 明示的に伝える(Issue #1034、codexレビュー指摘: 読込中の誤判定防止)。
    isReady: customers !== undefined,
    sameNameCollisionNames: findSameNameCollisionNames(customers ?? []),
    customerMasterNameById: new Map(
      (customers ?? []).map((c) => [c.id, typeof c.name === 'string' ? c.name : null])
    ),
  }), [customers])
}

/**
 * 契約終了した利用者の書類を非表示にする判定用lookup(Issue #1033)。
 * useCustomers()のキャッシュをそのまま使うため追加フェッチは発生しない。
 */
export function useContractEndedLookup(): ContractEndedLookup {
  const { data: customers } = useCustomers()
  return useMemo(() => buildContractEndedLookup(customers), [customers])
}

/**
 * `useCustomers()`のReact Queryキャッシュ(staleTime 5分)を経由せず、Firestoreから
 * 直接最新の顧客マスター一覧を取得してCustomerIdentityLookup相当を組み立てる。
 *
 * Issue #1034 + codexレビュー指摘(P1、2回目): 確認済み操作の確定判定は
 * `useDocumentVerification`/`handleBulkVerify`内のFirestoreトランザクションで
 * 文書そのものは直前に再読込するようにしたが、同姓同名判定に使う顧客マスター側は
 * キャッシュ経由のままだった。確定操作の直前にこの関数で新規取得したマスター一覧を
 * 使うことで、直近に追加・改名された同姓同名マスターも判定に反映される
 * (`scripts/backfill-confirm-on-verify.ts`が実行開始時にマスターを都度フェッチするのと
 * 同じ理由。ただしこちらは確定操作のたびに呼ぶため、backfillの「実行中の一度きり
 * スナップショット」よりさらに鮮度が高い)。
 *
 * codexレビュー指摘(P1、7回目): `getDocs()`(既定)はSDKのローカルキャッシュ(IndexedDB
 * 永続化が有効な場合、オフライン時等)から解決されうるため、「新規取得」の意図に反して
 * 古いマスター一覧を返す恐れがあった。`getDocsFromServer()`でサーバーへの到達を強制し、
 * 到達できない場合は例外をそのまま呼出元へ伝播させる(fail-closed。呼出元は失敗時、
 * 確定判定をスキップしてverifiedのみ更新する、または一括操作全体を中断する設計)。
 */
export async function fetchFreshCustomerIdentityLookup(): Promise<Omit<CustomerIdentityLookup, 'isReady'>> {
  const snapshot = await getDocsFromServer(collection(db, COLLECTION_PATHS.customers))
  const customers = mapCustomerMastersSnapshot(snapshot)
  return {
    sameNameCollisionNames: findSameNameCollisionNames(customers),
    customerMasterNameById: new Map(customers.map((c) => [c.id, typeof c.name === 'string' ? c.name : null])),
  }
}

interface AddCustomerParams {
  name: string
  furigana: string
  isDuplicate?: boolean
  careManagerName?: string
  notes?: string
  force?: boolean // 同名が存在しても強制追加
}

// 同名顧客の存在チェック（UIでの確認用）
export async function checkCustomerDuplicate(name: string): Promise<boolean> {
  const normalizedName = normalizeName(name)
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.customers))
  const existingNames = new Set(snapshot.docs.map(d => d.data().name))
  return existingNames.has(normalizedName)
}

async function addCustomer(params: AddCustomerParams): Promise<string> {
  const normalizedName = normalizeName(params.name)

  // 重複チェック（force=trueの場合はスキップ）
  if (!params.force) {
    const snapshot = await getDocs(collection(db, COLLECTION_PATHS.customers))
    const existingNames = new Set(snapshot.docs.map(d => d.data().name))
    if (existingNames.has(normalizedName)) {
      throw new DuplicateError(`「${normalizedName}」は既に登録されています`)
    }
  }

  const docRef = doc(collection(db, COLLECTION_PATHS.customers))
  const data: Record<string, unknown> = {
    name: normalizedName,
    furigana: normalizeName(params.furigana),
    isDuplicate: params.isDuplicate ?? true, // 同名追加時はデフォルトtrue
  }
  if (params.careManagerName) {
    data.careManagerName = params.careManagerName
  }
  if (params.notes) {
    data.notes = params.notes
  }
  await setDoc(docRef, data)
  return docRef.id
}

export function useAddCustomer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: addCustomer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'customers'] })
    },
  })
}

interface UpdateCustomerParams {
  id: string
  name: string
  furigana: string
  isDuplicate: boolean
  careManagerName?: string
  notes?: string
  isContractEnded?: boolean
}

async function updateCustomer(params: UpdateCustomerParams): Promise<void> {
  const docRef = doc(db, COLLECTION_PATHS.customers, params.id)
  const data: Record<string, unknown> = {
    name: normalizeName(params.name),
    furigana: normalizeName(params.furigana),
    isDuplicate: params.isDuplicate,
  }
  // careManagerName は空文字の場合も保存（削除のため）
  if (params.careManagerName !== undefined) {
    data.careManagerName = params.careManagerName || null
  }
  // notes は空文字の場合も保存（削除のため）
  if (params.notes !== undefined) {
    data.notes = params.notes || null
  }
  // isContractEnded は undefined の場合は送信しない（部分更新の対象外フィールドを変更しない、Issue #1033）
  if (params.isContractEnded !== undefined) {
    data.isContractEnded = params.isContractEnded
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await updateDoc(docRef, data as any)
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateCustomer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'customers'] })
    },
  })
}

async function deleteCustomer(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION_PATHS.customers, id))
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'customers'] })
    },
  })
}

// 顧客一括インポート
interface BulkCustomerParams {
  name: string
  furigana: string
  isDuplicate?: boolean
}

// CSVデータの同名チェック（プレビュー用）
export async function checkCustomerDuplicatesInBulk(
  customers: BulkCustomerParams[]
): Promise<{ name: string; furigana: string; isDuplicate: boolean }[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.customers))
  const existingNames = new Set(snapshot.docs.map(d => d.data().name))

  return customers.map(c => {
    const normalizedName = normalizeName(c.name)
    return {
      name: normalizedName,
      furigana: c.furigana,
      isDuplicate: existingNames.has(normalizedName),
    }
  })
}

async function bulkImportCustomers(
  customers: BulkCustomerParams[]
): Promise<{ imported: number; skipped: number; duplicateImported: number }> {
  // 既存データを取得
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.customers))
  const existingNames = new Set(snapshot.docs.map(d => d.data().name))

  let imported = 0
  let skipped = 0
  let duplicateImported = 0

  for (const customer of customers) {
    const normalizedName = normalizeName(customer.name)
    if (!normalizedName) {
      skipped++
      continue
    }

    const isDuplicateInDb = existingNames.has(normalizedName)

    const docRef = doc(collection(db, COLLECTION_PATHS.customers))
    await setDoc(docRef, {
      name: normalizedName,
      furigana: normalizeName(customer.furigana),
      isDuplicate: isDuplicateInDb ? true : (customer.isDuplicate || false),
    })

    if (isDuplicateInDb) {
      duplicateImported++
    }
    imported++
    existingNames.add(normalizedName)
  }

  return { imported, skipped, duplicateImported }
}

export function useBulkImportCustomers() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkImportCustomers,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'customers'] })
    },
  })
}

// ============================================
// 書類マスター
// ============================================

/**
 * keywords フィールドを安全に正規化
 * - undefined/null → 空配列
 * - string → セミコロン区切りで分割
 * - string[] → そのまま
 * - 2文字未満のキーワードは除外
 */
function normalizeKeywords(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .filter((k): k is string => typeof k === 'string')
      .map((k) => k.trim())
      .filter((k) => k.length >= 2)
  }
  if (typeof value === 'string') {
    return value
      .split(';')
      .map((k) => k.trim())
      .filter((k) => k.length >= 2)
  }
  return []
}

async function fetchDocumentTypes(): Promise<DocumentMaster[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.documents))
  return snapshot.docs.map((doc) => ({
    name: doc.data().name as string,
    // #338: shared 側の optional と整合させる honesty cast。silent force cast 禁止。
    dateMarker: doc.data().dateMarker as string | undefined,
    category: doc.data().category as string | undefined,
    keywords: normalizeKeywords(doc.data().keywords),
    aliases: doc.data().aliases as string[] | undefined,
  }))
}

export function useDocumentTypes() {
  return useQuery({
    queryKey: ['masters', 'documents'],
    queryFn: fetchDocumentTypes,
    staleTime: 5 * 60 * 1000,
  })
}

interface AddDocumentTypeParams {
  name: string
  dateMarker: string
  category: string
  keywords?: string | string[] // セミコロン区切りの文字列または配列
}

async function addDocumentType(params: AddDocumentTypeParams): Promise<void> {
  // 重複チェック
  const docRef = doc(db, COLLECTION_PATHS.documents, params.name)
  const existingDoc = await getDoc(docRef)
  if (existingDoc.exists()) {
    throw new DuplicateError(`「${params.name}」は既に登録されています`)
  }

  await setDoc(docRef, {
    name: params.name,
    dateMarker: params.dateMarker,
    category: params.category,
    keywords: normalizeKeywords(params.keywords),
  })
}

export function useAddDocumentType() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: addDocumentType,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'documents'] })
    },
  })
}

interface UpdateDocumentTypeParams {
  originalName: string
  name: string
  dateMarker: string
  category: string
  keywords?: string // セミコロン区切りの文字列
}

async function updateDocumentType(params: UpdateDocumentTypeParams): Promise<void> {
  // 名前が変わった場合は削除して再作成
  if (params.originalName !== params.name) {
    await deleteDoc(doc(db, COLLECTION_PATHS.documents, params.originalName))
  }
  const docRef = doc(db, COLLECTION_PATHS.documents, params.name)
  await setDoc(docRef, {
    name: params.name,
    dateMarker: params.dateMarker,
    category: params.category,
    keywords: normalizeKeywords(params.keywords),
  })
}

export function useUpdateDocumentType() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateDocumentType,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'documents'] })
    },
  })
}

async function deleteDocumentType(name: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION_PATHS.documents, name))
}

// ============================================
// 書類種別シードデータ
// ============================================

/** 介護関係の書類種別シードデータ */
export const DOCUMENT_TYPE_SEEDS = [
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
] as const

async function importDocumentTypeSeeds(): Promise<{ imported: number; skipped: number }> {
  // 既存データを取得
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.documents))
  const existingNames = new Set(snapshot.docs.map(d => d.data().name))

  let imported = 0
  let skipped = 0

  for (const seed of DOCUMENT_TYPE_SEEDS) {
    if (existingNames.has(seed.name)) {
      skipped++
      continue
    }

    const docRef = doc(db, COLLECTION_PATHS.documents, seed.name)
    await setDoc(docRef, {
      name: seed.name,
      dateMarker: seed.dateMarker,
      category: seed.category,
      keywords: seed.keywords,
    })
    imported++
  }

  return { imported, skipped }
}

export function useImportDocumentTypeSeeds() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: importDocumentTypeSeeds,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'documents'] })
    },
  })
}

// 書類種別一括インポート
interface BulkDocumentTypeParams {
  name: string
  dateMarker: string
  category: string
  keywords: string
}

async function bulkImportDocumentTypes(
  documentTypes: BulkDocumentTypeParams[]
): Promise<{ imported: number; skipped: number }> {
  // 既存データを取得
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.documents))
  const existingNames = new Set(snapshot.docs.map(d => d.data().name))

  let imported = 0
  let skipped = 0

  for (const docType of documentTypes) {
    if (!docType.name || existingNames.has(docType.name)) {
      skipped++
      continue
    }

    const docRef = doc(db, COLLECTION_PATHS.documents, docType.name)
    await setDoc(docRef, {
      name: docType.name,
      dateMarker: docType.dateMarker || '',
      category: docType.category || '',
      keywords: docType.keywords
        ? docType.keywords.split(';').map(k => k.trim()).filter(k => k.length >= 2)
        : [],
    })
    imported++
    existingNames.add(docType.name)
  }

  return { imported, skipped }
}

export function useBulkImportDocumentTypes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkImportDocumentTypes,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'documents'] })
    },
  })
}

export function useDeleteDocumentType() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteDocumentType,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'documents'] })
    },
  })
}

// ============================================
// 事業所マスター
// ============================================

async function fetchOffices(): Promise<OfficeMaster[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.offices))
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    name: doc.data().name as string,
    shortName: doc.data().shortName as string | undefined,
    isDuplicate: doc.data().isDuplicate ?? false,
    notes: doc.data().notes as string | undefined,
    aliases: doc.data().aliases as string[] | undefined,
  }))
}

export function useOffices() {
  return useQuery({
    queryKey: ['masters', 'offices'],
    queryFn: fetchOffices,
    staleTime: 5 * 60 * 1000,
  })
}

interface AddOfficeParams {
  name: string
  shortName?: string
  notes?: string
  force?: boolean // 同名が存在しても強制追加
}

// 同名事業所の存在チェック（UIでの確認用）
export async function checkOfficeDuplicate(name: string): Promise<boolean> {
  const normalizedName = normalizeName(name)
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.offices))
  const existingNames = new Set(snapshot.docs.map(d => d.data().name))
  return existingNames.has(normalizedName)
}

async function addOffice(params: AddOfficeParams | string): Promise<string> {
  // 後方互換性: 文字列の場合は従来の動作
  const name = typeof params === 'string' ? params : params.name
  const shortName = typeof params === 'string' ? undefined : params.shortName
  const notes = typeof params === 'string' ? undefined : params.notes
  const force = typeof params === 'string' ? false : params.force

  const normalizedName = normalizeName(name)

  // #506: 短マスター混入予防 collision-based validation
  // 既存マスター全件と比較し、length<4 かつ他マスター name の substring に頻出する
  // 短マスター ("ケア"・"ニック" 等の汚染パターン) は登録を拒否。
  const existingSnapshot = await getDocs(collection(db, COLLECTION_PATHS.offices))
  const existing = existingSnapshot.docs.map(d => ({ id: d.id, name: (d.data().name as string) || '' }))
  const verdict = validateOfficeMasterImport({ id: '__new__', name: normalizedName }, existing)
  if (verdict.kind === 'reject-short-common') {
    throw new ShortMasterRejectedError(
      `「${normalizedName}」は他事業所名の一部として頻出する短い名前のため登録できません (誤分類の原因になります)。`,
    )
  }
  if (verdict.kind === 'warning-short-uncommon') {
    console.warn(`[short master warning] "${normalizedName}" は短い名前です。誤入力でないか確認してください。`)
  }

  // 重複チェック（force=trueの場合はスキップ）
  if (!force) {
    const docRef = doc(db, COLLECTION_PATHS.offices, normalizedName)
    const existingDoc = await getDoc(docRef)
    if (existingDoc.exists()) {
      throw new DuplicateError(`「${normalizedName}」は既に登録されています`)
    }
  }

  // 同名追加時は別のIDで作成
  const docRef = force
    ? doc(collection(db, COLLECTION_PATHS.offices))
    : doc(db, COLLECTION_PATHS.offices, normalizedName)
  const data: Record<string, unknown> = {
    name: normalizedName,
    shortName: shortName ? normalizeName(shortName) : '',
  }
  if (notes) {
    data.notes = notes
  }
  await setDoc(docRef, data)
  return docRef.id
}

export function useAddOffice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: addOffice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'offices'] })
    },
  })
}

async function deleteOffice(name: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION_PATHS.offices, name))
}

export function useDeleteOffice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteOffice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'offices'] })
    },
  })
}

interface UpdateOfficeParams {
  originalName: string
  name: string
  shortName?: string
  notes?: string
}

async function updateOffice(params: UpdateOfficeParams): Promise<void> {
  const normalizedName = normalizeName(params.name)
  const normalizedShortName = params.shortName ? normalizeName(params.shortName) : ''

  // 名前が変わった場合は削除して再作成
  if (params.originalName !== normalizedName) {
    await deleteDoc(doc(db, COLLECTION_PATHS.offices, params.originalName))
  }

  const docRef = doc(db, COLLECTION_PATHS.offices, normalizedName)
  const data: Record<string, unknown> = {
    name: normalizedName,
    shortName: normalizedShortName,
  }
  // notes は空文字の場合も保存（削除のため）
  if (params.notes !== undefined) {
    data.notes = params.notes || null
  }
  await setDoc(docRef, data)
}

export function useUpdateOffice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateOffice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'offices'] })
    },
  })
}

// 事業所一括インポート
interface BulkOfficeParams {
  name: string
  shortName?: string
}

// CSVデータの同名チェック（プレビュー用）
export async function checkOfficeDuplicatesInBulk(
  offices: BulkOfficeParams[]
): Promise<{ name: string; shortName: string; isDuplicate: boolean }[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.offices))
  const existingNames = new Set(snapshot.docs.map(d => d.data().name))

  return offices.map(o => {
    const normalizedName = normalizeName(o.name)
    return {
      name: normalizedName,
      shortName: o.shortName || '',
      isDuplicate: existingNames.has(normalizedName),
    }
  })
}

async function bulkImportOffices(
  offices: BulkOfficeParams[]
): Promise<{ imported: number; skipped: number; duplicateImported: number }> {
  // 既存データを取得
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.offices))
  const existingNames = new Set(snapshot.docs.map(d => d.data().name))

  let imported = 0
  let skipped = 0
  let duplicateImported = 0

  for (const office of offices) {
    const normalizedName = normalizeName(office.name)
    if (!normalizedName) {
      skipped++
      continue
    }

    const isDuplicateInDb = existingNames.has(normalizedName)

    // 同名でも別IDで作成
    const docRef = doc(collection(db, COLLECTION_PATHS.offices))
    await setDoc(docRef, {
      name: normalizedName,
      shortName: office.shortName ? normalizeName(office.shortName) : '',
    })

    if (isDuplicateInDb) {
      duplicateImported++
    }
    imported++
    existingNames.add(normalizedName)
  }

  return { imported, skipped, duplicateImported }
}

export function useBulkImportOffices() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkImportOffices,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'offices'] })
    },
  })
}

// ============================================
// ケアマネマスター
// ============================================

async function fetchCareManagers(): Promise<CareManagerMaster[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.caremanagers))
  return snapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      name: data.name as string,
      email: data.email as string | undefined,
    }
  })
}

export function useCareManagers() {
  return useQuery({
    queryKey: ['masters', 'caremanagers'],
    queryFn: fetchCareManagers,
    staleTime: 5 * 60 * 1000,
  })
}

interface AddCareManagerParams {
  name: string
  email?: string
}

async function addCareManager(params: AddCareManagerParams): Promise<void> {
  const normalizedName = normalizeName(params.name)

  // 重複チェック
  const docRef = doc(db, COLLECTION_PATHS.caremanagers, normalizedName)
  const existingDoc = await getDoc(docRef)
  if (existingDoc.exists()) {
    throw new DuplicateError(`「${normalizedName}」は既に登録されています`)
  }

  const data: Record<string, unknown> = {
    id: docRef.id,
    name: normalizedName,
  }
  if (params.email) {
    data.email = params.email
  }
  await setDoc(docRef, data)
}

export function useAddCareManager() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: addCareManager,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'caremanagers'] })
    },
  })
}

async function deleteCareManager(name: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION_PATHS.caremanagers, name))
}

export function useDeleteCareManager() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteCareManager,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'caremanagers'] })
    },
  })
}

interface UpdateCareManagerParams {
  originalName: string
  name: string
  email?: string
}

async function updateCareManager(params: UpdateCareManagerParams): Promise<void> {
  const normalizedName = normalizeName(params.name)

  // 名前が変わった場合は削除して再作成
  if (params.originalName !== normalizedName) {
    await deleteDoc(doc(db, COLLECTION_PATHS.caremanagers, params.originalName))
  }

  const docRef = doc(db, COLLECTION_PATHS.caremanagers, normalizedName)
  const data: Record<string, unknown> = {
    id: docRef.id,
    name: normalizedName,
  }
  if (params.email !== undefined) {
    data.email = params.email || null // 空文字の場合はnullに
  }
  await setDoc(docRef, data, { merge: true })
}

export function useUpdateCareManager() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateCareManager,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'caremanagers'] })
    },
  })
}

// ============================================
// ケアマネ一括インポート
// ============================================

interface BulkCareManagerParams {
  name: string
}

async function bulkImportCareManagers(
  params: BulkCareManagerParams[]
): Promise<{ imported: number; skipped: number }> {
  // 既存データを取得
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.caremanagers))
  const existing = new Set(snapshot.docs.map((doc) => doc.id))

  let imported = 0
  let skipped = 0

  for (const cm of params) {
    if (!cm.name || existing.has(cm.name)) {
      skipped++
      continue
    }

    const docRef = doc(db, COLLECTION_PATHS.caremanagers, cm.name)
    await setDoc(docRef, {
      name: cm.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    imported++
    existing.add(cm.name)
  }

  return { imported, skipped }
}

export function useBulkImportCareManagers() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkImportCareManagers,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'caremanagers'] })
    },
  })
}

// ============================================
// 共通: 重複チェック・上書きインポート
// ============================================

/**
 * 重複チェック結果（既存データ詳細付き）
 */
export interface DuplicateCheckResultWithDetails<T> {
  csvData: T
  existingData: T | null
  isDuplicate: boolean
}

/**
 * インポートアクション
 */
export type ImportAction = 'add' | 'overwrite' | 'skip'

/**
 * インポート結果（詳細版）
 *
 * failedNames: 書込みに失敗した行(Issue #1036の/plan-crossreview反映#5)。
 * 一括インポートは1件ずつawaitするため、途中の1件が失敗しても以前の行は
 * コミット済みになる。失敗した行をスキップして後続を続行し、結果に含める。
 */
export interface BulkImportResultDetailed {
  added: number
  overwritten: number
  skipped: number
  skippedNames: string[]
  failedNames: string[]
}

/**
 * CSV文字列(区切り文字区切り)をFirestore用のstring[]に変換する。
 * 空文字列・空欄はundefinedを返し、「空欄=変更しない」(値がある列のみ送信する)
 * ルールに対応する(Issue #1036)。
 */
function parseSeparatedListForImport(value: string | undefined, separator: string): string[] | undefined {
  if (!value) return undefined
  const arr = value.split(separator).map(s => s.trim()).filter(s => s.length > 0)
  return arr.length > 0 ? arr : undefined
}

// --- 書類種別の重複チェック（詳細付き） ---
// Issue #1036: aliases列を追加（/plan-crossreview反映#3。チェック関数のinput/output
// 双方を完全なCSV行に拡張しないと、既存データ側にフィールドを足すだけではCSVの
// 備考・別表記・メールがプレビュー〜書込みまで届かない）
export async function checkDocumentTypeDuplicatesWithDetails(
  items: { name: string; dateMarker: string; category: string; keywords: string; aliases?: string }[]
): Promise<DuplicateCheckResultWithDetails<{ name: string; dateMarker: string; category: string; keywords: string; aliases?: string }>[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.documents))
  const existingMap = new Map<string, { name: string; dateMarker: string; category: string; keywords: string; aliases?: string }>()

  snapshot.docs.forEach(d => {
    const data = d.data()
    const keywords = Array.isArray(data.keywords) ? data.keywords.join(';') : ''
    const aliases = Array.isArray(data.aliases) ? data.aliases.join('|') : ''
    existingMap.set(data.name, {
      name: data.name,
      dateMarker: data.dateMarker || '',
      category: data.category || '',
      keywords,
      aliases,
    })
  })

  return items.map(item => ({
    csvData: { ...item, aliases: item.aliases || '' },
    existingData: existingMap.get(item.name) || null,
    isDuplicate: existingMap.has(item.name),
  }))
}

// --- ケアマネの重複チェック（詳細付き） ---
// Issue #1036: email列を追加。existingDataに実doc ID(id)を含める（/plan-crossreview反映#4。
// UIからの新規作成はdoc ID=正規化した名前だが、CLI(scripts/import-masters.js)経由の
// ケアマネはdoc()自動採番のため、名前ベースのdoc()で上書きすると対象不存在になりうる。
// 実doc IDを重複チェック結果に持たせ、上書きはそのIDで行う）
export async function checkCareManagerDuplicatesWithDetails(
  items: { name: string; email?: string }[]
): Promise<DuplicateCheckResultWithDetails<{ name: string; email?: string; id?: string }>[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.caremanagers))
  const existingMap = new Map<string, { name: string; email?: string; id: string }>()

  snapshot.docs.forEach(d => {
    const data = d.data()
    existingMap.set(data.name, {
      name: data.name,
      email: data.email || '',
      id: d.id,
    })
  })

  return items.map(item => {
    const existing = existingMap.get(item.name)
    return {
      csvData: { name: item.name, email: item.email || '' },
      existingData: existing || null,
      isDuplicate: !!existing,
    }
  })
}

// --- 顧客の重複チェック（詳細付き） ---
// Issue #1036: notes・aliases列を追加
export async function checkCustomerDuplicatesWithDetails(
  items: { name: string; furigana: string; careManagerName?: string; notes?: string; aliases?: string }[]
): Promise<DuplicateCheckResultWithDetails<{ name: string; furigana: string; careManagerName?: string; notes?: string; aliases?: string; id?: string }>[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.customers))
  const existingMap = new Map<string, { name: string; furigana: string; careManagerName?: string; notes?: string; aliases?: string; id: string }>()

  snapshot.docs.forEach(d => {
    const data = d.data()
    existingMap.set(data.name, {
      name: data.name,
      furigana: data.furigana || '',
      careManagerName: data.careManagerName || '',
      notes: data.notes || '',
      aliases: Array.isArray(data.aliases) ? data.aliases.join('|') : '',
      id: d.id,
    })
  })

  return items.map(item => {
    const normalizedName = normalizeName(item.name)
    const existing = existingMap.get(normalizedName)
    return {
      csvData: {
        name: normalizedName,
        furigana: item.furigana,
        careManagerName: item.careManagerName || '',
        notes: item.notes || '',
        aliases: item.aliases || '',
      },
      existingData: existing || null,
      isDuplicate: !!existing,
    }
  })
}

// --- 事業所の重複チェック（詳細付き） ---
// Issue #1036: notes・aliases列を追加
export async function checkOfficeDuplicatesWithDetails(
  items: { name: string; shortName: string; notes?: string; aliases?: string }[]
): Promise<DuplicateCheckResultWithDetails<{ name: string; shortName: string; notes?: string; aliases?: string; id?: string }>[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.offices))
  const existingMap = new Map<string, { name: string; shortName: string; notes?: string; aliases?: string; id: string }>()

  snapshot.docs.forEach(d => {
    const data = d.data()
    existingMap.set(data.name, {
      name: data.name,
      shortName: data.shortName || '',
      notes: data.notes || '',
      aliases: Array.isArray(data.aliases) ? data.aliases.join('|') : '',
      id: d.id,
    })
  })

  return items.map(item => {
    const normalizedName = normalizeName(item.name)
    const existing = existingMap.get(normalizedName)
    return {
      csvData: {
        name: normalizedName,
        shortName: item.shortName || '',
        notes: item.notes || '',
        aliases: item.aliases || '',
      },
      existingData: existing || null,
      isDuplicate: !!existing,
    }
  })
}

// --- 書類種別の上書き対応インポート ---
interface DocumentTypeImportItem {
  data: { name: string; dateMarker: string; category: string; keywords: string; aliases?: string }
  action: ImportAction
}

async function bulkImportDocumentTypesWithActions(
  items: DocumentTypeImportItem[]
): Promise<BulkImportResultDetailed> {
  let added = 0
  let overwritten = 0
  let skipped = 0
  const skippedNames: string[] = []
  const failedNames: string[] = []

  for (const item of items) {
    if (!item.data.name) {
      skipped++
      skippedNames.push('(空)')
      continue
    }

    if (item.action === 'skip') {
      skipped++
      skippedNames.push(item.data.name)
      continue
    }

    try {
      const docRef = doc(db, COLLECTION_PATHS.documents, item.data.name)
      const keywords = item.data.keywords
        ? item.data.keywords.split(';').map(k => k.trim()).filter(k => k.length >= 2)
        : []
      const aliases = parseSeparatedListForImport(item.data.aliases, '|')

      if (item.action === 'overwrite') {
        // 上書き: setDoc(非merge)だとCSV列に無いフィールドが消えるため、
        // updateDocでCSVに値がある列のみ送信する(空欄=変更しない。Issue #1036既存バグ修正)
        const updateData: Record<string, unknown> = {}
        if (item.data.dateMarker) updateData.dateMarker = item.data.dateMarker
        if (item.data.category) updateData.category = item.data.category
        if (keywords.length > 0) updateData.keywords = keywords
        if (aliases) updateData.aliases = aliases
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await updateDoc(docRef, updateData as any)
        overwritten++
      } else {
        await setDoc(docRef, {
          name: item.data.name,
          dateMarker: item.data.dateMarker || '',
          category: item.data.category || '',
          keywords,
          ...(aliases ? { aliases } : {}),
        })
        added++
      }
    } catch (err) {
      console.error(`[bulkImportDocumentTypesWithActions] "${item.data.name}" の書込みに失敗しました`, err)
      failedNames.push(item.data.name)
    }
  }

  return { added, overwritten, skipped, skippedNames, failedNames }
}

export function useBulkImportDocumentTypesWithActions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkImportDocumentTypesWithActions,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'documents'] })
    },
  })
}

// --- ケアマネの上書き対応インポート ---
interface CareManagerImportItem {
  data: { name: string; email?: string }
  existingId?: string
  action: ImportAction
}

async function bulkImportCareManagersWithActions(
  items: CareManagerImportItem[]
): Promise<BulkImportResultDetailed> {
  let added = 0
  let overwritten = 0
  let skipped = 0
  const skippedNames: string[] = []
  const failedNames: string[] = []

  for (const item of items) {
    if (!item.data.name) {
      skipped++
      skippedNames.push('(空)')
      continue
    }

    if (item.action === 'skip') {
      skipped++
      skippedNames.push(item.data.name)
      continue
    }

    try {
      if (item.action === 'overwrite' && !item.existingId) {
        // overwrite指定だがexistingIdが無い異常系。ケアマネのdoc IDはUI作成分(正規化名)と
        // CLI作成分(自動採番)が混在するため、無警告で名前ベースの新規docへフォールバック
        // すると、CLI由来レコードとは別の名前ベース文書が重複作成されうる。顧客・事業所と
        // 同様に明示的に失敗扱いにする(pr-review-toolkit指摘の回帰)
        console.error(`[bulkImportCareManagersWithActions] "${item.data.name}" はoverwrite指定ですがexistingIdがありません`)
        failedNames.push(item.data.name)
        continue
      }

      if (item.action === 'overwrite' && item.existingId) {
        // 上書きは実doc ID(existingId)で更新する。UI経由の新規作成はdoc ID=正規化した
        // 名前だが、CLI(scripts/import-masters.js)経由のケアマネはdoc()自動採番のため、
        // 名前ベースのdocを組み立てるとCLI由来レコードの上書きが対象不存在で失敗する
        // (Issue #1036 /plan-crossreview反映#4)。updateDocでCSVに値がある列のみ送信する
        const docRef = doc(db, COLLECTION_PATHS.caremanagers, item.existingId)
        const updateData: Record<string, unknown> = { updatedAt: serverTimestamp() }
        if (item.data.email) updateData.email = item.data.email
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await updateDoc(docRef, updateData as any)
        overwritten++
      } else {
        const docRef = doc(db, COLLECTION_PATHS.caremanagers, item.data.name)
        await setDoc(docRef, {
          name: item.data.name,
          ...(item.data.email ? { email: item.data.email } : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        added++
      }
    } catch (err) {
      console.error(`[bulkImportCareManagersWithActions] "${item.data.name}" の書込みに失敗しました`, err)
      failedNames.push(item.data.name)
    }
  }

  return { added, overwritten, skipped, skippedNames, failedNames }
}

export function useBulkImportCareManagersWithActions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkImportCareManagersWithActions,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'caremanagers'] })
    },
  })
}

// --- 顧客の上書き対応インポート ---
interface CustomerImportItem {
  data: { name: string; furigana: string; careManagerName?: string; notes?: string; aliases?: string }
  existingId?: string
  action: ImportAction
}

async function bulkImportCustomersWithActions(
  items: CustomerImportItem[]
): Promise<BulkImportResultDetailed> {
  // 既存データを取得してマップ作成
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.customers))
  const existingByName = new Map<string, string>() // name -> docId
  snapshot.docs.forEach(d => {
    existingByName.set(d.data().name, d.id)
  })

  let added = 0
  let overwritten = 0
  let skipped = 0
  const skippedNames: string[] = []
  const failedNames: string[] = []

  for (const item of items) {
    const normalizedName = normalizeName(item.data.name)
    if (!normalizedName) {
      skipped++
      skippedNames.push('(空)')
      continue
    }

    if (item.action === 'skip') {
      skipped++
      skippedNames.push(normalizedName)
      continue
    }

    try {
      // 共通のデータオブジェクトを作成(furigana・notes・aliasesはCSVに値がある場合のみ含める。空欄=変更しない)
      const baseData: Record<string, unknown> = {
        name: normalizedName,
      }
      if (item.data.furigana) {
        baseData.furigana = normalizeName(item.data.furigana)
      }
      if (item.data.careManagerName) {
        baseData.careManagerName = item.data.careManagerName
      }
      if (item.data.notes) {
        baseData.notes = item.data.notes
      }
      const aliases = parseSeparatedListForImport(item.data.aliases, '|')
      if (aliases) {
        baseData.aliases = aliases
      }

      if (item.action === 'overwrite' && !item.existingId) {
        // overwrite指定だがexistingIdが無い異常系。addへ無警告フォールバックすると
        // 別レコードとして重複作成されてしまうため、明示的に失敗扱いにする
        console.error(`[bulkImportCustomersWithActions] "${normalizedName}" はoverwrite指定ですがexistingIdがありません`)
        failedNames.push(normalizedName)
        continue
      }

      if (item.action === 'overwrite' && item.existingId) {
        // 上書き: 既存ドキュメントを更新
        const docRef = doc(db, COLLECTION_PATHS.customers, item.existingId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await updateDoc(docRef, baseData as any)
        overwritten++
      } else {
        // 新規追加
        const docRef = doc(collection(db, COLLECTION_PATHS.customers))
        await setDoc(docRef, {
          ...baseData,
          isDuplicate: existingByName.has(normalizedName),
        })
        added++
        existingByName.set(normalizedName, docRef.id)
      }
    } catch (err) {
      console.error(`[bulkImportCustomersWithActions] "${normalizedName}" の書込みに失敗しました`, err)
      failedNames.push(normalizedName)
    }
  }

  return { added, overwritten, skipped, skippedNames, failedNames }
}

export function useBulkImportCustomersWithActions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkImportCustomersWithActions,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'customers'] })
    },
  })
}

// --- 事業所の上書き対応インポート ---
interface OfficeImportItem {
  data: { name: string; shortName: string; notes?: string; aliases?: string }
  existingId?: string
  action: ImportAction
}

async function bulkImportOfficesWithActions(
  items: OfficeImportItem[]
): Promise<BulkImportResultDetailed> {
  // 既存データを取得
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.offices))
  const existingByName = new Map<string, string>()
  const existingForCollision: Array<{ id: string; name: string }> = []
  snapshot.docs.forEach(d => {
    const docName = (d.data().name as string) || ''
    existingByName.set(docName, d.id)
    existingForCollision.push({ id: d.id, name: docName })
  })

  // #506: 短マスター混入予防 — 新規登録予定 row も合算して collision-based 判定
  // (新規 row 同士の衝突も検知できる)。reject 行は skip カウントに含める。
  const newCandidates = items.map((item, idx) => ({
    id: `__new_${idx}__`,
    name: normalizeName(item.data.name),
  }))
  const combined = existingForCollision.concat(newCandidates)
  const rejectedShortIndices = new Set<number>()
  for (let i = 0; i < newCandidates.length; i++) {
    const verdict = validateOfficeMasterImport(newCandidates[i]!, combined)
    if (verdict.kind === 'reject-short-common') {
      rejectedShortIndices.add(i)
    } else if (verdict.kind === 'warning-short-uncommon') {
      console.warn(`[short master warning] "${newCandidates[i]!.name}" は短い名前です。誤入力でないか確認してください。`)
    }
  }

  let added = 0
  let overwritten = 0
  let skipped = 0
  const skippedNames: string[] = []
  const failedNames: string[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    const normalizedName = normalizeName(item.data.name)
    if (!normalizedName) {
      skipped++
      skippedNames.push('(空)')
      continue
    }

    // #506: 短マスター reject 行は skip としてカウント、skippedNames に明示
    if (rejectedShortIndices.has(i)) {
      skipped++
      skippedNames.push(`${normalizedName} (短マスター reject)`)
      continue
    }

    if (item.action === 'skip') {
      skipped++
      skippedNames.push(normalizedName)
      continue
    }

    try {
      const normalizedShortName = item.data.shortName ? normalizeName(item.data.shortName) : ''
      const aliases = parseSeparatedListForImport(item.data.aliases, '|')

      if (item.action === 'overwrite' && !item.existingId) {
        // overwrite指定だがexistingIdが無い異常系。addへ無警告フォールバックすると
        // 別レコードとして重複作成されてしまうため、明示的に失敗扱いにする
        console.error(`[bulkImportOfficesWithActions] "${normalizedName}" はoverwrite指定ですがexistingIdがありません`)
        failedNames.push(normalizedName)
        continue
      }

      if (item.action === 'overwrite' && item.existingId) {
        // 上書き: setDoc(非merge)だとCSV列に無いフィールド(shortName・備考・別表記等)が
        // 消えるため、updateDocでCSVに値がある列のみ送信する(空欄=変更しない。Issue #1036既存バグ修正)
        const docRef = doc(db, COLLECTION_PATHS.offices, item.existingId)
        const updateData: Record<string, unknown> = { name: normalizedName }
        if (normalizedShortName) updateData.shortName = normalizedShortName
        if (item.data.notes) updateData.notes = item.data.notes
        if (aliases) updateData.aliases = aliases
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await updateDoc(docRef, updateData as any)
        overwritten++
      } else {
        // 新規追加
        const docRef = doc(collection(db, COLLECTION_PATHS.offices))
        await setDoc(docRef, {
          name: normalizedName,
          shortName: normalizedShortName,
          ...(item.data.notes ? { notes: item.data.notes } : {}),
          ...(aliases ? { aliases } : {}),
        })
        added++
        existingByName.set(normalizedName, docRef.id)
      }
    } catch (err) {
      console.error(`[bulkImportOfficesWithActions] "${normalizedName}" の書込みに失敗しました`, err)
      failedNames.push(normalizedName)
    }
  }

  return { added, overwritten, skipped, skippedNames, failedNames }
}

export function useBulkImportOfficesWithActions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bulkImportOfficesWithActions,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masters', 'offices'] })
    },
  })
}
