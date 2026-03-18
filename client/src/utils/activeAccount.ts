// utils/activeAccount.ts
// إدارة حالة "العمل نيابة عن" عبر localStorage

export type ActiveAccount = {
  actorId: string;
  userId?: string;
  actorName?: string | null;
  userName?: string | null;
  mode: 'self' | 'delegation';
};

const STORAGE_KEY = 'albahar-active-account';

export function getActiveAccount(): ActiveAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || (typeof obj.actorId !== 'string' && typeof obj.userId !== 'string')) return null;
    return {
      actorId: typeof obj.actorId === 'string' ? obj.actorId : obj.userId,
      userId: typeof obj.userId === 'string' ? obj.userId : undefined,
      actorName: typeof obj.actorName === 'string' ? obj.actorName : undefined,
      userName: typeof obj.userName === 'string' ? obj.userName : undefined,
      mode: obj.mode === 'delegation' ? 'delegation' : 'self'
    };
  } catch {
    return null;
  }
}

export function getActiveUserId(fallbackUserId?: string): string {
  const acc = getActiveAccount();
  return acc?.actorId || acc?.userId || fallbackUserId || '';
}

export function getActiveActorId(fallbackActorId?: string): string {
  const acc = getActiveAccount();
  return acc?.actorId || acc?.userId || fallbackActorId || '';
}

export function setActiveAccount(account: ActiveAccount) {
  try {
    const normalized: ActiveAccount = {
      ...account,
      actorId: account.actorId || account.userId || ''
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {}
}

export function clearActiveAccount() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}