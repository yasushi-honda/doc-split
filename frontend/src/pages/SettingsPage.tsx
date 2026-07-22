/**
 * 設定画面
 * Gmail監視設定、ユーザー管理（ホワイトリスト）
 */

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Mail, Users, AlertCircle, Save, X, CheckCircle, Server, Copy, Check, Link2, Loader2, HardDrive, FolderOpen } from 'lucide-react'
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
import { useDriveSettings, useUpdateDriveSettings, DRIVE_SETTINGS_QUERY_KEY } from '@/hooks/useDriveSettings'
import { useGooglePickerScript } from '@/hooks/useGooglePickerScript'
import { openFolderPicker } from '@/lib/googlePicker'
import { DriveFolderTemplateEditor } from '@/components/DriveFolderTemplateEditor'
import { validateTemplate } from '@/lib/driveFolderTemplate'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { callFunction, getCallableErrorMessage } from '@/lib/callFunction'
import { useQueryClient } from '@tanstack/react-query'
import type { UserRole, DriveFolderTemplate } from '@shared/types'

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
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
          <TabsTrigger value="gmail" className="gap-2 flex-shrink-0">
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Gmail設定</span>
          </TabsTrigger>
          <TabsTrigger value="drive" className="gap-2 flex-shrink-0">
            <HardDrive className="h-4 w-4" />
            <span className="hidden sm:inline">Google Drive</span>
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2 flex-shrink-0">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">ユーザー管理</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2 flex-shrink-0">
            <AlertCircle className="h-4 w-4" />
            <span className="hidden sm:inline">通知設定</span>
          </TabsTrigger>
          <TabsTrigger value="setup" className="gap-2 flex-shrink-0">
            <Server className="h-4 w-4" />
            <span className="hidden sm:inline">セットアップ情報</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gmail">
          <GmailSettings />
        </TabsContent>

        <TabsContent value="drive">
          <DriveSettingsTab />
        </TabsContent>

        <TabsContent value="users">
          <UserManagement />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationSettings />
        </TabsContent>

        <TabsContent value="setup">
          <SetupInfo />
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

        {/* Gmail連携 */}
        <GmailOAuthConnect />

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
// Gmail OAuth連携
// ============================================

/** Google Identity Services スクリプトをロード */
function useGisScript() {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
      setLoaded(true)
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => setLoaded(true)
    document.head.appendChild(script)
  }, [])
  return loaded
}

