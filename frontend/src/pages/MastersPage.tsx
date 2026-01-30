/**
 * マスターデータ編集画面
 * 顧客・書類・事業所・ケアマネのCRUD
 */

import { useState } from 'react'
import {
  Users,
  FileText,
  Building,
  UserCheck,
  Plus,
  Trash2,
  Pencil,
  Search,
  Download,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useCustomers,
  useAddCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
  useBulkImportCustomersWithActions,
  checkCustomerDuplicate,
  useDocumentTypes,
  useAddDocumentType,
  useUpdateDocumentType,
  useDeleteDocumentType,
  useBulkImportDocumentTypesWithActions,
  useOffices,
  useAddOffice,
  useUpdateOffice,
  useDeleteOffice,
  useBulkImportOfficesWithActions,
  checkOfficeDuplicate,
  useCareManagers,
  useAddCareManager,
  useUpdateCareManager,
  useDeleteCareManager,
  useBulkImportCareManagersWithActions,
  DuplicateError,
  type ImportAction,
  type BulkImportResultDetailed,
} from '@/hooks/useMasters'
import { CsvImportModal } from '@/components/CsvImportModal'
import type { CustomerCSVRow, OfficeCSVRow, CareManagerCSVRow, DocumentTypeCSVRow } from '@/lib/csvParser'

// 汎用データ型
type AnyCSVData = CustomerCSVRow | OfficeCSVRow | CareManagerCSVRow | DocumentTypeCSVRow
import { downloadCsvTemplate } from '@/lib/csvTemplates'
import type { CustomerMaster, DocumentMaster, OfficeMaster, CareManagerMaster } from '@shared/types'

export function MastersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">マスターデータ管理</h1>
        <p className="mt-1 text-sm text-gray-500">
          顧客・書類種別・事業所・ケアマネジャーのマスターデータを管理します
        </p>
      </div>

      <Tabs defaultValue="customers" className="space-y-4">
        <TabsList>
          <TabsTrigger value="customers" className="gap-2">
            <Users className="h-4 w-4" />
            顧客
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-2">
            <FileText className="h-4 w-4" />
            書類種別
          </TabsTrigger>
          <TabsTrigger value="offices" className="gap-2">
            <Building className="h-4 w-4" />
            事業所
          </TabsTrigger>
          <TabsTrigger value="caremanagers" className="gap-2">
            <UserCheck className="h-4 w-4" />
            ケアマネ
          </TabsTrigger>
        </TabsList>

        <TabsContent value="customers">
          <CustomersMaster />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentTypesMaster />
        </TabsContent>
        <TabsContent value="offices">
          <OfficesMaster />
        </TabsContent>
        <TabsContent value="caremanagers">
          <CareManagersMaster />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============================================
// 顧客マスター
// ============================================

