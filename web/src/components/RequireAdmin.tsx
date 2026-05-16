import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { getStoredUser } from '../api/auth';

export function RequireAdmin({ children }: { children: ReactNode }) {
  const user = getStoredUser();
  if (!user?.isAdmin) {
    return <Navigate to="/workspace" replace />;
  }
  return <>{children}</>;
}
