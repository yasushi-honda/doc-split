import { useState } from 'react'
import { Search, Filter, FileText } from 'lucide-react'

export function DocumentsPage() {
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">書類一覧</h1>
      </div>

      {/* 検索・フィルターバー */}
      <div className="mb-6 flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="書類名、顧客名で検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <button className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50">
          <Filter className="h-5 w-5" />
          フィルター
        </button>
      </div>

      {/* 書類リスト（プレースホルダー） */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
          <FileText className="mb-4 h-12 w-12 text-gray-300" />
          <p className="text-lg font-medium">書類がありません</p>
          <p className="mt-1 text-sm">
            Gmailから添付ファイルが取得されると、ここに表示されます
          </p>
        </div>
      </div>
    </div>
  )
}
