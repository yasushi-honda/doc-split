import { useState, useCallback } from 'react'
import { doc, updateDoc, collection, addDoc, serverTimestamp, Timestamp, deleteField } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db, auth } from '../lib/firebase'
import { updateDocumentInListCache } from './useDocuments'
import { isValidCustomerSelection, isValidOfficeSelection } from '../lib/documentUtils'
import { generateDisplayFileName } from '@shared/generateDisplayFileName'
import type { Document } from '../../../shared/types'

export interface EditLogEntry {
  documentId: string
  fieldName: string
  oldValue: string | null
  newValue: string | null
  editedBy: string
  editedByEmail: string
  editedAt: Timestamp
}

export interface EditableFields {
  customerName?: string
  customerId?: string
  customerKey?: string
  officeName?: string
  officeId?: string
  officeKey?: string
  documentType?: string
  documentTypeKey?: string
  careManagerKey?: string
  careManager?: string
  fileDate?: Date | null
  fileName?: string
}

interface UseDocumentEditResult {
  isEditing: boolean
  isSaving: boolean
  editedFields: EditableFields
  startEditing: () => void
  cancelEditing: () => void
  updateField: <K extends keyof EditableFields>(field: K, value: EditableFields[K]) => void
  saveChanges: () => Promise<boolean>
  error: string | null
}