function CustomersMaster() {
  const { data: customers, isLoading } = useCustomers()
  const addCustomer = useAddCustomer()
  const updateCustomer = useUpdateCustomer()
  const deleteCustomer = useDeleteCustomer()
  const bulkImport = useBulkImportCustomersWithActions()

  const [searchText, setSearchText] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<CustomerMaster | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CustomerMaster | null>(null)
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false)
  const [checkingDuplicate, setCheckingDuplicate] = useState(false)

  // フォーム状態
  const [formName, setFormName] = useState('')
  const [formFurigana, setFormFurigana] = useState('')
  const [formCareManagerName, setFormCareManagerName] = useState('')
  const [formIsDuplicate, setFormIsDuplicate] = useState(false)
  const [formNotes, setFormNotes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const handleCsvImport = async (
    items: { data: AnyCSVData; existingId?: string; action: ImportAction }[]
  ): Promise<BulkImportResultDetailed> => {
    return await bulkImport.mutateAsync(
      items.map(item => {
        const csvRow = item.data as CustomerCSVRow
        return {
          data: {
            name: csvRow.name,
            furigana: csvRow.furigana,
            careManagerName: csvRow.careManagerName,
          },
          existingId: item.existingId,
          action: item.action,
        }
      })
    )
  }

  const filteredCustomers = customers?.filter(
    (c) =>
      c.name.includes(searchText) ||
      c.furigana.includes(searchText)
  )

  // 同名チェック → 確認ダイアログ or 直接追加
  const handleAdd = async () => {
    setFormError(null)
    setCheckingDuplicate(true)
    try {
      const isDuplicate = await checkCustomerDuplicate(formName)
      if (isDuplicate) {
        // 同名が存在する場合は確認ダイアログを表示
        setDuplicateConfirmOpen(true)
      } else {
        // 同名がなければ直接追加
        await addCustomer.mutateAsync({
          name: formName,
          furigana: formFurigana,
          careManagerName: formCareManagerName || undefined,
          isDuplicate: false,
          notes: formNotes || undefined,
        })
        resetForm()
        setIsAddOpen(false)
      }
    } catch {
      setFormError('追加に失敗しました')
    } finally {
      setCheckingDuplicate(false)
    }
  }

  // 同名確認後に強制追加
  const handleForceAdd = async () => {
    setFormError(null)
    try {
      await addCustomer.mutateAsync({
        name: formName,
        furigana: formFurigana,
        careManagerName: formCareManagerName || undefined,
        isDuplicate: true,
        force: true,
        notes: formNotes || undefined,
      })
      resetForm()
      setIsAddOpen(false)
      setDuplicateConfirmOpen(false)
    } catch {
      setFormError('追加に失敗しました')
    }
  }

  const handleUpdate = async () => {
    if (!editingCustomer) return
    await updateCustomer.mutateAsync({
      id: editingCustomer.id,
      name: formName,
      furigana: formFurigana,
      careManagerName: formCareManagerName,
      isDuplicate: formIsDuplicate,
      notes: formNotes || undefined,
    })
    resetForm()
    setEditingCustomer(null)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteCustomer.mutateAsync(deleteTarget.id)
    setDeleteTarget(null)
  }

  const openEdit = (customer: CustomerMaster) => {
    setFormName(customer.name)
    setFormFurigana(customer.furigana)
    setFormCareManagerName(customer.careManagerName || '')
    setFormIsDuplicate(customer.isDuplicate)
    setFormNotes(customer.notes || '')
    setEditingCustomer(customer)
  }

  const resetForm = () => {
    setFormName('')
    setFormFurigana('')
    setFormCareManagerName('')
    setFormIsDuplicate(false)
    setFormNotes('')
    setFormError(null)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>顧客マスター</CardTitle>
          <CardDescription>{customers?.length ?? 0}件の顧客</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => downloadCsvTemplate('customers')}>
            <Download className="h-4 w-4 mr-1" />
            テンプレート
          </Button>
          <Button variant="outline" onClick={() => setIsCsvImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            CSVインポート
          </Button>
          <Button onClick={() => { resetForm(); setIsAddOpen(true) }}>
            <Plus className="h-4 w-4 mr-2" />
            追加
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="顧客名・フリガナで検索..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8">読み込み中...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>顧客名</TableHead>
                <TableHead>フリガナ</TableHead>
                <TableHead>担当ケアマネ</TableHead>
                <TableHead>同姓同名</TableHead>
                <TableHead className="w-[100px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCustomers?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-gray-500">
                    顧客がありません
                  </TableCell>
                </TableRow>
              ) : (
                filteredCustomers?.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell>{customer.furigana}</TableCell>
                    <TableCell>{customer.careManagerName || '-'}</TableCell>
                    <TableCell>
                      {customer.isDuplicate && (
                        <Badge variant="secondary">同姓同名あり</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(customer)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500"
                          onClick={() => setDeleteTarget(customer)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        {/* 追加ダイアログ */}
        <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) resetForm() }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>顧客追加</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {formError && (
                <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md">
                  {formError}
                </div>
              )}
              <div className="space-y-2">
                <Label>顧客名</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="山田 太郎"
                />
              </div>
              <div className="space-y-2">
                <Label>フリガナ</Label>
                <Input
                  value={formFurigana}
                  onChange={(e) => setFormFurigana(e.target.value)}
                  placeholder="ヤマダ タロウ"
                />
              </div>
              <div className="space-y-2">
                <Label>担当ケアマネ</Label>
                <Input
                  value={formCareManagerName}
                  onChange={(e) => setFormCareManagerName(e.target.value)}
                  placeholder="佐藤 花子"
                />
              </div>
              <div className="space-y-2">
                <Label>区別用メモ（同姓同名対策）</Label>
                <Input
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="北名古屋在住"
                />
                <p className="text-xs text-gray-500">
                  同姓同名の顧客を区別するための補足情報
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                キャンセル
              </Button>
              <Button onClick={handleAdd} disabled={!formName || addCustomer.isPending || checkingDuplicate}>
                {checkingDuplicate ? 'チェック中...' : '追加'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 編集ダイアログ */}
        <Dialog open={!!editingCustomer} onOpenChange={() => setEditingCustomer(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>顧客編集</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>顧客名</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>フリガナ</Label>
                <Input
                  value={formFurigana}
                  onChange={(e) => setFormFurigana(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>担当ケアマネ</Label>
                <Input
                  value={formCareManagerName}
                  onChange={(e) => setFormCareManagerName(e.target.value)}
                  placeholder="佐藤 花子"
                />
              </div>
              <div className="space-y-2">
                <Label>区別用メモ（同姓同名対策）</Label>
                <Input
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="北名古屋在住"
                />
                <p className="text-xs text-gray-500">
                  同姓同名の顧客を区別するための補足情報。選択肢に「名前（メモ）」形式で表示されます
                </p>
              </div>
              <div className="flex items-center justify-between">
                <Label>同姓同名あり</Label>
                <Switch
                  checked={formIsDuplicate}
                  onCheckedChange={setFormIsDuplicate}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingCustomer(null)}>
                キャンセル
              </Button>
              <Button onClick={handleUpdate} disabled={!formName || updateCustomer.isPending}>
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 削除確認ダイアログ */}
        <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>削除確認</DialogTitle>
              <DialogDescription>
                「{deleteTarget?.name}」を削除しますか？この操作は取り消せません。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                キャンセル
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteCustomer.isPending}
              >
                削除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 同名確認ダイアログ */}
        <Dialog open={duplicateConfirmOpen} onOpenChange={setDuplicateConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>同名の顧客が存在します</DialogTitle>
              <DialogDescription>
                「{formName}」という名前の顧客は既に登録されています。
                同名の顧客を追加すると、OCR照合時に候補として表示されます。
                それでも追加しますか？
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDuplicateConfirmOpen(false)}>
                キャンセル
              </Button>
              <Button onClick={handleForceAdd} disabled={addCustomer.isPending}>
                追加する
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CSVインポートモーダル */}
        <CsvImportModal
          type="customer"
          isOpen={isCsvImportOpen}
          onClose={() => setIsCsvImportOpen(false)}
          onImport={handleCsvImport}
        />
      </CardContent>
    </Card>
  )
}

