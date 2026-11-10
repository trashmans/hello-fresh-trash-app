import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { BookOpen, Loader2, RefreshCw, ShoppingCart, Users } from 'lucide-react'
import UserMenu from '@/components/UserMenu'
import PDFUploader from '@/components/PDFUploader'
import { useShoppingList } from '@/hooks/useShoppingList'

// The four main tabs. `short` is the phone tab-bar label, where the full
// name doesn't fit.
const TABS = [
  { to: '/recipes', label: 'Recipes', short: 'Recipes', icon: BookOpen },
  { to: '/shopping', label: 'Shopping', short: 'Shopping', icon: ShoppingCart },
  { to: '/ordering', label: 'Automated ordering', short: 'Ordering', icon: RefreshCw },
  { to: '/social', label: 'Social', short: 'Social', icon: Users },
]

// Layout for every signed-in page: header (title, upload, cart, account),
// a side menu on desktop, a bottom tab bar on phones, and the page itself.
// The shopping list lives here so the Recipes tab (adding recipes), the
// Shopping tab (the list) and the header's cart count share one copy.
export default function AppShell() {
  const shoppingList = useShoppingList()
  const [refreshKey, setRefreshKey] = useState(0)
  const count = shoppingList.selectedIds.length

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">
      <header className="border-b border-border bg-header text-header-foreground px-4 md:px-6 py-3 flex items-center justify-between gap-3 shrink-0">
        <Link to="/recipes" className="text-lg font-semibold text-header-title hover:opacity-80 transition-opacity truncate">
          Hello Fresh Trash
        </Link>
        <div className="flex items-center gap-3 md:gap-4">
          <PDFUploader onUploadComplete={() => setRefreshKey(k => k + 1)} />
          <Link
            to="/shopping"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label={count > 0 ? `Shopping list, ${count} recipes` : 'Shopping list'}
          >
            <ShoppingCart className="h-5 w-5" />
            {count > 0 && (
              <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-badge text-badge-foreground text-xs font-semibold flex items-center justify-center pointer-events-none">
                {count}
              </span>
            )}
          </Link>
          <UserMenu />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <nav aria-label="Main" className="hidden md:flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-card p-3">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-secondary text-secondary-foreground font-semibold'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground font-medium'
                }`
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 min-w-0 overflow-y-auto pb-20 md:pb-0">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <Outlet context={{ shoppingList, refreshKey }} />
          </Suspense>
        </main>
      </div>

      <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-40 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ to, short, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-1 min-h-14 text-xs transition-colors ${
                isActive
                  ? 'text-secondary font-semibold shadow-[inset_0_3px_0_var(--primary)]'
                  : 'text-muted-foreground font-medium'
              }`
            }
          >
            <Icon className="h-5 w-5" />
            {short}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
