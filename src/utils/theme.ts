import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';
export const THEME_KEY = 'streetlens-theme';
let theme: Theme = 'dark';
const listeners = new Set<() => void>();
try { const saved = localStorage.getItem(THEME_KEY); if (saved === 'dark' || saved === 'light') theme = saved; } catch { /* Session-only preferences still work. */ }
function applyTheme() { if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme; }
applyTheme();
export function setTheme(next: Theme) {
  if ((next !== 'dark' && next !== 'light') || next === theme) return;
  theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* Storage may be disabled. */ }
  applyTheme(); listeners.forEach(listener => listener());
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === THEME_KEY) setTheme(event.newValue === 'light' ? 'light' : 'dark');
});
export function useTheme() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => theme, () => 'dark' as Theme);
}