// ============================================
// 書類種別マスター
// ============================================

function DocumentTypesMaster() {
  const { data: documentTypes, isLoading } = useDocumentTypes()
  const addDocumentType = useAddDocumentType()
  const updateDocumentType = useUpdateDocumentType()
  const deleteDocumentType = useDeleteDocumentType()
  const bulkImport = useBulkImportDocumentTypesWithActions()

  const [searchText, setSearchText] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false)
  const [editingDoc, setEditingDoc] = useState<DocumentMaster | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DocumentMaster | null>(null)

  const [formName, setFormName] = useState('')
  const [formDateMarker, setFormDateMarker] = useState('')
  const [formCategory, setFormCategory] = useState('')
  const [formKeywords, setFormKeywords] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const handleCsvImport = async (
    items: { data: AnyCSVData; existingId?: string; action: ImportAction }[]
  ): Promise<BulkImportResultDetailed> => {
    return await bulkImport.mutateAsync(
      items.map(item => ({
        data: {
          name: (item.data as DocumentTypeCSVRow).name,
          dateMarker: (item.data as DocumentTypeCSVRow).dateMarker,
          category: (item.data as DocumentTypeCSVRow).category,
          keywords: (item.data as DocumentTypeCSVRow).keywords,
        },
        action: item.action,
      }))
    )
  }

  const filteredDocs = documentTypes?.filter(
    (d) =>
      d.name.includes(searchText) ||
      d.category.includes(searchText)
  )

  const handleAdd = async () => {
    setFormError(null)
    try {
      await addDocumentType.mutateAsync({
        name: formName,
        dateMarker: formDateMarker,
        category: formCategory,
        keywords: formKeywords,
      })
      resetForm()
      setIsAddOpen(false)
    } catch (error) {
      if (error instanceof DuplicateError) {
        setFormError(error.message)
      } else {
        setFormError('追加に失敗しました')
      }
    }
  }

  const handleUpdate = async () => {
    if (!editingDoc) return
    await updateDocumentType.mutateAsync({
      originalName: editingDoc.name,
      name: formName,
      dateMarker: formDateMarker,
      category: formCategory,
      keywords: formKeywords,
    })
    resetForm()
    setEditingDoc(null)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteDocumentType.mutateAsync(deleteTarget.name)
    setDeleteTarget(null)
  }

  const openEdit = (doc: DocumentMaster) => {
    setFormName(doc.name)
    setFormDateMarker(doc.dateMarker)
    setFormCategory(doc.category)
    setFormKeywords(doc.keywords?.join(';') || '')
    setEditingDoc(doc)
  }

  const resetForm = () => {
    setFormName('')
    setFormDateMarker('')
    setFormCategory('')
    setFormKeywords('')
    setFormError(null)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>書類種別マスター</CardTitle>
          <CardDescription>
            {documentTypes?.length ?? 0}件の書類種別
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => downloadCsvTemplate('documents')}>
            <Download className="h-4 w-4 mr-1" />
            テンプレート
          </Button>
          <Button variant="outline" onClick={() => setIsCsvImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            CSVインポート
          </Button>
          <Button onClick={() => { resetForm(); setIsAddOpen(true) }}>
            <Plus className="h-4 w-4 mr-2" />
            追加
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="書類名・カテゴリで検索..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8">読み込み中...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>書類名</TableHead>
                <TableHead>日付マーカー</TableHead>
                <TableHead>カテゴリ</TableHead>
                <TableHead>キーワード</TableHead>
                <TableHead className="w-[100px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDocs?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-gray-500">
                    書類種別がありません
                  </TableCell>
                </TableRow>
              ) : (
                filteredDocs?.map((doc) => (
                  <TableRow key={doc.name}>
                    <TableCell className="font-medium">{doc.name}</TableCell>
                    <TableCell>{doc.dateMarker || '-'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{doc.category}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      {doc.keywords && doc.keywords.length > 0 ? (
                        <span className="text-xs text-gray-500 truncate block" title={doc.keywords.join('; ')}>
                          {doc.keywords.slice(0, 3).join('; ')}
                          {doc.keywords.length > 3 && ` 他${doc.keywords.length - 3}件`}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(doc)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500"
                          onClick={() => setDeleteTarget(doc)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        {/* 追加ダイアログ */}
        <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) resetForm() }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>書類種別追加</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {formError && (
                <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md">
                  {formError}
                </div>
              )}
              <div className="space-y-2">
                <Label>書類名</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="介護保険被保険者証"
                />
              </div>
              <div className="space-y-2">
                <Label>日付マーカー</Label>
                <Input
                  value={formDateMarker}
                  onChange={(e) => setFormDateMarker(e.target.value)}
                  placeholder="発行日"
                />
                <p className="text-xs text-gray-500">
                  OCRで日付を抽出する際の目印となる文字列
                </p>
              </div>
              <div className="space-y-2">
                <Label>カテゴリ</Label>
                <Input
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  placeholder="介護保険"
                />
              </div>
              <div className="space-y-2">
                <Label>照合用キーワード</Label>
                <Input
                  value={formKeywords}
                  onChange={(e) => setFormKeywords(e.target.value)}
                  placeholder="被保険者証;介護保険;要介護"
                />
                <p className="text-xs text-gray-500">
                  セミコロン(;)区切りで複数指定可。OCRテキストにキーワードが含まれると書類種別として認識されやすくなります
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                キャンセル
              </Button>
              <Button onClick={handleAdd} disabled={!formName || addDocumentType.isPending}>
                追加
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 編集ダイアログ */}
        <Dialog open={!!editingDoc} onOpenChange={() => setEditingDoc(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>書類種別編集</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>書類名</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>日付マーカー</Label>
                <Input
                  value={formDateMarker}
                  onChange={(e) => setFormDateMarker(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>カテゴリ</Label>
                <Input
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>照合用キーワード</Label>
                <Input
                  value={formKeywords}
                  onChange={(e) => setFormKeywords(e.target.value)}
                  placeholder="被保険者証;介護保険;要介護"
                />
                <p className="text-xs text-gray-500">
                  セミコロン(;)区切りで複数指定可
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingDoc(null)}>
                キャンセル
              </Button>
              <Button onClick={handleUpdate} disabled={!formName || updateDocumentType.isPending}>
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 削除確認 */}
        <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>削除確認</DialogTitle>
              <DialogDescription>
                「{deleteTarget?.name}」を削除しますか？
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                キャンセル
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteDocumentType.isPending}
              >
                削除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CSVインポートモーダル */}
        <CsvImportModal
          type="documenttype"
          isOpen={isCsvImportOpen}
          onClose={() => setIsCsvImportOpen(false)}
          onImport={handleCsvImport}
        />
      </CardContent>
    </Card>
  )
}

// ============================================
// 事業所マスター
// ============================================

function OfficesMaster() {
  const { data: offices, isLoading } = useOffices()
  const addOffice = useAddOffice()
  const updateOffice = useUpdateOffice()
  const deleteOffice = useDeleteOffice()
  const bulkImport = useBulkImportOfficesWithActions()

  const [searchText, setSearchText] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingOffice, setEditingOffice] = useState<OfficeMaster | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<OfficeMaster | null>(null)
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false)
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false)
  const [checkingDuplicate, setCheckingDuplicate] = useState(false)

  // フォーム状態
  const [formName, setFormName] = useState('')
  const [formShortName, setFormShortName] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const filteredOffices = offices?.filter(
    (o) =>
      o.name.includes(searchText) ||
      (o.shortName?.includes(searchText) ?? false)
  )

  // 同名チェック → 確認ダイアログ or 直接追加
  const handleAdd = async () => {
    if (!formName.trim()) return
    setFormError(null)
    setCheckingDuplicate(true)
    try {
      const isDuplicate = await checkOfficeDuplicate(formName.trim())
      if (isDuplicate) {
        // 同名が存在する場合は確認ダイアログを表示
        setDuplicateConfirmOpen(true)
      } else {
        // 同名がなければ直接追加
        await addOffice.mutateAsync({
          name: formName.trim(),
          shortName: formShortName.trim(),
          notes: formNotes.trim() || undefined,
        })
        resetForm()
        setIsAddOpen(false)
      }
    } catch {
      setFormError('追加に失敗しました')
    } finally {
      setCheckingDuplicate(false)
    }
  }

  // 同名確認後に強制追加
  const handleForceAdd = async () => {
    setFormError(null)
    try {
      await addOffice.mutateAsync({
        name: formName.trim(),
        shortName: formShortName.trim(),
        notes: formNotes.trim() || undefined,
        force: true,
      })
      resetForm()
      setIsAddOpen(false)
      setDuplicateConfirmOpen(false)
    } catch {
      setFormError('追加に失敗しました')
    }
  }

  const handleUpdate = async () => {
    if (!editingOffice) return
    await updateOffice.mutateAsync({
      originalName: editingOffice.name,
      name: formName,
      shortName: formShortName,
      notes: formNotes.trim() || undefined,
    })
    resetForm()
    setEditingOffice(null)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteOffice.mutateAsync(deleteTarget.name)
    setDeleteTarget(null)
  }

  const openEdit = (office: OfficeMaster) => {
    setFormName(office.name)
    setFormShortName(office.shortName || '')
    setFormNotes(office.notes || '')
    setEditingOffice(office)
  }

  const resetForm = () => {
    setFormName('')
    setFormShortName('')
    setFormNotes('')
    setFormError(null)
  }

  const handleCsvImport = async (
    items: { data: AnyCSVData; existingId?: string; action: ImportAction }[]
  ): Promise<BulkImportResultDetailed> => {
    return await bulkImport.mutateAsync(
      items.map(item => ({
        data: { name: (item.data as OfficeCSVRow).name, shortName: (item.data as OfficeCSVRow).shortName },
        existingId: item.existingId,
        action: item.action,
      }))
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>事業所マスター</CardTitle>
          <CardDescription>{offices?.length ?? 0}件の事業所</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => downloadCsvTemplate('offices')}>
            <Download className="h-4 w-4 mr-1" />
            テンプレート
          </Button>
          <Button variant="outline" onClick={() => setIsCsvImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            CSVインポート
          </Button>
          <Button onClick={() => { resetForm(); setIsAddOpen(true) }}>
            <Plus className="h-4 w-4 mr-2" />
            追加
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="事業所名・略称で検索..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8">読み込み中...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>事業所名</TableHead>
                <TableHead>略称</TableHead>
                <TableHead className="w-[100px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOffices?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-gray-500">
                    事業所がありません
                  </TableCell>
                </TableRow>
              ) : (
                filteredOffices?.map((office) => (
                  <TableRow key={office.name}>
                    <TableCell className="font-medium">{office.name}</TableCell>
                    <TableCell>{office.shortName || '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(office)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500"
                          onClick={() => setDeleteTarget(office)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        {/* 追加ダイアログ */}
        <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) resetForm() }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>事業所追加</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {formError && (
                <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md">
                  {formError}
                </div>
              )}
              <div className="space-y-2">
                <Label>事業所名</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="○○介護サービス"
                />
              </div>
              <div className="space-y-2">
                <Label>略称（オプション）</Label>
                <Input
                  value={formShortName}
                  onChange={(e) => setFormShortName(e.target.value)}
                  placeholder="○○介護"
                />
                <p className="text-xs text-gray-500">
                  OCRで事業所を照合する際に使用する短い名称
                </p>
              </div>
              <div className="space-y-2">
                <Label>区別用メモ（同名対策）</Label>
                <Input
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="東部"
                />
                <p className="text-xs text-gray-500">
                  同名の事業所を区別するための補足情報
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                キャンセル
              </Button>
              <Button onClick={handleAdd} disabled={!formName.trim() || addOffice.isPending || checkingDuplicate}>
                {checkingDuplicate ? 'チェック中...' : '追加'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 同名確認ダイアログ */}
        <Dialog open={duplicateConfirmOpen} onOpenChange={setDuplicateConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>同名の事業所が存在します</DialogTitle>
              <DialogDescription>
                「{formName}」という名前の事業所は既に登録されています。
                同名の事業所を追加すると、OCR照合時に候補として表示されます。
                それでも追加しますか？
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDuplicateConfirmOpen(false)}>
                キャンセル
              </Button>
              <Button onClick={handleForceAdd} disabled={addOffice.isPending}>
                追加する
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 編集ダイアログ */}
        <Dialog open={!!editingOffice} onOpenChange={() => setEditingOffice(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>事業所編集</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>事業所名</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>略称（オプション）</Label>
                <Input
                  value={formShortName}
                  onChange={(e) => setFormShortName(e.target.value)}
                  placeholder="○○介護"
                />
              </div>
              <div className="space-y-2">
                <Label>区別用メモ（同名対策）</Label>
                <Input
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="東部"
                />
                <p className="text-xs text-gray-500">
                  同名の事業所を区別するための補足情報。選択肢に「名前（メモ）」形式で表示されます
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingOffice(null)}>
                キャンセル
              </Button>
              <Button onClick={handleUpdate} disabled={!formName.trim() || updateOffice.isPending}>
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 削除確認 */}
        <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>削除確認</DialogTitle>
              <DialogDescription>
                「{deleteTarget?.name}」を削除しますか？
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                キャンセル
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteOffice.isPending}
              >
                削除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CSVインポートモーダル */}
        <CsvImportModal
          type="office"
          isOpen={isCsvImportOpen}
          onClose={() => setIsCsvImportOpen(false)}
          onImport={handleCsvImport}
        />
      </CardContent>
    </Card>
  )
}

