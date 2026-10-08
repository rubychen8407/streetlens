import { useEffect, useSyncExternalStore } from 'react';
type Access = { enabled: boolean; authorized: boolean; expiresAt: number | null };
let access: Access = { enabled: false, authorized: false, expiresAt: null };
let pending: Promise<void> | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
function update(value: Access) {
  clearTimeout(expiry); access = value; listeners.forEach(listener => listener());
  if (value.authorized && value.expiresAt) expiry = setTimeout(() => revokeHousingAccess(), Math.max(0, value.expiresAt - Date.now()));
}
export function revokeHousingAccess() { update({ ...access, authorized: false, expiresAt: null }); window.dispatchEvent(new Event('private-housing-locked')); }
export function usePrivateHousingAccess(active = true) {
  const value = useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => access);
  useEffect(() => {
    if (!active) return;
    const discover = () => { pending ??= fetch('/api/private/access', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10000) }).then(async response => {
      if (!response.ok) throw new Error('Private access unavailable');
      const body = await response.json();
      if (typeof body.enabled !== 'boolean' || typeof body.authorized !== 'boolean') throw new Error('Invalid access response');
      update({ enabled: body.enabled === true, authorized: body.authorized === true && typeof body.expiresAt === 'number' && body.expiresAt > Date.now(), expiresAt: body.expiresAt });
    }).catch(() => { pending = undefined; }); };
    discover();
    window.addEventListener('online', discover);
    return () => window.removeEventListener('online', discover);
  }, [active]);
  return value;
}
export async function logoutPrivateHousing() {
  // Lock and clear client data immediately, even if the network fails.
  revokeHousingAccess();
  const response = await fetch('/api/private/logout', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Logout failed; close this browser session or retry.');
}