/** settings/gmail ドキュメントを取得 */
function useGmailAuthSettings() {
  const [data, setData] = useState<{ authMode: string; oauthClientId?: string } | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refetch = useCallback(async () => {
    try {
      const docSnap = await getDoc(doc(db, 'settings', 'gmail'))
      if (docSnap.exists()) {
        setData(docSnap.data() as { authMode: string; oauthClientId?: string })
      } else {
        setData({ authMode: 'service_account' })
      }
    } catch (error) {
      console.warn('Failed to fetch Gmail auth settings:', error)
      setData({ authMode: 'service_account' })
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { refetch() }, [refetch])

  return { data, isLoading, refetch }
}

function GmailOAuthConnect() {
  const gisLoaded = useGisScript()
  const { data: gmailAuth, isLoading, refetch } = useGmailAuthSettings()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successEmail, setSuccessEmail] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const isConnected = gmailAuth?.authMode === 'oauth'
  const clientId = gmailAuth?.oauthClientId

  const handleConnect = useCallback(() => {
    if (!gisLoaded || !clientId) return

    setError(null)
    setSuccessEmail(null)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google
    if (!google?.accounts?.oauth2) {
      setError('Google認証ライブラリの読み込みに失敗しました')
      return
    }

    const client = google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      ux_mode: 'popup',
      callback: async (response: { code?: string; error?: string }) => {
        if (response.error || !response.code) {
          setError(response.error || '認証がキャンセルされました')
          return
        }

        setConnecting(true)
        try {
          const result = await callFunction<
            { code: string },
            { success: boolean; email: string }
          >('exchangeGmailAuthCode', { code: response.code })

          setSuccessEmail(result.email)
          await refetch()
          queryClient.invalidateQueries({ queryKey: ['settings'] })
        } catch (err) {
          setError(getCallableErrorMessage(err, 'Gmail連携に失敗しました'))
        } finally {
          setConnecting(false)
        }
      },
    })

    client.requestCode()
  }, [gisLoaded, clientId, refetch, queryClient])

  if (isLoading) {
    return null
  }

  // oauthClientIdが未設定の場合は連携UIを表示しない
  if (!clientId) {
    return null
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-base font-medium">Gmail連携</Label>
          <p className="text-xs text-gray-500">
            Gmailの添付ファイルを自動取得するための認証設定
          </p>
        </div>
        {isConnected ? (
          <Badge className="bg-green-100 text-green-800 border-green-200">
            <CheckCircle className="h-3 w-3 mr-1" />
            連携済み
          </Badge>
        ) : (
          <Badge variant="secondary">
            未連携
          </Badge>
        )}
      </div>

      {!isConnected && (
        <Button
          onClick={handleConnect}
          disabled={connecting || !gisLoaded}
          variant="outline"
          className="w-full"
        >
          {connecting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              連携中...
            </>
          ) : (
            <>
              <Link2 className="h-4 w-4 mr-2" />
              Gmailと連携する
            </>
          )}
        </Button>
      )}

      {isConnected && (
        <div className="text-sm text-gray-600">
          Gmailアカウントと連携済みです。添付ファイルの自動取得が有効になっています。
        </div>
      )}

      {isConnected && (
        <Button
          onClick={handleConnect}
          disabled={connecting || !gisLoaded}
          variant="ghost"
          size="sm"
          className="text-gray-500"
        >
          {connecting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              再連携中...
            </>
          ) : (
            '再連携する'
          )}
        </Button>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded p-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {successEmail && (
        <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 rounded p-2">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          {successEmail} との連携が完了しました
        </div>
      )}
    </div>
  )
}

// ============================================
// Google Drive連携(ADR-0022, Phase 1)
// ============================================

function DriveSettingsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Drive連携</CardTitle>
        <CardDescription>
          確認済み書類PDFを利用者ごとのGoogleドライブフォルダへ自動エクスポートする設定です
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <GoogleDriveConnect />
        <DriveFolderPicker />
        <DriveFolderTemplateSection />
      </CardContent>
    </Card>
  )
}