// ============================================
// ケアマネマスター
// ============================================

function CareManagersMaster() {
  const { data: careManagers, isLoading } = useCareManagers()
  const addCareManager = useAddCareManager()
  const updateCareManager = useUpdateCareManager()
  const deleteCareManager = useDeleteCareManager()
  const bulkImport = useBulkImportCareManagersWithActions()

  const [searchText, setSearchText] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingCM, setEditingCM] = useState<CareManagerMaster | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CareManagerMaster | null>(null)
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false)

  // フォーム状態
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formAliases, setFormAliases] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const filteredCMs = careManagers?.filter(
    (cm) => cm.name.includes(searchText) || cm.email?.includes(searchText)
  )

  const handleAdd = async () => {
    if (!formName.trim()) return
    setFormError(null)
    try {
      const aliases = formAliases.trim()
        ? formAliases.split(/[,|]/).map(a => a.trim()).filter(a => a)
        : []
      await addCareManager.mutateAsync({
        name: formName.trim(),
        email: formEmail.trim() || undefined,
        aliases: aliases.length > 0 ? aliases : undefined,
      })
      resetForm()
      setIsAddOpen(false)
    } catch (error) {
      if (error instanceof DuplicateError) {
        setFormError(error.message)
      } else {
        setFormError('追加に失敗しました')
      }
    }
  }

  const handleUpdate = async () => {
    if (!editingCM) return
    const aliases = formAliases.trim()
      ? formAliases.split(/[,|]/).map(a => a.trim()).filter(a => a)
      : []
    await updateCareManager.mutateAsync({
      originalName: editingCM.name,
      name: formName,
      email: formEmail.trim() || undefined,
      aliases: aliases.length > 0 ? aliases : undefined,
    })
    resetForm()
    setEditingCM(null)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteCareManager.mutateAsync(deleteTarget.name)
    setDeleteTarget(null)
  }

  const openEdit = (cm: CareManagerMaster) => {
    setFormName(cm.name)
    setFormEmail(cm.email || '')
    setFormAliases(cm.aliases?.join(', ') || '')
    setEditingCM(cm)
  }

  const resetForm = () => {
    setFormName('')
    setFormEmail('')
    setFormAliases('')
    setFormError(null)
  }

  const handleCsvImport = async (
    items: { data: AnyCSVData; existingId?: string; action: ImportAction }[]
  ): Promise<BulkImportResultDetailed> => {
    return await bulkImport.mutateAsync(
      items.map(item => ({
        data: { name: (item.data as CareManagerCSVRow).name },
        action: item.action,
      }))
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>ケアマネジャーマスター</CardTitle>
          <CardDescription>{careManagers?.length ?? 0}件のケアマネ</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => downloadCsvTemplate('caremanagers')}>
            <Download className="h-4 w-4 mr-1" />
            テンプレート
          </Button>
          <Button variant="outline" onClick={() => setIsCsvImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            CSVインポート
          </Button>
          <Button onClick={() => { resetForm(); setIsAddOpen(true) }}>
            <Plus className="h-4 w-4 mr-2" />
            追加
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="ケアマネ名で検索..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8">読み込み中...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ケアマネジャー名</TableHead>
                <TableHead>メールアドレス</TableHead>
                <TableHead className="w-[100px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCMs?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-gray-500">
                    ケアマネジャーがありません
                  </TableCell>
                </TableRow>
              ) : (
                filteredCMs?.map((cm) => (
                  <TableRow key={cm.name}>
                    <TableCell className="font-medium">{cm.name}</TableCell>
                    <TableCell className="text-gray-500">{cm.email || '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(cm)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500"
                          onClick={() => setDeleteTarget(cm)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        {/* 追加ダイアログ */}
        <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) resetForm() }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>ケアマネジャー追加</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {formError && (
                <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md">
                  {formError}
                </div>
              )}
              <div className="space-y-2">
                <Label>ケアマネジャー名</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="山田 花子"
                />
              </div>
              <div className="space-y-2">
                <Label>メールアドレス</Label>
                <Input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="yamada@example.com"
                />
                <p className="text-xs text-gray-500">Google Workspaceアカウント推奨</p>
              </div>
              <div className="space-y-2">
                <Label>別表記（カンマ区切り）</Label>
                <Input
                  value={formAliases}
                  onChange={(e) => setFormAliases(e.target.value)}
                  placeholder="山田花子, やまだ花子"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                キャンセル
              </Button>
              <Button onClick={handleAdd} disabled={!formName.trim() || addCareManager.isPending}>
                追加
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 編集ダイアログ */}
        <Dialog open={!!editingCM} onOpenChange={() => setEditingCM(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>ケアマネジャー編集</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>ケアマネジャー名</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>メールアドレス</Label>
                <Input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="yamada@example.com"
                />
                <p className="text-xs text-gray-500">Google Workspaceアカウント推奨</p>
              </div>
              <div className="space-y-2">
                <Label>別表記（カンマ区切り）</Label>
                <Input
                  value={formAliases}
                  onChange={(e) => setFormAliases(e.target.value)}
                  placeholder="山田花子, やまだ花子"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingCM(null)}>
                キャンセル
              </Button>
              <Button onClick={handleUpdate} disabled={!formName.trim() || updateCareManager.isPending}>
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 削除確認 */}
        <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>削除確認</DialogTitle>
              <DialogDescription>
                「{deleteTarget?.name}」を削除しますか？
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                キャンセル
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteCareManager.isPending}
              >
                削除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CSVインポートモーダル */}
        <CsvImportModal
          type="caremanager"
          isOpen={isCsvImportOpen}
          onClose={() => setIsCsvImportOpen(false)}
          onImport={handleCsvImport}
        />
      </CardContent>
    </Card>
  )
}
