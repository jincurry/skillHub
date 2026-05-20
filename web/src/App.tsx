import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { RequireAdmin } from './components/RequireAdmin';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import i18n from './i18n';
import { isEnglishLanguage } from './i18n/useLocaleText';

// Every authenticated page is code-split: the initial bundle now ships only
// the Layout shell + auth pages, and each route's chunk is fetched on first
// navigation. Without this, Workspace + SkillDetail + ReviewDetail (~3000
// LOC combined) plus their dependencies (Markdown renderer, charts, modals)
// would all be eagerly loaded for users who only need to browse skills.
//
// All chunks are kept on the same Suspense fallback so transitions feel
// uniform — Editor is the sole exception because its loading text is
// hardcoded for the i18next-not-yet-ready edge case.
const Workspace = lazy(() => import('./pages/Workspace').then((m) => ({ default: m.Workspace })));
const Browse = lazy(() => import('./pages/Browse').then((m) => ({ default: m.Browse })));
const SkillDetail = lazy(() => import('./pages/SkillDetail').then((m) => ({ default: m.SkillDetail })));
const Reviews = lazy(() => import('./pages/Reviews').then((m) => ({ default: m.Reviews })));
const ReviewDetail = lazy(() => import('./pages/ReviewDetail').then((m) => ({ default: m.ReviewDetail })));
const Audit = lazy(() => import('./pages/Audit').then((m) => ({ default: m.Audit })));
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));

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

// PageFallback is the shared placeholder shown while a lazy route's chunk is
// being fetched. Kept deliberately minimal so it doesn't draw attention on
// fast networks where the chunk arrives in <100ms — a faint "Loading..." in
// the content area is enough; the surrounding Layout chrome stays visible.
function PageFallback() {
  const loadingText = isEnglishLanguage(i18n.resolvedLanguage ?? i18n.language)
    ? 'Loading...'
    : '加载中...';
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
// sidebar / topbar keep working when only the page content blows up. The
// inner Suspense handles the lazy-import waterfall — pairing them at the
// route boundary means a chunk-load failure renders the ErrorBoundary
// fallback instead of bubbling all the way up to the outer SPA boundary.
function RouteBoundary({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const loc = useLocation();
  return (
    <ErrorBoundary key={loc.pathname + loc.search}>
      <Suspense fallback={fallback ?? <PageFallback />}>
        {children}
      </Suspense>
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
            element={<RouteBoundary fallback={<EditorFallback />}><Editor /></RouteBoundary>}
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