/** Drive OAuth接続(code flow)。GmailOAuthConnectと同型だがscope・接続先ドキュメントが独立(ADR-0022 Decision 1) */
function GoogleDriveConnect() {
  const gisLoaded = useGisScript()
  const { data: drive, isLoading } = useDriveSettings()
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successEmail, setSuccessEmail] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const isConnected = drive?.authMode === 'oauth'
  const clientId = drive?.oauthClientId

  const handleConnect = useCallback(() => {
    if (!gisLoaded || !clientId) return

    setError(null)
    setSuccessEmail(null)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google
    if (!google?.accounts?.oauth2) {
      setError('Google認証ライブラリの読み込みに失敗しました')
      return
    }

    const client = google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      ux_mode: 'popup',
      callback: async (response: { code?: string; error?: string }) => {
        if (response.error || !response.code) {
          setError(response.error || '認証がキャンセルされました')
          return
        }

        setConnecting(true)
        try {
          const result = await callFunction<
            { code: string },
            { success: boolean; email: string }
          >('exchangeDriveAuthCode', { code: response.code })

          setSuccessEmail(result.email)
          queryClient.invalidateQueries({ queryKey: DRIVE_SETTINGS_QUERY_KEY })
        } catch (err) {
          setError(getCallableErrorMessage(err, 'Google Drive連携に失敗しました'))
        } finally {
          setConnecting(false)
        }
      },
      // ポップアップブロック・ユーザーによる手動クローズはcallbackが発火しないため
      // error_callbackで明示的に捕捉する(evaluator指摘対応)
      error_callback: () => {
        setError('認証がキャンセルされました')
      },
    })

    client.requestCode()
  }, [gisLoaded, clientId, queryClient])

  if (isLoading) {
    return null
  }

  // oauthClientIdが未設定(settings/driveへの未投入)の場合は連携UIを表示しない
  if (!clientId) {
    return null
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-base font-medium">Drive接続</Label>
          <p className="text-xs text-gray-500">
            書類PDFのエクスポート先アカウントを認証します
          </p>
        </div>
        {isConnected ? (
          <Badge className="bg-green-100 text-green-800 border-green-200">
            <CheckCircle className="h-3 w-3 mr-1" />
            連携済み
          </Badge>
        ) : (
          <Badge variant="secondary">
            未連携
          </Badge>
        )}
      </div>

      {!isConnected && (
        <Button
          onClick={handleConnect}
          disabled={connecting || !gisLoaded}
          variant="outline"
          className="w-full"
        >
          {connecting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              連携中...
            </>
          ) : (
            <>
              <Link2 className="h-4 w-4 mr-2" />
              Google Driveと連携する
            </>
          )}
        </Button>
      )}

      {isConnected && drive?.connectedEmail && (
        <div className="text-sm text-gray-600">
          {drive.connectedEmail} と連携済みです。
        </div>
      )}

      {isConnected && (
        <Button
          onClick={handleConnect}
          disabled={connecting || !gisLoaded}
          variant="ghost"
          size="sm"
          className="text-gray-500"
        >
          {connecting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              再連携中...
            </>
          ) : (
            '再連携する'
          )}
        </Button>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded p-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {successEmail && (
        <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 rounded p-2">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          {successEmail} との連携が完了しました
        </div>
      )}
    </div>
  )
}

/**
 * エクスポート先ルートフォルダのGoogle Picker選択。
 * Drive接続(code flow)とは別に、Picker表示用の短命access_tokenをtoken flowで取得する
 * (initTokenClient、ADR-0022 Decision 2で実機検証済みのdrive.fileスコープ)。
 */
function DriveFolderPicker() {
  const gisLoaded = useGisScript()
  const pickerLoaded = useGooglePickerScript()
  const { data: drive, isLoading } = useDriveSettings()
  const updateDriveSettings = useUpdateDriveSettings()
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isConnected = drive?.authMode === 'oauth'
  const clientId = drive?.oauthClientId

  const handlePickFolder = useCallback(() => {
    if (!gisLoaded || !pickerLoaded || !clientId) return

    setError(null)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const google = (window as any).google
    if (!google?.accounts?.oauth2) {
      setError('Google認証ライブラリの読み込みに失敗しました')
      return
    }

    const developerKey = import.meta.env.VITE_FIREBASE_API_KEY
    const appId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID

    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (response: { access_token?: string; error?: string }) => {
        if (response.error || !response.access_token) {
          setError(response.error || 'フォルダ選択がキャンセルされました')
          setPicking(false)
          return
        }

        openFolderPicker({
          accessToken: response.access_token,
          developerKey,
          appId,
          onPicked: (folder) => {
            updateDriveSettings.mutate(folder, {
              onError: (err) => setError(getCallableErrorMessage(err, 'フォルダの保存に失敗しました')),
            })
            setPicking(false)
          },
          // Pickerをフォルダ未選択で閉じた場合。evaluator指摘対応:
          // 以前はonPickedでしかpicking状態を解除できず、キャンセル時にボタンが
          // 操作不能なまま固着した
          onCancel: () => setPicking(false),
        })
      },
      // ポップアップブロック・ユーザーによる手動クローズはcallbackが発火しないため
      // error_callbackで明示的に捕捉し、pickingの固着を防ぐ(evaluator指摘対応)
      error_callback: () => {
        setError('フォルダ選択がキャンセルされました')
        setPicking(false)
      },
    })

    setPicking(true)
    tokenClient.requestAccessToken()
  }, [gisLoaded, pickerLoaded, clientId, updateDriveSettings])

  if (isLoading) {
    return null
  }

  if (!clientId) {
    return null
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="space-y-0.5">
        <Label className="text-base font-medium">エクスポート先フォルダ</Label>
        <p className="text-xs text-gray-500">
          書類PDFの振り分け先となるルートフォルダを選択します
        </p>
      </div>

      <p className="text-xs text-amber-600 bg-amber-50 rounded p-2">
        共有ドライブのルート直下は選択できません。1階層以上のサブフォルダを選択してください。
      </p>

      {drive?.rootFolderName && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <FolderOpen className="h-4 w-4 flex-shrink-0" />
          選択中: {drive.rootFolderName}
        </div>
      )}

      <Button
        onClick={handlePickFolder}
        disabled={!isConnected || picking || !gisLoaded || !pickerLoaded}
        variant="outline"
        className="w-full"
      >
        {picking ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            選択中...
          </>
        ) : (
          <>
            <FolderOpen className="h-4 w-4 mr-2" />
            {drive?.rootFolderId ? 'フォルダを変更する' : 'フォルダを選択する'}
          </>
        )}
      </Button>

      {!isConnected && (
        <p className="text-xs text-gray-400">
          フォルダを選択するには、先にDrive接続を完了してください。
        </p>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded p-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  )
}

