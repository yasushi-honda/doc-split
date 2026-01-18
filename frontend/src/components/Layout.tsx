import { Outlet, Link, useLocation } from 'react-router-dom'
import { FileText, Settings, LogOut } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'

export function Layout() {
  const location = useLocation()
  const { user, isAdmin, signOut } = useAuthStore()

  const navigation = [
    { name: '書類一覧', href: '/', icon: FileText },
    ...(isAdmin ? [{ name: '管理', href: '/admin', icon: Settings }] : []),
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-brand-900 text-white shadow-lg">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-8">
              <Link to="/" className="flex items-center gap-2">
                <FileText className="h-8 w-8" />
                <span className="text-xl font-bold">DocSplit</span>
              </Link>

              <nav className="flex gap-4">
                {navigation.map((item) => (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      location.pathname === item.href
                        ? 'bg-brand-800 text-white'
                        : 'text-brand-100 hover:bg-brand-800 hover:text-white'
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-sm text-brand-200">{user?.email}</span>
              <button
                onClick={() => signOut()}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-brand-100 hover:bg-brand-800 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
                ログアウト
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
