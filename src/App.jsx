import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/context/AuthContext'
import ProtectedRoute from '@/components/ProtectedRoute'
import AppShell from '@/components/AppShell'

const Login = lazy(() => import('./pages/Login'))
const Recipes = lazy(() => import('./pages/Recipes'))
const Shopping = lazy(() => import('./pages/Shopping'))
const Ordering = lazy(() => import('./pages/Ordering'))
const Social = lazy(() => import('./pages/Social'))
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'))
const Settings = lazy(() => import('./pages/Settings'))

export default function App() {
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