/** フォルダ階層テンプレート(`settings/drive.template`)編集。GmailSettingsと同じ保存UXパターン */
function DriveFolderTemplateSection() {
  const { data: drive, isLoading } = useDriveSettings()
  const updateDriveSettings = useUpdateDriveSettings()
  const [template, setTemplate] = useState<DriveFolderTemplate>([])
  const [furiganaFallback, setFuriganaFallback] = useState<'stop' | 'useNameInitial'>('stop')
  const [hasChanges, setHasChanges] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (drive && !isInitialized) {
      setTemplate(drive.template ?? [])
      setFuriganaFallback(drive.furiganaFallback ?? 'stop')
      setIsInitialized(true)
    }
  }, [drive, isInitialized])

  useEffect(() => {
    if (saveMessage) {
      const timer = setTimeout(() => setSaveMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [saveMessage])

  const handleSave = async () => {
    const warnings = validateTemplate(template)
    if (warnings.length > 0) {
      setSaveMessage({ type: 'error', text: warnings.join(' / ') })
      return
    }
    try {
      await updateDriveSettings.mutateAsync({ template, furiganaFallback })
      setHasChanges(false)
      setSaveMessage({ type: 'success', text: '保存しました' })
    } catch (err) {
      setSaveMessage({ type: 'error', text: getCallableErrorMessage(err, '保存に失敗しました') })
    }
  }

  if (isLoading) {
    return null
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="space-y-0.5">
        <Label className="text-base font-medium">フォルダ階層テンプレート</Label>
        <p className="text-xs text-gray-500">
          エクスポート先フォルダ配下の階層構成を設定します（例: 事業所 → ケアマネ → 利用者 → 書類カテゴリ）
        </p>
      </div>

      <DriveFolderTemplateEditor
        template={template}
        furiganaFallback={furiganaFallback}
        onChange={(t) => {
          setTemplate(t)
          setHasChanges(true)
        }}
        onFuriganaFallbackChange={(v) => {
          setFuriganaFallback(v)
          setHasChanges(true)
        }}
      />

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
        <Button onClick={handleSave} disabled={!hasChanges || updateDriveSettings.isPending}>
          <Save className="h-4 w-4 mr-2" />
          {updateDriveSettings.isPending ? '保存中...' : '設定を保存'}
        </Button>
      </div>
    </div>
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
    try {
      await updateSettings.mutateAsync({
        errorNotificationEmails: emails,
      })
      setHasChanges(false)
      setSaveMessage({ type: 'success', text: '設定を保存しました' })
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

// ============================================
// セットアップ情報
// ============================================

interface SetupData {
  projectId: string
  adminEmail: string
  gmailAccount: string
  withGmail: boolean
  setupDate: Date
  setupVersion: string
  setupBy: string
  options: {
    skipFunctions: boolean
    skipHosting: boolean
  }
  urls: {
    app: string
    firebaseConsole: string
    gcpConsole: string
  }
}

function SetupInfo() {
  const [setupData, setSetupData] = useState<SetupData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    const fetchSetupData = async () => {
      try {
        const docRef = doc(db, 'settings', 'setup')
        const docSnap = await getDoc(docRef)
        if (docSnap.exists()) {
          const data = docSnap.data()
          setSetupData({
            ...data,
            setupDate: data.setupDate?.toDate?.() || new Date(data.setupDate),
          } as SetupData)
        }
      } catch (error) {
        console.error('Failed to fetch setup data:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchSetupData()
  }, [])

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          読み込み中...
        </CardContent>
      </Card>
    )
  }

  if (!setupData) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          セットアップ情報が見つかりません
        </CardContent>
      </Card>
    )
  }

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  const handleCopy = async (value: string, fieldName: string) => {
    await navigator.clipboard.writeText(value)
    setCopiedField(fieldName)
    setTimeout(() => setCopiedField(null), 2000)
  }

  // コピー可能フィールドコンポーネント
  const CopyableField = ({ label, value, fieldName, mono = false }: {
    label: string
    value: string
    fieldName: string
    mono?: boolean
  }) => (
    <div className="space-y-2">
      <Label className="text-muted-foreground">{label}</Label>
      <div className={`flex items-center gap-2 bg-muted px-3 py-2 rounded ${mono ? 'font-mono' : ''} text-sm`}>
        <span className="flex-1 break-all">{value}</span>
        <button
          onClick={() => handleCopy(value, fieldName)}
          className="flex-shrink-0 p-1 hover:bg-gray-200 rounded transition-colors"
          title="コピー"
        >
          {copiedField === fieldName ? (
            <Check className="h-4 w-4 text-green-600" />
          ) : (
            <Copy className="h-4 w-4 text-gray-500" />
          )}
        </button>
      </div>
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          セットアップ情報
        </CardTitle>
        <CardDescription>
          このテナントの初期設定情報
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 基本情報 */}
        <div className="grid gap-4 md:grid-cols-2">
          <CopyableField
            label="プロジェクトID"
            value={setupData.projectId}
            fieldName="projectId"
            mono
          />
          <div className="space-y-2">
            <Label className="text-muted-foreground">セットアップ日時</Label>
            <div className="text-sm bg-muted px-3 py-2 rounded">
              {formatDate(setupData.setupDate)}
            </div>
          </div>
          <CopyableField
            label="初期管理者"
            value={setupData.adminEmail}
            fieldName="adminEmail"
          />
          <CopyableField
            label="Gmail監視アカウント"
            value={setupData.gmailAccount}
            fieldName="gmailAccount"
          />
        </div>

        {/* セットアップオプション */}
        <div>
          <Label className="text-muted-foreground mb-2 block">セットアップオプション</Label>
          <div className="flex flex-wrap gap-2">
            <Badge variant={setupData.withGmail ? 'default' : 'secondary'}>
              Gmail OAuth: {setupData.withGmail ? '有効' : '無効'}
            </Badge>
            <Badge variant="outline">
              バージョン: {setupData.setupVersion}
            </Badge>
            {setupData.setupBy && (
              <Badge variant="outline">
                実行者: {setupData.setupBy}
              </Badge>
            )}
          </div>
        </div>

        {/* アプリURL */}
        {setupData.urls?.app && (
          <CopyableField
            label="アプリURL"
            value={setupData.urls.app}
            fieldName="appUrl"
            mono
          />
        )}

        {/* 注意書き */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <p className="font-medium mb-1">この情報は変更できません</p>
          <p>セットアップ情報は初期設定時に自動的に記録されます。変更が必要な場合は、システム管理者にお問い合わせください。</p>
        </div>
      </CardContent>
    </Card>
  )
}
