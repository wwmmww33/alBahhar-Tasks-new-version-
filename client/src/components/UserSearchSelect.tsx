// src/components/UserSearchSelect.tsx
// منتقي شخص واحد (أو عدة) بالبحث — يستبدل القائمة المنسدلة العادية لاختيار المسؤول عن مهمة فرعية.
// يُظهر المناصب مجمّعة حسب المديرية (بلون مميز لكل مديرية) ومرتّبة من الأعلى رتبة إلى الأدنى —
// الترتيب والتصفية (استثناء المناصب الشاغرة) تمّا فعلاً من الخادم (listByDepartmentScope)، هذا
// المكوّن يحافظ على ترتيب القائمة الممرَّرة له فقط، ويضيف تجميع/تلوين/بحث نصي فوقها.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { User } from '../types';
import { resolveUserActorId } from '../utils/actorIdentity';

export const userActorId = (user: User) => String(resolveUserActorId(user) || user.UserID);

const DEPARTMENT_COLORS = [
  { dot: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  { dot: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  { dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-900/20' },
  { dot: 'bg-cyan-500', text: 'text-cyan-700 dark:text-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-900/20' },
];
type DeptColor = typeof DEPARTMENT_COLORS[number];

// يُحدَّد لكل مديرية ظهرت ضمن القائمة لوناً ثابتاً — حسب ترتيب ظهورها أول مرة في القائمة
// (لا حسب رقم القسم نفسه)، فتبقى الألوان متسقة ومتمايزة لمجموعة الأقسام الفعلية المعروضة هنا.
export function useDepartmentColorMap(users: User[]): Map<number, DeptColor> {
  return useMemo(() => {
    const order: number[] = [];
    users.forEach(u => {
      const id = u.DepartmentID;
      if (id != null && !order.includes(id)) order.push(id);
    });
    const map = new Map<number, DeptColor>();
    order.forEach((id, i) => map.set(id, DEPARTMENT_COLORS[i % DEPARTMENT_COLORS.length]));
    return map;
  }, [users]);
}

type GroupedEntry = { deptId: number | null; deptName: string; color: DeptColor; users: User[] };

function groupUsers(users: User[], colorMap: Map<number, DeptColor>): GroupedEntry[] {
  const groups = new Map<number | null, GroupedEntry>();
  const order: (number | null)[] = [];
  users.forEach(u => {
    const id = u.DepartmentID ?? null;
    if (!groups.has(id)) {
      order.push(id);
      groups.set(id, {
        deptId: id,
        deptName: u.DepartmentName || (id != null ? `#${id}` : 'غير محدد'),
        color: id != null ? (colorMap.get(id) || DEPARTMENT_COLORS[0]) : DEPARTMENT_COLORS[0],
        users: [],
      });
    }
    groups.get(id)!.users.push(u);
  });
  return order.map(id => groups.get(id)!);
}

function matchesSearch(user: User, q: string): boolean {
  if (!q) return true;
  return (user.FullName || '').toLowerCase().includes(q);
}

// ---- منتقٍ فردي (قائمة منسدلة بحثية تستبدل <select>) ----

type TopOption = { value: string; label: string; className?: string };

type SingleProps = {
  users: User[];
  value: string;
  onChange: (id: string) => void;
  topOptions?: TopOption[];
  fallbackOption?: { value: string; label: string } | null;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export const UserSearchSelect = ({
  users, value, onChange, topOptions = [], fallbackOption, placeholder = 'اختر...', disabled, className = ''
}: SingleProps) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const colorMap = useDepartmentColorMap(users);
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groupUsers(users.filter(u => matchesSearch(u, q)), colorMap);
  }, [users, search, colorMap]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  const selectedLabel = useMemo(() => {
    const top = topOptions.find(o => o.value === value);
    if (top) return top.label;
    if (fallbackOption && fallbackOption.value === value) return fallbackOption.label;
    const u = users.find(u => userActorId(u) === value);
    if (u) return u.FullName;
    return value ? value : placeholder;
  }, [value, users, topOptions, fallbackOption, placeholder]);

  const handlePick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-1 p-2 border rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm disabled:opacity-60 text-right"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown size={14} className="text-gray-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 max-h-80 overflow-y-auto bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-md shadow-lg" dir="rtl">
          <div className="p-2 border-b dark:border-gray-600 sticky top-0 bg-white dark:bg-gray-800">
            <div className="flex items-center gap-1 px-2 py-1 border rounded-md dark:border-gray-600">
              <Search size={13} className="text-gray-400 shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالاسم أو المنصب..."
                className="flex-1 bg-transparent text-sm outline-none dark:text-gray-100 min-w-0"
              />
            </div>
          </div>

          {!search && topOptions.map(opt => (
            <div
              key={opt.value}
              onClick={() => handlePick(opt.value)}
              className={`px-3 py-2 text-sm cursor-pointer hover:bg-content/5 ${opt.className || ''} ${value === opt.value ? 'bg-primary/10' : ''}`}
            >
              {opt.label}
            </div>
          ))}
          {!search && fallbackOption && (
            <div
              onClick={() => handlePick(fallbackOption.value)}
              className={`px-3 py-2 text-sm cursor-pointer hover:bg-content/5 text-amber-600 ${value === fallbackOption.value ? 'bg-primary/10' : ''}`}
              title="هذا الشخص غير ضمن قائمة الإسناد الحالية"
            >
              ⚠ {fallbackOption.label}
            </div>
          )}

          {groups.length === 0 ? (
            <p className="px-3 py-4 text-xs text-gray-400 text-center">لا توجد نتائج</p>
          ) : groups.map(group => (
            <div key={group.deptId ?? 'none'}>
              <div className={`px-3 py-1 text-xs font-semibold flex items-center gap-1.5 ${group.color.bg} ${group.color.text}`}>
                <span className={`w-2 h-2 rounded-full ${group.color.dot}`} />
                {group.deptName}
              </div>
              {group.users.map(u => {
                const id = userActorId(u);
                return (
                  <div
                    key={id}
                    onClick={() => handlePick(id)}
                    className={`px-3 py-2 text-sm cursor-pointer hover:bg-content/5 flex items-center gap-2 ${value === id ? 'bg-primary/10 text-primary font-medium' : ''}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${group.color.dot}`} />
                    <span className="truncate">{u.FullName}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---- قائمة متعددة الاختيار (بحثية مجمّعة) — لاستخدامها داخل نوافذ الإسناد المتعدد ----

type MultiProps = {
  users: User[];
  selected: string[];
  onToggle: (id: string) => void;
  className?: string;
};

export const UserMultiSearchList = ({ users, selected, onToggle, className = '' }: MultiProps) => {
  const [search, setSearch] = useState('');
  const colorMap = useDepartmentColorMap(users);
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groupUsers(users.filter(u => matchesSearch(u, q)), colorMap);
  }, [users, search, colorMap]);

  return (
    <div className={className}>
      <div className="flex items-center gap-1 px-2 py-1.5 border rounded-md dark:border-gray-600 mb-2">
        <Search size={13} className="text-gray-400 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث بالاسم أو المنصب..."
          className="flex-1 bg-transparent text-sm outline-none dark:text-gray-100 min-w-0"
        />
      </div>
      <div className="max-h-60 overflow-y-auto space-y-1 border border-content/10 p-2 rounded">
        {groups.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">لا توجد نتائج</p>
        ) : groups.map(group => (
          <div key={group.deptId ?? 'none'}>
            <div className={`px-2 py-1 text-xs font-semibold flex items-center gap-1.5 rounded ${group.color.bg} ${group.color.text}`}>
              <span className={`w-2 h-2 rounded-full ${group.color.dot}`} />
              {group.deptName}
            </div>
            {group.users.map(u => {
              const id = userActorId(u);
              return (
                <label key={id} className="flex items-center gap-2 cursor-pointer hover:bg-content/5 p-2 rounded transition-colors">
                  <input
                    type="checkbox"
                    checked={selected.includes(id)}
                    onChange={() => onToggle(id)}
                    className="w-4 h-4 text-primary rounded focus:ring-primary"
                  />
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${group.color.dot}`} />
                  <span className="text-sm truncate">{u.FullName}</span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default UserSearchSelect;
