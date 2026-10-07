// src/components/MoveToTaskModal.tsx
// نافذة عامة لنقل تعليق أو مهمة فرعية من مهمتها الحالية إلى مهمة أخرى (لمعالجة التسجيل بالخطأ)
import { useState, useRef } from 'react';
import { ArrowRightLeft, Search, X } from 'lucide-react';
import { getApiUrl } from '../config/api';

type SearchResult = {
  TaskID: number;
  Title: string;
  Description: string;
  Status: string;
  DueDate?: string;
};

type Props = {
  itemLabel: string; // مثال: "المهمة الفرعية" أو "التعليق"
  currentTaskId: number;
  currentTaskTitle: string;
  userId: string;
  isAdmin: boolean;
  deptId?: number | null;
  onClose: () => void;
  onMove: (targetTaskId: number) => Promise<void>; // يرمي استثناءً برسالة عند الفشل
};

const STATUS_LABELS: Record<string, string> = {
  open: 'مفتوحة',
  'in-progress': 'قيد التنفيذ',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  external: 'خارجية',
};

const MoveToTaskModal = ({ itemLabel, currentTaskId, currentTaskTitle, userId, isAdmin, deptId, onClose, onMove }: Props) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = (val: string) => {
    setQuery(val);
    setSelected(null);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (val.trim().length < 2) { setResults([]); return; }
    timeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const deptParam = deptId != null ? `&deptId=${deptId}` : '';
        const res = await fetch(
          getApiUrl(`tasks/search?q=${encodeURIComponent(val)}&userId=${userId}&isAdmin=${isAdmin}&excludeTaskId=${currentTaskId}${deptParam}`)
        );
        if (res.ok) setResults(await res.json());
      } finally {
        setIsSearching(false);
      }
    }, 400);
  };

  const handleConfirm = async () => {
    if (!selected) return;
    setIsMoving(true);
    setError(null);
    try {
      await onMove(selected.TaskID);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'فشل النقل');
      setIsMoving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg flex flex-col gap-4 p-6" dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-semibold text-lg">
            <ArrowRightLeft size={20} />
            نقل {itemLabel} إلى مهمة أخرى
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
          <span className="text-gray-400 dark:text-gray-500 text-xs">المهمة الحالية:</span>
          <p className="font-medium text-gray-800 dark:text-gray-100 mt-0.5">#{currentTaskId} — {currentTaskTitle}</p>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
            ابحث عن المهمة التي تريد النقل إليها:
          </label>
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => handleSearch(e.target.value)}
              placeholder="اكتب عنوان المهمة..."
              className="w-full pr-9 pl-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {!selected && (isSearching || results.length > 0) && (
            <div className="mt-1 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
              {isSearching && (
                <p className="text-center text-sm text-gray-400 py-3">جاري البحث...</p>
              )}
              {!isSearching && results.map(r => (
                <button
                  key={r.TaskID}
                  onClick={() => { setSelected(r); setResults([]); }}
                  className="w-full text-right px-4 py-2.5 hover:bg-primary/5 border-b border-gray-100 dark:border-gray-700 last:border-0 flex items-start gap-3"
                >
                  <span className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 shrink-0">#{r.TaskID}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{r.Title}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{STATUS_LABELS[r.Status] ?? r.Status}</p>
                  </div>
                </button>
              ))}
              {!isSearching && results.length === 0 && query.trim().length >= 2 && (
                <p className="text-center text-sm text-gray-400 py-3">لا توجد نتائج</p>
              )}
            </div>
          )}
        </div>

        {selected && (
          <div className="border border-primary/30 rounded-lg p-4 bg-primary/5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-primary font-medium">المهمة الوجهة:</p>
                <p className="font-semibold text-gray-800 dark:text-gray-100 mt-0.5">#{selected.TaskID} — {selected.Title}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0">
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            إلغاء
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selected || isMoving}
            className="px-4 py-2 text-sm rounded-lg bg-primary hover:bg-primary-dark text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
          >
            <ArrowRightLeft size={15} />
            {isMoving ? 'جاري النقل...' : 'نقل'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MoveToTaskModal;
