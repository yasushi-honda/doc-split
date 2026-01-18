import { useState } from 'react'
import { Users, Mail, Database, AlertTriangle } from 'lucide-react'

type TabType = 'users' | 'gmail' | 'masters' | 'errors'

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabType>('users')

  const tabs = [
    { id: 'users' as const, name: 'ユーザー管理', icon: Users },
    { id: 'gmail' as const, name: 'Gmail設定', icon: Mail },
    { id: 'masters' as const, name: 'マスターデータ', icon: Database },
    { id: 'errors' as const, name: 'エラー一覧', icon: AlertTriangle },
  ]

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">管理画面</h1>

      {/* タブ */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* タブコンテンツ */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'gmail' && <GmailTab />}
        {activeTab === 'masters' && <MastersTab />}
        {activeTab === 'errors' && <ErrorsTab />}
      </div>
    </div>
  )
}

function UsersTab() {
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">ユーザー管理</h2>
      <p className="text-gray-500">ホワイトリスト登録済みユーザーの管理</p>
      {/* TODO: ユーザー一覧・追加・削除 */}
    </div>
  )
}

function GmailTab() {
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Gmail設定</h2>
      <p className="text-gray-500">監視対象ラベルの設定</p>
      {/* TODO: Gmail設定フォーム */}
    </div>
  )
}

function MastersTab() {
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">マスターデータ</h2>
      <p className="text-gray-500">書類・顧客・事業所マスターの管理</p>
      {/* TODO: マスターデータ編集 */}
    </div>
  )
}

function ErrorsTab() {
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">エラー一覧</h2>
      <p className="text-gray-500">処理エラーの確認と再処理</p>
      {/* TODO: エラー一覧・再処理ボタン */}
    </div>
  )
}
