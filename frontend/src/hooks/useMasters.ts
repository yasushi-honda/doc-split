/**
 * マスターデータ管理フック
 * 顧客・書類・事業所・ケアマネのCRUD操作
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { normalizeName } from '@/lib/textNormalizer'
import type {
  CustomerMaster,
  DocumentMaster,
  OfficeMaster,
  CareManagerMaster,
} from '@shared/types'

// 重複エラークラス
export class DuplicateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateError'
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

async function fetchCustomers(): Promise<CustomerMaster[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.customers))
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    name: doc.data().name as string,
    isDuplicate: doc.data().isDuplicate as boolean,
    furigana: doc.data().furigana as string,
    careManagerName: doc.data().careManagerName as string | undefined,
    notes: doc.data().notes as string | undefined,
  }))
}

export function useCustomers() {
  return useQuery({
    queryKey: ['masters', 'customers'],
    queryFn: fetchCustomers,
    staleTime: 5 * 60 * 1000,
  })
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
  await updateDoc(docRef, data)
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
    dateMarker: doc.data().dateMarker as string,
    category: doc.data().category as string,
    keywords: normalizeKeywords(doc.data().keywords),
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
  keywords?: string // セミコロン区切りの文字列
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
      aliases: data.aliases as string[] | undefined,
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
  aliases?: string[]
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
  if (params.aliases && params.aliases.length > 0) {
    data.aliases = params.aliases
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
  aliases?: string[]
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
  if (params.aliases !== undefined) {
    data.aliases = params.aliases.length > 0 ? params.aliases : null
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
 */
export interface BulkImportResultDetailed {
  added: number
  overwritten: number
  skipped: number
  skippedNames: string[]
}

// --- 書類種別の重複チェック（詳細付き） ---
export async function checkDocumentTypeDuplicatesWithDetails(
  items: { name: string; dateMarker: string; category: string; keywords: string }[]
): Promise<DuplicateCheckResultWithDetails<{ name: string; dateMarker: string; category: string; keywords: string }>[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.documents))
  const existingMap = new Map<string, { name: string; dateMarker: string; category: string; keywords: string }>()

  snapshot.docs.forEach(d => {
    const data = d.data()
    const keywords = Array.isArray(data.keywords) ? data.keywords.join(';') : ''
    existingMap.set(data.name, {
      name: data.name,
      dateMarker: data.dateMarker || '',
      category: data.category || '',
      keywords,
    })
  })

  return items.map(item => ({
    csvData: item,
    existingData: existingMap.get(item.name) || null,
    isDuplicate: existingMap.has(item.name),
  }))
}

// --- ケアマネの重複チェック（詳細付き） ---
export async function checkCareManagerDuplicatesWithDetails(
  items: { name: string }[]
): Promise<DuplicateCheckResultWithDetails<{ name: string }>[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.caremanagers))
  const existingNames = new Set(snapshot.docs.map(d => d.data().name))

  return items.map(item => ({
    csvData: item,
    existingData: existingNames.has(item.name) ? { name: item.name } : null,
    isDuplicate: existingNames.has(item.name),
  }))
}

// --- 顧客の重複チェック（詳細付き） ---
export async function checkCustomerDuplicatesWithDetails(
  items: { name: string; furigana: string; careManagerName?: string }[]
): Promise<DuplicateCheckResultWithDetails<{ name: string; furigana: string; careManagerName?: string; id?: string }>[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.customers))
  const existingMap = new Map<string, { name: string; furigana: string; careManagerName?: string; id: string }>()

  snapshot.docs.forEach(d => {
    const data = d.data()
    existingMap.set(data.name, {
      name: data.name,
      furigana: data.furigana || '',
      careManagerName: data.careManagerName || '',
      id: d.id,
    })
  })

  return items.map(item => {
    const normalizedName = normalizeName(item.name)
    const existing = existingMap.get(normalizedName)
    return {
      csvData: { name: normalizedName, furigana: item.furigana, careManagerName: item.careManagerName || '' },
      existingData: existing || null,
      isDuplicate: !!existing,
    }
  })
}

