/**
 * 設定画面
 * Gmail監視設定、ユーザー管理（ホワイトリスト）
 */

import { useState, useEffect } from 'react'
import { Plus, Trash2, Mail, Users, AlertCircle, Save, X, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSettings, useUpdateSettings, useUsers, useAddUser, useDeleteUser, useUpdateUserRole } from '@/hooks/useSettings'
import type { UserRole } from '@shared/types'

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">設定</h1>
        <p className="mt-1 text-sm text-gray-500">
          Gmail監視設定とユーザー管理を行います
        </p>
      </div>

      <Tabs defaultValue="gmail" className="space-y-4">
        <TabsList>
          <TabsTrigger value="gmail" className="gap-2">
            <Mail className="h-4 w-4" />
            Gmail設定
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            ユーザー管理
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <AlertCircle className="h-4 w-4" />
            通知設定
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gmail">
          <GmailSettings />
        </TabsContent>

        <TabsContent value="users">
          <UserManagement />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationSettings />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============================================
// Gmail設定
// ============================================

function GmailSettings() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()
  const [labels, setLabels] = useState<string[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [senders, setSenders] = useState<string[]>([])
  const [newSender, setNewSender] = useState('')
  const [gmailAccount, setGmailAccount] = useState('')
  const [isAndOperator, setIsAndOperator] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [showLabelConfirmDialog, setShowLabelConfirmDialog] = useState(false)
  const [showSenderConfirmDialog, setShowSenderConfirmDialog] = useState(false)

  // 初回読み込み時のみローカル状態を設定
  useEffect(() => {
    if (settings && !isInitialized) {
      setLabels(settings.targetLabels || [])
      setSenders(settings.targetSenders || [])
      setGmailAccount(settings.gmailAccount || '')
      setIsAndOperator(settings.labelSearchOperator === 'AND')
      setIsInitialized(true)
    }
  }, [settings, isInitialized])

  // 保存メッセージを3秒後に消す
  useEffect(() => {
    if (saveMessage) {
      const timer = setTimeout(() => setSaveMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [saveMessage])

  const handleAddLabel = () => {
    if (newLabel.trim() && !labels.includes(newLabel.trim())) {
      setLabels([...labels, newLabel.trim()])
      setNewLabel('')
      setHasChanges(true)
    }
  }

  const handleRemoveLabel = (label: string) => {
    setLabels(labels.filter((l) => l !== label))
    setHasChanges(true)
  }

  const handleAddSender = () => {
    if (newSender.trim() && !senders.includes(newSender.trim())) {
      setSenders([...senders, newSender.trim()])
      setNewSender('')
      setHasChanges(true)
    }
  }

  const handleRemoveSender = (sender: string) => {
    setSenders(senders.filter((s) => s !== sender))
    setHasChanges(true)
  }

  const handleSaveClick = () => {
    // 未追加のラベルがある場合は確認ダイアログを表示
    const pendingLabel = newLabel.trim()
    if (pendingLabel && !labels.includes(pendingLabel)) {
      setShowLabelConfirmDialog(true)
      return
    }
    // 未追加の送信元がある場合は確認ダイアログを表示
    const pendingSender = newSender.trim()
    if (pendingSender && !senders.includes(pendingSender)) {
      setShowSenderConfirmDialog(true)
      return
    }
    handleSave(labels, senders)
  }

  const handleSave = async (labelsToSave: string[], sendersToSave: string[]) => {
    console.log('Gmail設定を保存中...', { labels: labelsToSave, senders: sendersToSave, gmailAccount, isAndOperator })
    try {
      await updateSettings.mutateAsync({
        targetLabels: labelsToSave,
        targetSenders: sendersToSave,
        labelSearchOperator: isAndOperator ? 'AND' : 'OR',
        gmailAccount,
      })
      setHasChanges(false)
      setNewLabel('')
      setNewSender('')
      setSaveMessage({ type: 'success', text: '設定を保存しました' })
      console.log('Gmail設定を保存しました')
    } catch (error) {
      console.error('Gmail設定の保存に失敗:', error)
      setSaveMessage({ type: 'error', text: '保存に失敗しました' })
    }
  }

  const handleConfirmAddLabel = () => {
    const pendingLabel = newLabel.trim()
    const updatedLabels = [...labels, pendingLabel]
    setLabels(updatedLabels)
    setShowLabelConfirmDialog(false)
    // 送信元の未追加もチェック
    const pendingSender = newSender.trim()
    if (pendingSender && !senders.includes(pendingSender)) {
      setShowSenderConfirmDialog(true)
      return
    }
    handleSave(updatedLabels, senders)
  }

  const handleConfirmSkipLabel = () => {
    setShowLabelConfirmDialog(false)
    // 送信元の未追加もチェック
    const pendingSender = newSender.trim()
    if (pendingSender && !senders.includes(pendingSender)) {
      setShowSenderConfirmDialog(true)
      return
    }
    handleSave(labels, senders)
  }

  const handleConfirmAddSender = () => {
    const pendingSender = newSender.trim()
    const updatedSenders = [...senders, pendingSender]
    setSenders(updatedSenders)
    setShowSenderConfirmDialog(false)
    handleSave(labels, updatedSenders)
  }

  const handleConfirmSkipSender = () => {
    setShowSenderConfirmDialog(false)
    handleSave(labels, senders)
  }

  if (isLoading) {
    return <div className="text-center py-8">読み込み中...</div>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gmail監視設定</CardTitle>
        <CardDescription>
          監視対象のGmailアカウントとラベルを設定します
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Gmailアカウント */}
        <div className="space-y-2">
          <Label htmlFor="gmail-account">監視対象Gmailアカウント</Label>
          <Input
            id="gmail-account"
            type="email"
            placeholder="example@gmail.com"
            value={gmailAccount}
            onChange={(e) => {
              setGmailAccount(e.target.value)
              setHasChanges(true)
            }}
          />
          <p className="text-xs text-gray-500">
            添付ファイルを取得するGmailアカウントを指定します
          </p>
        </div>

        {/* ラベル設定 */}
        <div className="space-y-2">
          <Label>監視対象ラベル</Label>
          <div className="flex gap-2">
            <Input
              placeholder="カスタムラベルを入力"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddLabel()}
            />
            <Button
              onClick={handleAddLabel}
              size="icon"
              disabled={!newLabel.trim()}
              title="ラベルを追加"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {/* よく使うラベルのプリセット */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-gray-500 mr-1">よく使うラベル:</span>
            {['INBOX', 'STARRED', 'IMPORTANT'].map((preset) => (
              <button
                key={preset}
                onClick={() => {
                  if (!labels.includes(preset)) {
                    setLabels([...labels, preset])
                    setHasChanges(true)
                  }
                }}
                disabled={labels.includes(preset)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  labels.includes(preset)
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50'
                }`}
              >
                + {preset}
              </button>
            ))}
          </div>
          {/* 追加済みラベル */}
          <div className="flex flex-wrap gap-2 mt-2">
            {labels.length === 0 ? (
              <p className="text-sm text-gray-500">ラベルが設定されていません</p>
            ) : (
              labels.map((label) => (
                <Badge key={label} variant="secondary" className="gap-1">
                  {label}
                  <button
                    onClick={() => handleRemoveLabel(label)}
                    className="ml-1 hover:text-red-500"
                    title="ラベルを削除"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
        </div>

        {/* 送信元メールアドレス設定 */}
        <div className="space-y-2">
          <Label>監視対象送信元</Label>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="sender@example.com"
              value={newSender}
              onChange={(e) => setNewSender(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddSender()}
            />
            <Button
              onClick={handleAddSender}
              size="icon"
              disabled={!newSender.trim()}
              title="送信元を追加"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {/* 追加済み送信元 */}
          <div className="flex flex-wrap gap-2 mt-2">
            {senders.length === 0 ? (
              <p className="text-sm text-gray-500">送信元が設定されていません</p>
            ) : (
              senders.map((sender) => (
                <Badge key={sender} variant="secondary" className="gap-1">
                  {sender}
                  <button
                    onClick={() => handleRemoveSender(sender)}
                    className="ml-1 hover:text-red-500"
                    title="送信元を削除"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
          <p className="text-xs text-gray-500">
            指定したメールアドレスから届いたメールの添付ファイルを取得します
          </p>
        </div>

        {/* フィルター条件の説明 */}
        <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-700">
          <p className="font-medium mb-1">フィルター条件</p>
          <p>
            {labels.length > 0 && senders.length > 0
              ? 'ラベルまたは送信元のいずれかに該当するメールから添付ファイルを取得します'
              : labels.length > 0
                ? '指定したラベルのメールから添付ファイルを取得します'
                : senders.length > 0
                  ? '指定した送信元からのメールの添付ファイルを取得します'
                  : 'ラベルまたは送信元を設定してください'}
          </p>
        </div>

        {/* AND/OR切替（ラベルが複数ある場合のみ表示） */}
        {labels.length > 1 && (
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>ラベル検索条件</Label>
              <p className="text-xs text-gray-500">
                {isAndOperator
                  ? '全てのラベルに一致するメールを取得（AND）'
                  : 'いずれかのラベルに一致するメールを取得（OR）'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">OR</span>
              <Switch
                checked={isAndOperator}
                onCheckedChange={(checked) => {
                  setIsAndOperator(checked)
                  setHasChanges(true)
                }}
              />
              <span className="text-sm">AND</span>
            </div>
          </div>
        )}

        {/* 保存ボタン */}
        <div className="flex items-center justify-end gap-4">
          {saveMessage && (
            <div className={`flex items-center gap-2 text-sm ${
              saveMessage.type === 'success' ? 'text-green-600' : 'text-red-600'
            }`}>
              {saveMessage.type === 'success' ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              {saveMessage.text}
            </div>
          )}
          <Button
            onClick={handleSaveClick}
            disabled={!hasChanges || updateSettings.isPending}
          >
            <Save className="h-4 w-4 mr-2" />
            {updateSettings.isPending ? '保存中...' : '設定を保存'}
          </Button>
        </div>

        {/* 未追加ラベル確認ダイアログ */}
        <Dialog open={showLabelConfirmDialog} onOpenChange={setShowLabelConfirmDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>入力中のラベルがあります</DialogTitle>
              <DialogDescription>
                入力中のラベル「{newLabel.trim()}」を追加しますか？
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setShowLabelConfirmDialog(false)}>
                キャンセル
              </Button>
              <Button variant="secondary" onClick={handleConfirmSkipLabel}>
                追加せず保存
              </Button>
              <Button onClick={handleConfirmAddLabel}>
                追加して保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 未追加送信元確認ダイアログ */}
        <Dialog open={showSenderConfirmDialog} onOpenChange={setShowSenderConfirmDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>入力中の送信元があります</DialogTitle>
              <DialogDescription>
                入力中の送信元「{newSender.trim()}」を追加しますか？
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setShowSenderConfirmDialog(false)}>
                キャンセル
              </Button>
              <Button variant="secondary" onClick={handleConfirmSkipSender}>
                追加せず保存
              </Button>
              <Button onClick={handleConfirmAddSender}>
                追加して保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

// ============================================
// ユーザー管理
// ============================================

function UserManagement() {
  const { data: users, isLoading } = useUsers()
  const addUser = useAddUser()
  const deleteUser = useDeleteUser()
  const updateUserRole = useUpdateUserRole()
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserRole, setNewUserRole] = useState<UserRole>('user')
  const [deleteConfirmUid, setDeleteConfirmUid] = useState<string | null>(null)

  const handleAddUser = async () => {
    if (!newUserEmail.trim()) return

    await addUser.mutateAsync({
      email: newUserEmail.trim(),
      role: newUserRole,
    })
    setNewUserEmail('')
    setNewUserRole('user')
    setIsAddDialogOpen(false)
  }

  const handleDeleteUser = async (uid: string) => {
    await deleteUser.mutateAsync(uid)
    setDeleteConfirmUid(null)
  }

  const handleRoleChange = async (uid: string, role: UserRole) => {
    await updateUserRole.mutateAsync({ uid, role })
  }

  if (isLoading) {
    return <div className="text-center py-8">読み込み中...</div>
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>ユーザー管理（ホワイトリスト）</CardTitle>
          <CardDescription>
            ログインを許可するユーザーを管理します
          </CardDescription>
        </div>
        <Button onClick={() => setIsAddDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          ユーザー追加
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>メールアドレス</TableHead>
              <TableHead>権限</TableHead>
              <TableHead>最終ログイン</TableHead>
              <TableHead className="w-[100px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-gray-500">
                  ユーザーが登録されていません
                </TableCell>
              </TableRow>
            ) : (
              users?.map((user) => (
                <TableRow key={user.uid}>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Select
                      value={user.role}
                      onValueChange={(value: UserRole) =>
                        handleRoleChange(user.uid, value)
                      }
                    >
                      <SelectTrigger className="w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">管理者</SelectItem>
                        <SelectItem value="user">一般</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {user.lastLoginAt?.toDate().toLocaleString('ja-JP')}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => setDeleteConfirmUid(user.uid)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* ユーザー追加ダイアログ */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>ユーザー追加</DialogTitle>
              <DialogDescription>
                ログインを許可するユーザーのメールアドレスを入力してください
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email">メールアドレス</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@example.com"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">権限</Label>
                <Select
                  value={newUserRole}
                  onValueChange={(value: UserRole) => setNewUserRole(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">管理者</SelectItem>
                    <SelectItem value="user">一般</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                キャンセル
              </Button>
              <Button onClick={handleAddUser} disabled={addUser.isPending}>
                {addUser.isPending ? '追加中...' : '追加'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 削除確認ダイアログ */}
        <Dialog
          open={!!deleteConfirmUid}
          onOpenChange={() => setDeleteConfirmUid(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>ユーザー削除の確認</DialogTitle>
              <DialogDescription>
                このユーザーを削除すると、ログインできなくなります。
                本当に削除しますか？
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteConfirmUid(null)}>
                キャンセル
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteConfirmUid && handleDeleteUser(deleteConfirmUid)}
                disabled={deleteUser.isPending}
              >
                {deleteUser.isPending ? '削除中...' : '削除'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

// ============================================
// 通知設定
// ============================================

function NotificationSettings() {
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()
  const [emails, setEmails] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [hasChanges, setHasChanges] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)

  // 初回読み込み時のみローカル状態を設定
  useEffect(() => {
    if (settings && !isInitialized) {
      setEmails(settings.errorNotificationEmails || [])
      setIsInitialized(true)
    }
  }, [settings, isInitialized])

  // 保存メッセージを3秒後に消す
  useEffect(() => {
    if (saveMessage) {
      const timer = setTimeout(() => setSaveMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [saveMessage])

  const handleAddEmail = () => {
    if (newEmail.trim() && !emails.includes(newEmail.trim())) {
      setEmails([...emails, newEmail.trim()])
      setNewEmail('')
      setHasChanges(true)
    }
  }

  const handleRemoveEmail = (email: string) => {
    setEmails(emails.filter((e) => e !== email))
    setHasChanges(true)
  }

  const handleSave = async () => {
    console.log('通知設定を保存中...', { emails })
    try {
      await updateSettings.mutateAsync({
        errorNotificationEmails: emails,
      })
      setHasChanges(false)
      setSaveMessage({ type: 'success', text: '設定を保存しました' })
      console.log('通知設定を保存しました')
    } catch (error) {
      console.error('通知設定の保存に失敗:', error)
      setSaveMessage({ type: 'error', text: '保存に失敗しました' })
    }
  }

  if (isLoading) {
    return <div className="text-center py-8">読み込み中...</div>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>通知設定</CardTitle>
        <CardDescription>
          エラー発生時の通知先メールアドレスを設定します
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>エラー通知先メールアドレス</Label>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="admin@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddEmail()}
            />
            <Button onClick={handleAddEmail} size="icon">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {emails.length === 0 ? (
              <p className="text-sm text-gray-500">
                通知先が設定されていません
              </p>
            ) : (
              emails.map((email) => (
                <Badge key={email} variant="secondary" className="gap-1">
                  {email}
                  <button
                    onClick={() => handleRemoveEmail(email)}
                    className="ml-1 hover:text-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
          <p className="text-xs text-gray-500">
            OCR処理でエラーが発生した場合、上記メールアドレスに通知が送信されます
          </p>
        </div>

        <div className="flex items-center justify-end gap-4">
          {saveMessage && (
            <div className={`flex items-center gap-2 text-sm ${
              saveMessage.type === 'success' ? 'text-green-600' : 'text-red-600'
            }`}>
              {saveMessage.type === 'success' ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              {saveMessage.text}
            </div>
          )}
          <Button
            onClick={handleSave}
            disabled={!hasChanges || updateSettings.isPending}
          >
            <Save className="h-4 w-4 mr-2" />
            {updateSettings.isPending ? '保存中...' : '設定を保存'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
