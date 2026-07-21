/**
 * Google Driveエクスポートエラー一覧 + 手動リトライ(ADR-0022 Phase1 Task13)
 *
 * `documents`コレクションの`driveExportStatus:'error'`を一覧表示し、
 * `retryDriveExport`(Callable Function、Admin SDK専有、ADR-0022 Decision6)経由で
 * 再試行する。`Document`型/`firestoreToDocument()`のいずれにも`updatedAt`が
 * 存在しないため(Firestore実体には`executeDriveExport.ts`が書き込むが型層は未対応)、
 * 本フックの変換関数は`Document`型ではなく生Firestoreデータ`(id, data)`を受ける。
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { callFunction } from '@/lib/callFunction'
import type { DriveExportStatus } from '@shared/types'

export interface DriveExportErrorRow {
  id: string
  updatedAt: Date | null
  fileName: string
  customerName: string
  officeName: string
  careManager: string
  documentType: string
  driveExportError: string
}

const PLACEHOLDER = '（未設定）'

/** 生Firestoreデータ→表示用行への変換(純粋関数)。欠損フィールドはプレースホルダで安全に扱う */
export function toDriveExportErrorRow(id: string, data: Record<string, unknown>): DriveExportErrorRow {
  const updatedAtRaw = data.updatedAt
  const updatedAt = updatedAtRaw instanceof Timestamp ? updatedAtRaw.toDate() : null

  const displayFileName = data.displayFileName as string | undefined
  const fileName = data.fileName as string | undefined

  return {
    id,
    updatedAt,
    fileName: displayFileName || fileName || PLACEHOLDER,
    customerName: (data.customerName as string | undefined) || PLACEHOLDER,
    officeName: (data.officeName as string | undefined) || PLACEHOLDER,
    careManager: (data.careManager as string | undefined) || PLACEHOLDER,
    documentType: (data.documentType as string | undefined) || PLACEHOLDER,
    driveExportError: (data.driveExportError as string | null | undefined) ?? '',
  }
}

async function fetchDriveExportErrors(): Promise<DriveExportErrorRow[]> {
  // 複合indexデプロイを避けるため単一等値クエリのみで取得し、ソートはクライアント側で行う
  // (driveExportScheduled.tsが同じ理由でorderBy無しの単一クエリを採用している設計思想を踏襲)
  const q = query(collection(db, 'documents'), where('driveExportStatus', '==', 'error'))
  const snapshot = await getDocs(q)
  const rows = snapshot.docs.map((d) => toDriveExportErrorRow(d.id, d.data()))
  return rows.sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
}

export const DRIVE_EXPORT_ERRORS_QUERY_KEY = ['driveExportErrors']

export function useDriveExportErrors() {
  return useQuery({
    queryKey: DRIVE_EXPORT_ERRORS_QUERY_KEY,
    queryFn: fetchDriveExportErrors,
    staleTime: 30000,
  })
}

export interface RetryDriveExportResult {
  success: boolean
  status?: DriveExportStatus
  error: string | null
}

export function useRetryDriveExport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (docId: string) =>
      callFunction<{ docId: string }, RetryDriveExportResult>('retryDriveExport', { docId }),
    onSuccess: (_result, docId) => {
      // success:true/falseいずれもdriveExportStatusが変わっている(exported or error再書込み)
      // ためinvalidateが必要。falseはtri-state(呼び出し自体は成功、再エクスポートが失敗)。
      queryClient.invalidateQueries({ queryKey: DRIVE_EXPORT_ERRORS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['documentsInfinite'] })
      queryClient.invalidateQueries({ queryKey: ['documentDetail', docId] })
    },
  })
}
