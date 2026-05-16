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
import { Editor } from './pages/Editor';
import { Profile } from './pages/Profile';
import { Login } from './pages/Login';

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/workspace" replace />} />
        <Route path="workspace" element={<Workspace />} />
        <Route path="skills" element={<Browse />} />
        <Route path="skills/:ns/:name" element={<SkillDetail />} />
        <Route path="skills/:ns/:name/edit" element={<Editor />} />
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