export function useDocumentEdit(document: Document | null | undefined): UseDocumentEditResult {
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editedFields, setEditedFields] = useState<EditableFields>({})
  const queryClient = useQueryClient()

  const startEditing = useCallback(() => {
    if (!document) return
    setEditedFields({
      customerName: document.customerName || '',
      customerId: document.customerId || '',
      customerKey: document.customerKey || '',
      officeName: document.officeName || '',
      officeId: document.officeId || '',
      officeKey: document.officeKey || '',
      documentType: document.documentType || '',
      documentTypeKey: document.documentTypeKey || '',
      careManagerKey: document.careManagerKey || '',
      careManager: document.careManager || '',
      fileDate: document.fileDate instanceof Timestamp
        ? document.fileDate.toDate()
        : document.fileDate ? new Date(document.fileDate) : null,
      fileName: document.fileName || '',
    })
    setIsEditing(true)
    setError(null)
  }, [document])

  const cancelEditing = useCallback(() => {
    setIsEditing(false)
    setEditedFields({})
    setError(null)
  }, [])

  const updateField = useCallback(<K extends keyof EditableFields>(
    field: K,
    value: EditableFields[K]
  ) => {
    setEditedFields(prev => ({ ...prev, [field]: value }))
  }, [])

  const saveChanges = useCallback(async (): Promise<boolean> => {
    if (!document || !auth.currentUser) {
      setError('認証情報がありません')
      return false
    }

    setIsSaving(true)
    setError(null)

    try {
      const docRef = doc(db, 'documents', document.id)
      const editLogsRef = collection(db, 'editLogs')

      // 変更されたフィールドを特定
      const changes: { field: string; oldValue: string | null; newValue: string | null }[] = []

      // 顧客名
      if (editedFields.customerName !== (document.customerName || '')) {
        changes.push({
          field: 'customerName',
          oldValue: document.customerName || null,
          newValue: editedFields.customerName || null,
        })
      }

      // 事業所名
      if (editedFields.officeName !== (document.officeName || '')) {
        changes.push({
          field: 'officeName',
          oldValue: document.officeName || null,
          newValue: editedFields.officeName || null,
        })
      }

      // 書類種別
      if (editedFields.documentType !== (document.documentType || '')) {
        changes.push({
          field: 'documentType',
          oldValue: document.documentType || null,
          newValue: editedFields.documentType || null,
        })
      }

      // 担当ケアマネ
      if (editedFields.careManager !== (document.careManager || '')) {
        changes.push({
          field: 'careManager',
          oldValue: document.careManager || null,
          newValue: editedFields.careManager || null,
        })
      }

      // ファイル名
      if (editedFields.fileName !== (document.fileName || '')) {
        changes.push({
          field: 'fileName',
          oldValue: document.fileName || null,
          newValue: editedFields.fileName || null,
        })
      }

      // 日付（比較が複雑なため文字列化して比較）
      const oldDate = document.fileDate instanceof Timestamp
        ? document.fileDate.toDate().toISOString().split('T')[0] ?? null
        : document.fileDate ? new Date(document.fileDate).toISOString().split('T')[0] ?? null : null
      const newDate = editedFields.fileDate
        ? editedFields.fileDate.toISOString().split('T')[0] ?? null
        : null
      if (oldDate !== newDate) {
        changes.push({
          field: 'fileDate',
          oldValue: oldDate,
          newValue: newDate,
        })
      }

      // 確定フラグの判定（Issue #396）
      // 「保存=確定」操作として、有効な顧客名/事業所名が現在値（編集後）に
      // セットされていて、かつ既存 confirmed が true でない場合に true を立てる。
      // invalid 値（空・「未判定」等）の場合や既に true の場合は updateData に含めず、
      // 既存値を上書きしない（false への退行を防ぐ）。
      const finalCustomerName = editedFields.customerName ?? document.customerName ?? ''
      const finalOfficeName = editedFields.officeName ?? document.officeName ?? ''
      const shouldSetCustomerConfirmed =
        isValidCustomerSelection(finalCustomerName) && document.customerConfirmed !== true
      const shouldSetOfficeConfirmed =
        isValidOfficeSelection(finalOfficeName) && document.officeConfirmed !== true

      if (changes.length === 0 && !shouldSetCustomerConfirmed && !shouldSetOfficeConfirmed) {
        setIsEditing(false)
        return true
      }

      // ドキュメント更新データを構築
      const updateData: Record<string, unknown> = {
        editedBy: auth.currentUser.uid,
        editedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }

      // キャッシュ楽観的更新用データ（serverTimestampはクライアント値で代替）
      const optimisticData: Partial<Document> = {}

      // 確定フラグの書き込み
      // needsManualCustomerSelection はレガシーフォールバック。既存ドキュメントに値が
      // 存在する場合のみ false に同期更新し、undefined のドキュメントには書き込まない
      // （customerConfirmed=true で判定優先されるため、新規フィールド作成を避ける）。
      if (shouldSetCustomerConfirmed) {
        updateData.customerConfirmed = true
        optimisticData.customerConfirmed = true
        // #398: 確定フラグ変更を editLogs に記録（silent failure 検知用）
        changes.push({
          field: 'customerConfirmed',
          oldValue: document.customerConfirmed === undefined ? null : String(document.customerConfirmed),
          newValue: 'true',
        })
        if (document.needsManualCustomerSelection !== undefined) {
          updateData.needsManualCustomerSelection = false
          optimisticData.needsManualCustomerSelection = false
          changes.push({
            field: 'needsManualCustomerSelection',
            oldValue: String(document.needsManualCustomerSelection),
            newValue: 'false',
          })
        }
      }
      // optimisticData は serverTimestamp が使えないため Timestamp.now() で代替。
      if (shouldSetOfficeConfirmed) {
        updateData.officeConfirmed = true
        updateData.officeConfirmedBy = auth.currentUser.uid
        updateData.officeConfirmedAt = serverTimestamp()
        optimisticData.officeConfirmed = true
        optimisticData.officeConfirmedBy = auth.currentUser.uid
        optimisticData.officeConfirmedAt = Timestamp.now()
        changes.push({
          field: 'officeConfirmed',
          oldValue: document.officeConfirmed === undefined ? null : String(document.officeConfirmed),
          newValue: 'true',
        })
      }

      // 変更されたフィールドを追加
      if (editedFields.customerName !== undefined) {
        updateData.customerName = editedFields.customerName
        updateData.customerKey = editedFields.customerName
        optimisticData.customerName = editedFields.customerName
        optimisticData.customerKey = editedFields.customerName
      }
      if (editedFields.customerId !== undefined) {
        updateData.customerId = editedFields.customerId
        optimisticData.customerId = editedFields.customerId
      }
      if (editedFields.officeName !== undefined) {
        updateData.officeName = editedFields.officeName
        updateData.officeKey = editedFields.officeName
        optimisticData.officeName = editedFields.officeName
        optimisticData.officeKey = editedFields.officeName
      }
      if (editedFields.officeId !== undefined) {
        updateData.officeId = editedFields.officeId
        optimisticData.officeId = editedFields.officeId
      }
      if (editedFields.documentType !== undefined) {
        updateData.documentType = editedFields.documentType
        updateData.documentTypeKey = editedFields.documentType
        optimisticData.documentType = editedFields.documentType
        optimisticData.documentTypeKey = editedFields.documentType
      }
      if (editedFields.careManager !== undefined && editedFields.careManager !== (document.careManager || '')) {
        updateData.careManager = editedFields.careManager
        updateData.careManagerKey = editedFields.careManager  // careManagerKeyはcareManagerから派生
        optimisticData.careManager = editedFields.careManager
        optimisticData.careManagerKey = editedFields.careManager
      } else if (editedFields.careManagerKey !== undefined) {
        updateData.careManagerKey = editedFields.careManagerKey
        optimisticData.careManagerKey = editedFields.careManagerKey
      }
      if (editedFields.fileName !== undefined) {
        updateData.fileName = editedFields.fileName
        optimisticData.fileName = editedFields.fileName
      }
      if (editedFields.fileDate !== undefined) {
        updateData.fileDate = editedFields.fileDate
        optimisticData.fileDate = editedFields.fileDate as unknown as Timestamp
      }

      // displayFileName 再生成 (#178 Stage 3)
      // changes配列で実際に変更があったフィールドのみ検知（startEditingの初期化値に惑わされない）
      const displayNameFields = new Set(['documentType', 'customerName', 'officeName', 'fileDate'])
      const metaChanged = changes.some((c) => displayNameFields.has(c.field))
      if (metaChanged) {
        const finalDocType = (editedFields.documentType ?? document.documentType) || undefined
        const finalCustomer = (editedFields.customerName ?? document.customerName) || undefined
        const finalOffice = (editedFields.officeName ?? document.officeName) || undefined
        // fileDate: editedFieldsはDate|null、既存はTimestamp → 文字列に変換
        let fileDateStr: string | undefined
        if (editedFields.fileDate !== undefined) {
          if (editedFields.fileDate) {
            const d = editedFields.fileDate
            fileDateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
          }
        } else if (document.fileDate) {
          try {
            // Firestoreキャッシュ復元時にプレーンオブジェクトになる場合があるためガード
            const d = document.fileDate instanceof Timestamp
              ? document.fileDate.toDate()
              : new Date((document.fileDate as unknown as { seconds: number }).seconds * 1000)
            fileDateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
          } catch { /* fileDate変換失敗時は省略 */ }
        }
        const newDisplayFileName = generateDisplayFileName({
          documentType: finalDocType,
          customerName: finalCustomer,
          officeName: finalOffice,
          fileDate: fileDateStr,
        })
        if (newDisplayFileName) {
          updateData.displayFileName = newDisplayFileName
          optimisticData.displayFileName = newDisplayFileName
        } else {
          // メタ情報が有効でなくなった場合、古い displayFileName を削除
          updateData.displayFileName = deleteField()
          optimisticData.displayFileName = undefined as unknown as string
        }
      }

      // 楽観的更新: 保存前にキャッシュを即座に反映
      updateDocumentInListCache(queryClient, document.id, optimisticData)

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await updateDoc(docRef, updateData as any)
      } catch (writeErr) {
        // Firestore書き込み失敗時: ロールバック
        const rollbackData: Partial<Document> = {}
        if (editedFields.customerName !== undefined) {
          rollbackData.customerName = document.customerName
          rollbackData.customerKey = document.customerKey
        }
        if (editedFields.customerId !== undefined) rollbackData.customerId = document.customerId
        if (editedFields.officeName !== undefined) {
          rollbackData.officeName = document.officeName
          rollbackData.officeKey = document.officeKey
        }
        if (editedFields.officeId !== undefined) rollbackData.officeId = document.officeId
        if (editedFields.documentType !== undefined) {
          rollbackData.documentType = document.documentType
          rollbackData.documentTypeKey = document.documentTypeKey
        }
        if (editedFields.careManager !== undefined) {
          rollbackData.careManager = document.careManager
          rollbackData.careManagerKey = document.careManagerKey
        } else if (editedFields.careManagerKey !== undefined) {
          rollbackData.careManagerKey = document.careManagerKey
        }
        if (editedFields.fileName !== undefined) rollbackData.fileName = document.fileName
        if (editedFields.fileDate !== undefined) rollbackData.fileDate = document.fileDate
        // 確定フラグもロールバック対象（楽観的更新で立てた値を元に戻す）
        if (shouldSetCustomerConfirmed) {
          rollbackData.customerConfirmed = document.customerConfirmed
          if (document.needsManualCustomerSelection !== undefined) {
            rollbackData.needsManualCustomerSelection = document.needsManualCustomerSelection
          }
        }
        if (shouldSetOfficeConfirmed) {
          rollbackData.officeConfirmed = document.officeConfirmed
          rollbackData.officeConfirmedBy = document.officeConfirmedBy
          rollbackData.officeConfirmedAt = document.officeConfirmedAt
        }
        updateDocumentInListCache(queryClient, document.id, rollbackData)
        throw writeErr
      }

      // 監査ログを記録
      for (const change of changes) {
        await addDoc(editLogsRef, {
          documentId: document.id,
          fieldName: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          editedBy: auth.currentUser.uid,
          editedByEmail: auth.currentUser.email || '',
          editedAt: serverTimestamp(),
        })
      }

      // サーバー確定値で同期
      queryClient.invalidateQueries({ queryKey: ['documentsInfinite'] })
      queryClient.invalidateQueries({ queryKey: ['document', document.id] })

      setIsEditing(false)
      setEditedFields({})
      return true
    } catch (err) {
      console.error('Failed to save changes:', err)
      setError(err instanceof Error ? err.message : '保存に失敗しました')
      return false
    } finally {
      setIsSaving(false)
    }
  }, [document, editedFields, queryClient])

  return {
    isEditing,
    isSaving,
    editedFields,
    startEditing,
    cancelEditing,
    updateField,
    saveChanges,
    error,
  }
}
