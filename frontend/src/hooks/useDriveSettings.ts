/**
 * Google Drive連携設定フック(ADR-0022, Phase 1)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { DriveSettings } from '@shared/types'

const DRIVE_SETTINGS_QUERY_KEY = ['settings', 'drive']

/** Firestore生データをDriveSettingsへ正規化する（ドキュメント未作成/フィールド欠損はundefinedのまま許容） */
export function normalizeDriveSettings(data: Record<string, unknown> | undefined): DriveSettings {
  if (!data) return {}
  return {
    authMode: data.authMode as DriveSettings['authMode'],
    connectedEmail: data.connectedEmail as string | undefined,
    rootFolderId: data.rootFolderId as string | undefined,
    rootFolderName: data.rootFolderName as string | undefined,
    template: data.template as DriveSettings['template'],
    furiganaFallback: data.furiganaFallback as DriveSettings['furiganaFallback'],
  }
}

async function fetchDriveSettings(): Promise<DriveSettings> {
  const docSnap = await getDoc(doc(db, 'settings', 'drive'))
  return normalizeDriveSettings(docSnap.exists() ? docSnap.data() : undefined)
}

export function useDriveSettings() {
  return useQuery({
    queryKey: DRIVE_SETTINGS_QUERY_KEY,
    queryFn: fetchDriveSettings,
    staleTime: 60000,
  })
}

async function updateDriveSettings(settings: Partial<DriveSettings>): Promise<void> {
  await setDoc(doc(db, 'settings', 'drive'), settings, { merge: true })
}

export function useUpdateDriveSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateDriveSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DRIVE_SETTINGS_QUERY_KEY })
    },
  })
}
