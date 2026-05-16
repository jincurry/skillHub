import type { Me } from '../api/types';

const TOKEN_KEY = 'skillhub.token';
const USER_KEY = 'skillhub.user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): Me | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Me;
  } catch {
    return null;
  }
}

export function setStoredUser(user: Me): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// Returns the JWT expiry as a Date, or null if no token / unparseable.
export function getTokenExpiry(): Date | null {
  const tok = getToken();
  if (!tok) return null;
  try {
    const payload = JSON.parse(atob(tok.split('.')[1]));
    if (typeof payload.exp !== 'number') return null;
    return new Date(payload.exp * 1000);
  } catch {
    return null;
  }
}
