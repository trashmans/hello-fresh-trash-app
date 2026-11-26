import { Suspense } from 'react'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/context/AuthContext'
import ProtectedRoute from '@/components/ProtectedRoute'
import AppShell from '@/components/AppShell'
import { lazyPage, useNewVersionNotice } from '@/hooks/useNewVersionNotice'

const Login = lazyPage(() => import('./pages/Login'))
const Recipes = lazyPage(() => import('./pages/Recipes'))
const Shopping = lazyPage(() => import('./pages/Shopping'))
const Ordering = lazyPage(() => import('./pages/Ordering'))
const Social = lazyPage(() => import('./pages/Social'))
const PrivacyPolicy = lazyPage(() => import('./pages/PrivacyPolicy'))
const Settings = lazyPage(() => import('./pages/Settings'))

export default function App() {
  useNewVersionNotice()
  return (
    <BrowserRouter>
      <Toaster position="bottom-right" richColors />
      <AuthProvider>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Login />} />
            {/* Signed-in pages share the header and the tab navigation. */}
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/recipes" element={<Recipes />} />
              <Route path="/shopping" element={<Shopping />} />
              <Route path="/ordering" element={<Ordering />} />
              <Route path="/social" element={<Social />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            {/* Old address of the Recipes page (bookmarks, the installed app). */}
            <Route path="/home" element={<Navigate to="/recipes" replace />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
