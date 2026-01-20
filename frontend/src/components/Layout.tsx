import { Outlet, Link, useLocation } from 'react-router-dom'
import { FileText, Settings, LogOut, AlertCircle, Database, History } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'

export function Layout() {
  const location = useLocation()
  const { user, isAdmin, signOut } = useAuthStore()

  const navigation = [
    { name: '書類一覧', href: '/', icon: FileText },
    { name: '処理履歴', href: '/history', icon: History },
    { name: 'エラー履歴', href: '/errors', icon: AlertCircle },
    ...(isAdmin
      ? [
          { name: 'マスター', href: '/masters', icon: Database },
          { name: '設定', href: '/settings', icon: Settings },
        ]
      : []),
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-brand-900 text-white shadow-lg">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-6">
              <Link to="/" className="flex items-center gap-2">
                <img
                  src="/app-icon.png"
                  alt="DocSplit"
                  className="h-9 w-9 rounded-lg object-contain"
                />
                <span className="hidden text-lg font-bold sm:inline">DocSplit</span>
              </Link>

              <nav className="flex gap-1">
                {navigation.map((item) => (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                      location.pathname === item.href
                        ? 'bg-brand-700 text-white'
                        : 'text-brand-200 hover:bg-brand-800 hover:text-white'
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{item.name}</span>
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              <span className="hidden text-sm text-brand-200 sm:inline">{user?.email}</span>
              <button
                onClick={() => signOut()}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-brand-200 hover:bg-brand-800 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">ログアウト</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  )
}
