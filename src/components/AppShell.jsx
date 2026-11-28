import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { BookOpen, Loader2, Moon, RefreshCw, ShoppingBasket, Sun, Users } from 'lucide-react'
import UserMenu from '@/components/UserMenu'
import ErrorBoundary from '@/components/ErrorBoundary'
import PDFUploader from '@/components/PDFUploader'
import { useShoppingList } from '@/hooks/useShoppingList'
import { useTheme } from '@/hooks/useTheme'
import { themeToggleLabel } from '@/lib/theme'
import { useUnseenShareCount } from '@/hooks/useShares'

// The four main tabs. `short` is the phone tab-bar label, where the full
// name doesn't fit.
const TABS = [
  { to: '/recipes', label: 'Recipes', short: 'Recipes', icon: BookOpen },
  { to: '/shopping', label: 'Shopping', short: 'Shopping', icon: ShoppingBasket },
  { to: '/ordering', label: 'Automated ordering', short: 'Ordering', icon: RefreshCw },
  { to: '/social', label: 'Social', short: 'Social', icon: Users },
]

// Layout for every signed-in page: header (logo, the four tabs as pills from 1024 px
// wide, Light/Dark button, upload, cart with count, account), the page itself, and a
// bottom tab bar below 1024 px. The shopping list lives here so the Recipes tab
// (adding recipes), the Shopping tab (the list) and the header's cart count share one copy.
export default function AppShell() {
  const shoppingList = useShoppingList()
  const { pathname } = useLocation()
  const [refreshKey, setRefreshKey] = useState(0)
  const count = shoppingList.selectedIds.length
  const { theme, toggle } = useTheme()
  const themeButton = themeToggleLabel(theme)
  const unseenShares = useUnseenShareCount()
  // Small count on a tab: unseen shares on Social.
  const tabBadge = (to) => (to === '/social' && unseenShares > 0 ? unseenShares : 0)

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-header text-header-foreground">
        <div className="mx-auto flex max-w-[1200px] items-center gap-2 sm:gap-3 lg:gap-4 px-4 lg:px-6 py-3">
          <Link to="/recipes" className="flex min-w-0 items-center gap-2.5 text-header-title hover:opacity-80 transition-opacity">
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 11h16a8 8 0 0 1-16 0z" />
                <path d="M9 7c0-2 2-2 2-4M14 7c0-2 2-2 2-4" />
              </svg>
            </span>
            <span className="truncate font-display text-lg sm:text-[21px] font-bold">Hello Fresh Trash</span>
          </Link>

          <nav aria-label="Main" className="hidden lg:flex items-center gap-1 ml-2">
            {TABS.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `rounded-full px-3.5 py-2.5 text-[15px] transition-colors ${
                    isActive
                      ? 'bg-primary/15 text-primary-text font-semibold'
                      : 'text-muted-foreground font-medium hover:bg-accent hover:text-accent-foreground'
                  }`
                }
              >
                {label}
                {tabBadge(to) > 0 && (
                  <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-badge px-1 text-xs font-bold text-badge-foreground" aria-label={`${tabBadge(to)} new`}>
                    {tabBadge(to)}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="flex-1" />

          <button
            type="button"
            onClick={toggle}
            aria-label={themeButton.ariaLabel}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-input bg-muted px-3 lg:px-4 text-sm font-semibold hover:bg-accent transition-colors"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
            <span className="hidden xl:inline">{themeButton.label}</span>
          </button>
          <PDFUploader onUploadComplete={() => setRefreshKey(k => k + 1)} />
          <Link
            to="/shopping"
            className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background hover:opacity-90 transition-opacity"
            aria-label={count > 0 ? `Shopping list, ${count} recipes` : 'Shopping list'}
          >
            <ShoppingBasket className="h-5 w-5" aria-hidden="true" />
            {count > 0 && (
              <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-badge text-badge-foreground text-xs font-bold flex items-center justify-center pointer-events-none">
                {count}
              </span>
            )}
          </Link>
          <UserMenu />
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto pb-20 lg:pb-0">
        {/* A page that fails shows a message here (header and tabs stay); another tab retries. */}
        <ErrorBoundary resetKey={pathname}>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <Outlet context={{ shoppingList, refreshKey }} />
          </Suspense>
        </ErrorBoundary>
      </main>

      <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-40 flex border-t border-border bg-header pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ to, short, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-1 min-h-14 text-xs transition-colors ${
                isActive ? 'text-primary-text font-semibold' : 'text-muted-foreground font-medium'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`relative flex h-7 w-12 items-center justify-center rounded-full ${isActive ? 'bg-primary/15' : ''}`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {tabBadge(to) > 0 && (
                    <span className="absolute -right-0.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-badge px-1 text-[10px] font-bold text-badge-foreground" aria-label={`${tabBadge(to)} new`}>
                      {tabBadge(to)}
                    </span>
                  )}
                </span>
                {short}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
