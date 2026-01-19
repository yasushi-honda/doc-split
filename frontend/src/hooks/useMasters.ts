/**
 * マスターデータ管理フック
 * 顧客・書類・事業所・ケアマネのCRUD操作
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { normalizeName } from '@/lib/textNormalizer'
import type {
  CustomerMaster,
  DocumentMaster,
  OfficeMaster,
  CareManagerMaster,
} from '@shared/types'

// ============================================
// 顧客マスター
// ============================================

async function fetchCustomers(): Promise<CustomerMaster[]> {
  const snapshot = await getDocs(collection(db, 'masters/customers/items'))
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    name: doc.data().name as string,
    isDuplicate: doc.data().isDuplicate as boolean,
    furigana: doc.data().furigana as string,
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
}

async function addCustomer(params: AddCustomerParams): Promise<void> {
  const docRef = doc(collection(db, 'masters/customers/items'))
  await setDoc(docRef, {
    name: normalizeName(params.name),
    furigana: normalizeName(params.furigana),
    isDuplicate: params.isDuplicate || false,
  })
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
}

async function updateCustomer(params: UpdateCustomerParams): Promise<void> {
  const docRef = doc(db, 'masters/customers/items', params.id)
  await updateDoc(docRef, {
    name: normalizeName(params.name),
    furigana: normalizeName(params.furigana),
    isDuplicate: params.isDuplicate,
  })
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
  await deleteDoc(doc(db, 'masters/customers/items', id))
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

async function bulkImportCustomers(
  customers: BulkCustomerParams[]
): Promise<{ imported: number; skipped: number }> {
  // 既存データを取得
  const snapshot = await getDocs(collection(db, 'masters/customers/items'))
  const existingNames = new Set(snapshot.docs.map(d => d.data().name))

  let imported = 0
  let skipped = 0

  for (const customer of customers) {
    const normalizedName = normalizeName(customer.name)
    if (!normalizedName || existingNames.has(normalizedName)) {
      skipped++
      continue
    }

    const docRef = doc(collection(db, 'masters/customers/items'))
    await setDoc(docRef, {
      name: normalizedName,
      furigana: normalizeName(customer.furigana),
      isDuplicate: customer.isDuplicate || false,
    })
    imported++
    existingNames.add(normalizedName) // 重複を防ぐ
  }

  return { imported, skipped }
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
  const snapshot = await getDocs(collection(db, 'masters/documents/items'))
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
  // 書類名をIDとして使用
  const docRef = doc(db, 'masters/documents/items', params.name)
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
    await deleteDoc(doc(db, 'masters/documents/items', params.originalName))
  }
  const docRef = doc(db, 'masters/documents/items', params.name)
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
  await deleteDoc(doc(db, 'masters/documents/items', name))
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
  const snapshot = await getDocs(collection(db, 'masters/documents/items'))
  const existingNames = new Set(snapshot.docs.map(d => d.data().name))

  let imported = 0
  let skipped = 0

  for (const seed of DOCUMENT_TYPE_SEEDS) {
    if (existingNames.has(seed.name)) {
      skipped++
      continue
    }

    const docRef = doc(db, 'masters/documents/items', seed.name)
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
  const snapshot = await getDocs(collection(db, 'masters/offices/items'))
  return snapshot.docs.map((doc) => ({
    name: doc.data().name as string,
    shortName: doc.data().shortName as string | undefined,
  }))
}

export function useOffices() {
  return useQuery({
    queryKey: ['masters', 'offices'],
    queryFn: fetchOffices,
    staleTime: 5 * 60 * 1000,
  })
}

async function addOffice(name: string): Promise<void> {
  const normalizedName = normalizeName(name)
  const docRef = doc(db, 'masters/offices/items', normalizedName)
  await setDoc(docRef, { name: normalizedName })
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
  await deleteDoc(doc(db, 'masters/offices/items', name))
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
}

async function updateOffice(params: UpdateOfficeParams): Promise<void> {
  const normalizedName = normalizeName(params.name)
  const normalizedShortName = params.shortName ? normalizeName(params.shortName) : ''

  // 名前が変わった場合は削除して再作成
  if (params.originalName !== normalizedName) {
    await deleteDoc(doc(db, 'masters/offices/items', params.originalName))
  }

  const docRef = doc(db, 'masters/offices/items', normalizedName)
  await setDoc(docRef, {
    name: normalizedName,
    shortName: normalizedShortName,
  })
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

async function bulkImportOffices(
  offices: BulkOfficeParams[]
): Promise<{ imported: number; skipped: number }> {
  // 既存データを取得
  const snapshot = await getDocs(collection(db, 'masters/offices/items'))
  const existingNames = new Set(snapshot.docs.map(d => d.data().name))

  let imported = 0
  let skipped = 0

  for (const office of offices) {
    const normalizedName = normalizeName(office.name)
    if (!normalizedName || existingNames.has(normalizedName)) {
      skipped++
      continue
    }

    const docRef = doc(db, 'masters/offices/items', normalizedName)
    await setDoc(docRef, {
      name: normalizedName,
      shortName: office.shortName ? normalizeName(office.shortName) : '',
    })
    imported++
    existingNames.add(normalizedName)
  }

  return { imported, skipped }
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
  const snapshot = await getDocs(collection(db, 'masters/caremanagers/items'))
  return snapshot.docs.map((doc) => ({
    name: doc.data().name as string,
  }))
}

export function useCareManagers() {
  return useQuery({
    queryKey: ['masters', 'caremanagers'],
    queryFn: fetchCareManagers,
    staleTime: 5 * 60 * 1000,
  })
}

async function addCareManager(name: string): Promise<void> {
  const normalizedName = normalizeName(name)
  const docRef = doc(db, 'masters/caremanagers/items', normalizedName)
  await setDoc(docRef, { name: normalizedName })
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
  await deleteDoc(doc(db, 'masters/caremanagers/items', name))
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
}

async function updateCareManager(params: UpdateCareManagerParams): Promise<void> {
  const normalizedName = normalizeName(params.name)

  // 名前が変わった場合は削除して再作成
  if (params.originalName !== normalizedName) {
    await deleteDoc(doc(db, 'masters/caremanagers/items', params.originalName))
  }

  const docRef = doc(db, 'masters/caremanagers/items', normalizedName)
  await setDoc(docRef, { name: normalizedName })
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
