import { useState, useCallback } from 'react'
import { doc, updateDoc, collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db, auth } from '../lib/firebase'
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
      if (editedFields.careManagerKey !== (document.careManagerKey || '')) {
        changes.push({
          field: 'careManagerKey',
          oldValue: document.careManagerKey || null,
          newValue: editedFields.careManagerKey || null,
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
        ? document.fileDate.toDate().toISOString().split('T')[0]
        : document.fileDate ? new Date(document.fileDate).toISOString().split('T')[0] : null
      const newDate = editedFields.fileDate
        ? editedFields.fileDate.toISOString().split('T')[0]
        : null
      if (oldDate !== newDate) {
        changes.push({
          field: 'fileDate',
          oldValue: oldDate,
          newValue: newDate,
        })
      }

      if (changes.length === 0) {
        setIsEditing(false)
        return true
      }

      // ドキュメント更新
      const updateData: Record<string, unknown> = {
        editedBy: auth.currentUser.uid,
        editedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }

      // 変更されたフィールドを追加
      if (editedFields.customerName !== undefined) {
        updateData.customerName = editedFields.customerName
        updateData.customerKey = editedFields.customerName // グループキーも更新
      }
      if (editedFields.customerId !== undefined) {
        updateData.customerId = editedFields.customerId
      }
      if (editedFields.officeName !== undefined) {
        updateData.officeName = editedFields.officeName
        updateData.officeKey = editedFields.officeName // グループキーも更新
      }
      if (editedFields.officeId !== undefined) {
        updateData.officeId = editedFields.officeId
      }
      if (editedFields.documentType !== undefined) {
        updateData.documentType = editedFields.documentType
        updateData.documentTypeKey = editedFields.documentType // グループキーも更新
      }
      if (editedFields.careManagerKey !== undefined) {
        updateData.careManagerKey = editedFields.careManagerKey
      }
      if (editedFields.fileName !== undefined) {
        updateData.fileName = editedFields.fileName
      }
      if (editedFields.fileDate !== undefined) {
        updateData.fileDate = editedFields.fileDate
      }

      await updateDoc(docRef, updateData)

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
  }, [document, editedFields])

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
