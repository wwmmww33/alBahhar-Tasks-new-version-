// src/utils/roleAccess.ts
// صلاحيات المستخدم مخزّنة كقناع بتّات (bitmask) في UserRoles.Role: بت 1 = مدير نظام، بت 2 = مدير
// قسم، القيمة 3 = كلاهما معاً. هذا يسمح للمستخدم بحمل أكثر من صلاحية في آن واحد.
// بالإضافة إلى ذلك، "وضع العرض" (albahar-admin-view-mode) هو تفضيل عرض محلي بحت لا يغيّر صلاحيات
// المستخدم المخزّنة؛ يحدد فقط هل عناصر تحكم مدير النظام ظاهرة حالياً أم مخفية مؤقتاً.
import type { CurrentUser } from '../types';

const VIEW_MODE_KEY = 'albahar-admin-view-mode';
const VIEW_MODE_EVENT = 'admin-view-mode-changed';

export type AdminViewMode = 'admin' | 'normal';

type RoleBearing = Pick<CurrentUser, 'Role' | 'IsAdmin'> | null | undefined;

function resolveRoleBitmask(user: RoleBearing): number {
  if (!user) return 0;
  if (typeof user.Role === 'number' && Number.isFinite(user.Role)) return user.Role;
  return user.IsAdmin ? 1 : 0;
}

// صلاحية "مدير نظام" الفعلية المخزّنة (بت 1) — بغض النظر عن وضع العرض الحالي.
export function hasSystemAdminRole(user: RoleBearing): boolean {
  return (resolveRoleBitmask(user) & 1) !== 0;
}

// صلاحية "مدير قسم" (بت 2) — لا تتأثر إطلاقاً بزر تبديل وضع العرض.
export function hasDeptManagerRole(user: RoleBearing): boolean {
  return (resolveRoleBitmask(user) & 2) !== 0;
}

export function getAdminViewMode(): AdminViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'admin' ? 'admin' : 'normal';
  } catch {
    return 'normal';
  }
}

export function setAdminViewMode(mode: AdminViewMode): void {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(VIEW_MODE_EVENT));
}

export function toggleAdminViewMode(): AdminViewMode {
  const next: AdminViewMode = getAdminViewMode() === 'admin' ? 'normal' : 'admin';
  setAdminViewMode(next);
  return next;
}

export function onAdminViewModeChanged(handler: () => void): () => void {
  window.addEventListener(VIEW_MODE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(VIEW_MODE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

// يُطبَّق على currentUser قبل تمريره إلى بقية الشجرة: IsAdmin يصبح "فعّالاً" (يراعي وضع العرض)
// بينما Role يبقى خاماً (المستخدم بصلاحية Role=3 يبقى مدير قسم ظاهراً حتى في وضع العرض العادي).
export function withEffectiveAdminView(user: CurrentUser, viewMode: AdminViewMode): CurrentUser {
  return { ...user, IsAdmin: hasSystemAdminRole(user) && viewMode === 'admin' };
}
