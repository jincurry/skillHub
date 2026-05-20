import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { RequireAdmin } from './components/RequireAdmin';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Workspace } from './pages/Workspace';
import { Browse } from './pages/Browse';
import { SkillDetail } from './pages/SkillDetail';
import { Reviews } from './pages/Reviews';
import { ReviewDetail } from './pages/ReviewDetail';
import { Audit } from './pages/Audit';
import { Admin } from './pages/Admin';
import { Profile } from './pages/Profile';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import i18n from './i18n';
import { isEnglishLanguage } from './i18n/useLocaleText';

// Editor pulls in @monaco-editor/react (~2MB) and the markdown preview
// pipeline. Lazy-load it so users browsing skills, reviewing, or doing admin
// work don't pay the cost up front.
const Editor = lazy(() => import('./pages/Editor').then((m) => ({ default: m.Editor })));

function EditorFallback() {
  // We can't use useTranslation here because i18next may not have finished
  // loading when Suspense first kicks in. Use a hardcoded fallback string —
  // the editor chunk loads in <100ms so this is barely ever visible anyway.
  const loadingText = isEnglishLanguage(i18n.resolvedLanguage ?? i18n.language)
    ? 'Loading editor...'
    : '正在加载编辑器...';
  return (
    <div style={{ padding: 32, color: 'var(--text-subtle)', fontSize: 13 }}>
      {loadingText}
    </div>
  );
}

// RouteBoundary wraps a single route element in an ErrorBoundary keyed on
// pathname + search. React resets a boundary's error state when its key
// changes, so navigating away from a broken page (then back) gives a fresh
// mount instead of leaving the user stranded on the fallback UI.
//
// The boundary is intentionally placed *inside* the Layout outlet so the
// sidebar / topbar keep working when only the page content blows up.
function RouteBoundary({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return (
    <ErrorBoundary key={loc.pathname + loc.search}>
      {children}
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    // The outer boundary is the last line of defence — it catches errors
    // raised by Layout / Sidebar / Topbar themselves (e.g. bad i18n key,
    // crashed NotificationBell). Without it, a render-time exception in any
    // shared chrome component would blank the whole SPA.
    <ErrorBoundary>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Navigate to="/workspace" replace />} />
          <Route path="workspace" element={<RouteBoundary><Workspace /></RouteBoundary>} />
          <Route path="skills" element={<RouteBoundary><Browse /></RouteBoundary>} />
          <Route path="skills/:ns/:name" element={<RouteBoundary><SkillDetail /></RouteBoundary>} />
          <Route
            path="skills/:ns/:name/edit"
            element={
              <RouteBoundary>
                <Suspense fallback={<EditorFallback />}><Editor /></Suspense>
              </RouteBoundary>
            }
          />
          <Route path="reviews" element={<RouteBoundary><Reviews /></RouteBoundary>} />
          <Route path="reviews/:id" element={<RouteBoundary><ReviewDetail /></RouteBoundary>} />
          <Route path="audit" element={<RouteBoundary><Audit /></RouteBoundary>} />
          <Route path="admin" element={<RequireAdmin><RouteBoundary><Admin /></RouteBoundary></RequireAdmin>} />
          <Route path="profile" element={<RouteBoundary><Profile /></RouteBoundary>} />
          <Route path="*" element={<Navigate to="/workspace" replace />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
