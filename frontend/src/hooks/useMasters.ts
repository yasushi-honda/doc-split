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
    name: params.name,
    furigana: params.furigana,
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
    name: params.name,
    furigana: params.furigana,
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

// ============================================
// 書類マスター
// ============================================

async function fetchDocumentTypes(): Promise<DocumentMaster[]> {
  const snapshot = await getDocs(collection(db, 'masters/documents/items'))
  return snapshot.docs.map((doc) => ({
    name: doc.data().name as string,
    dateMarker: doc.data().dateMarker as string,
    category: doc.data().category as string,
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
}

async function addDocumentType(params: AddDocumentTypeParams): Promise<void> {
  // 書類名をIDとして使用
  const docRef = doc(db, 'masters/documents/items', params.name)
  await setDoc(docRef, {
    name: params.name,
    dateMarker: params.dateMarker,
    category: params.category,
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
  const docRef = doc(db, 'masters/offices/items', name)
  await setDoc(docRef, { name })
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
  const docRef = doc(db, 'masters/caremanagers/items', name)
  await setDoc(docRef, { name })
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