// --- 事業所の重複チェック（詳細付き） ---
export async function checkOfficeDuplicatesWithDetails(
  items: { name: string; shortName: string }[]
): Promise<DuplicateCheckResultWithDetails<{ name: string; shortName: string; id?: string }>[]> {
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.offices))
  const existingMap = new Map<string, { name: string; shortName: string; id: string }>()

  snapshot.docs.forEach(d => {
    const data = d.data()
    existingMap.set(data.name, {
      name: data.name,
      shortName: data.shortName || '',
      id: d.id,
    })
  })

  return items.map(item => {
    const normalizedName = normalizeName(item.name)
    const existing = existingMap.get(normalizedName)
    return {
      csvData: { name: normalizedName, shortName: item.shortName || '' },
      existingData: existing || null,
      isDuplicate: !!existing,
    }
  })
}

// --- 書類種別の上書き対応インポート ---
interface DocumentTypeImportItem {
  data: { name: string; dateMarker: string; category: string; keywords: string }
  action: ImportAction
}

async function bulkImportDocumentTypesWithActions(
  items: DocumentTypeImportItem[]
): Promise<BulkImportResultDetailed> {
  let added = 0
  let overwritten = 0
  let skipped = 0
  const skippedNames: string[] = []

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

    const docRef = doc(db, COLLECTION_PATHS.documents, item.data.name)
    await setDoc(docRef, {
      name: item.data.name,
      dateMarker: item.data.dateMarker || '',
      category: item.data.category || '',
      keywords: item.data.keywords
        ? item.data.keywords.split(';').map(k => k.trim()).filter(k => k.length >= 2)
        : [],
    })

    if (item.action === 'overwrite') {
      overwritten++
    } else {
      added++
    }
  }

  return { added, overwritten, skipped, skippedNames }
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
  data: { name: string }
  action: ImportAction
}

async function bulkImportCareManagersWithActions(
  items: CareManagerImportItem[]
): Promise<BulkImportResultDetailed> {
  let added = 0
  let overwritten = 0
  let skipped = 0
  const skippedNames: string[] = []

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

    const docRef = doc(db, COLLECTION_PATHS.caremanagers, item.data.name)
    await setDoc(docRef, {
      name: item.data.name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })

    if (item.action === 'overwrite') {
      overwritten++
    } else {
      added++
    }
  }

  return { added, overwritten, skipped, skippedNames }
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
  data: { name: string; furigana: string; careManagerName?: string }
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

    // 共通のデータオブジェクトを作成
    const baseData: Record<string, unknown> = {
      name: normalizedName,
      furigana: normalizeName(item.data.furigana),
    }
    if (item.data.careManagerName) {
      baseData.careManagerName = item.data.careManagerName
    }

    if (item.action === 'overwrite' && item.existingId) {
      // 上書き: 既存ドキュメントを更新
      const docRef = doc(db, COLLECTION_PATHS.customers, item.existingId)
      await updateDoc(docRef, baseData)
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
  }

  return { added, overwritten, skipped, skippedNames }
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
  data: { name: string; shortName: string }
  existingId?: string
  action: ImportAction
}

async function bulkImportOfficesWithActions(
  items: OfficeImportItem[]
): Promise<BulkImportResultDetailed> {
  // 既存データを取得
  const snapshot = await getDocs(collection(db, COLLECTION_PATHS.offices))
  const existingByName = new Map<string, string>()
  snapshot.docs.forEach(d => {
    existingByName.set(d.data().name, d.id)
  })

  let added = 0
  let overwritten = 0
  let skipped = 0
  const skippedNames: string[] = []

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

    if (item.action === 'overwrite' && item.existingId) {
      // 上書き: 既存ドキュメントを更新
      const docRef = doc(db, COLLECTION_PATHS.offices, item.existingId)
      await setDoc(docRef, {
        name: normalizedName,
        shortName: item.data.shortName ? normalizeName(item.data.shortName) : '',
      })
      overwritten++
    } else {
      // 新規追加
      const docRef = doc(collection(db, COLLECTION_PATHS.offices))
      await setDoc(docRef, {
        name: normalizedName,
        shortName: item.data.shortName ? normalizeName(item.data.shortName) : '',
      })
      added++
      existingByName.set(normalizedName, docRef.id)
    }
  }

  return { added, overwritten, skipped, skippedNames }
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
