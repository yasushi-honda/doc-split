/**
 * アプリ設定・ユーザー管理フック
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { AppSettings, User, UserRole } from '@shared/types'

// ============================================
// アプリ設定
// ============================================

const DEFAULT_SETTINGS: AppSettings = {
  targetLabels: [],
  targetSenders: [],
  labelSearchOperator: 'OR',
  errorNotificationEmails: [],
  gmailAccount: '',
}

async function fetchSettings(): Promise<AppSettings> {
  const docRef = doc(db, 'settings', 'app')
  const docSnap = await getDoc(docRef)

  if (!docSnap.exists()) {
    return DEFAULT_SETTINGS
  }

  const data = docSnap.data()
  return {
    targetLabels: data.targetLabels || [],
    targetSenders: data.targetSenders || [],
    labelSearchOperator: data.labelSearchOperator || 'OR',
    errorNotificationEmails: data.errorNotificationEmails || [],
    gmailAccount: data.gmailAccount || '',
  }
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: 60000,
  })
}

async function updateSettings(settings: Partial<AppSettings>): Promise<void> {
  const docRef = doc(db, 'settings', 'app')
  await setDoc(docRef, settings, { merge: true })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

// ============================================
// ユーザー管理
// ============================================

async function fetchUsers(): Promise<User[]> {
  const snapshot = await getDocs(collection(db, 'users'))
  return snapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      uid: doc.id,
      email: data.email as string,
      displayName: data.displayName as string | undefined,
      role: data.role as UserRole,
      createdAt: data.createdAt as Timestamp,
      lastLoginAt: data.lastLoginAt as Timestamp,
    }
  })
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    staleTime: 60000,
  })
}

interface AddUserParams {
  email: string
  role: UserRole
}

async function addUser({ email, role }: AddUserParams): Promise<void> {
  // uidはログイン時に設定されるため、emailベースで仮登録
  const docRef = doc(collection(db, 'users'))
  await setDoc(docRef, {
    email,
    role,
    createdAt: Timestamp.now(),
    lastLoginAt: Timestamp.now(),
  })
}

export function useAddUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: addUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

interface UpdateUserRoleParams {
  uid: string
  role: UserRole
}

async function updateUserRole({ uid, role }: UpdateUserRoleParams): Promise<void> {
  const docRef = doc(db, 'users', uid)
  await setDoc(docRef, { role }, { merge: true })
}

export function useUpdateUserRole() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateUserRole,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

async function deleteUser(uid: string): Promise<void> {
  const docRef = doc(db, 'users', uid)
  await deleteDoc(docRef)
}

export function useDeleteUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}
