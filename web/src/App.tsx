import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { RequireAdmin } from './components/RequireAdmin';
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

// Editor pulls in @monaco-editor/react (~2MB) and the markdown preview
// pipeline. Lazy-load it so users browsing skills, reviewing, or doing admin
// work don't pay the cost up front.
const Editor = lazy(() => import('./pages/Editor').then((m) => ({ default: m.Editor })));

function EditorFallback() {
  // We can't use useTranslation here because i18next may not have finished
  // loading when Suspense first kicks in. Use a hardcoded fallback string —
  // the editor chunk loads in <100ms so this is barely ever visible anyway.
  return (
    <div style={{ padding: 32, color: 'var(--text-subtle)', fontSize: 13 }}>
      Loading editor… / 正在加载编辑器…
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route path="register" element={<Register />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/workspace" replace />} />
        <Route path="workspace" element={<Workspace />} />
        <Route path="skills" element={<Browse />} />
        <Route path="skills/:ns/:name" element={<SkillDetail />} />
        <Route
          path="skills/:ns/:name/edit"
          element={<Suspense fallback={<EditorFallback />}><Editor /></Suspense>}
        />
        <Route path="reviews" element={<Reviews />} />
        <Route path="reviews/:id" element={<ReviewDetail />} />
        <Route path="audit" element={<Audit />} />
        <Route path="admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
        <Route path="profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/workspace" replace />} />
      </Route>
    </Routes>
  );
}
