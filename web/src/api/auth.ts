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
