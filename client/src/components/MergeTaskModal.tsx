// src/components/MergeTaskModal.tsx
import { useState, useRef } from 'react';
import { GitMerge, Search, X, AlertTriangle, Check } from 'lucide-react';
import { getApiUrl } from '../config/api';

type SearchResult = {
  TaskID: number;
  Title: string;
  Description: string;
  Status: string;
  Priority: string;
  DueDate?: string;
};

type Props = {
  targetTaskId: number;
  targetTaskTitle: string;
  userId: string;
  isAdmin: boolean;
  deptId?: number | null;
  onClose: () => void;
  onMerged: () => void;
};

const STATUS_LABELS: Record<string, string> = {
  open: 'مفتوحة',
  'in-progress': 'قيد التنفيذ',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  external: 'خارجية',
};

const MergeTaskModal = ({ targetTaskId, targetTaskTitle, userId, isAdmin, deptId, onClose, onMerged }: Props) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = (val: string) => {
    setQuery(val);
    setSelected(null);
    setConfirmed(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (val.trim().length < 2) { setResults([]); return; }
    timeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const deptParam = deptId != null ? `&deptId=${deptId}` : '';
        const res = await fetch(
          getApiUrl(`tasks/search?q=${encodeURIComponent(val)}&userId=${userId}&isAdmin=${isAdmin}&excludeTaskId=${targetTaskId}${deptParam}`)
        );
        if (res.ok) setResults(await res.json());
      } finally {
        setIsSearching(false);
      }
    }, 400);
  };

  const handleMerge = async () => {
    if (!selected) return;
    setIsMerging(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`tasks/${targetTaskId}/merge`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTaskId: selected.TaskID, userId, isAdmin }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || 'فشل الدمج');
      }
      onMerged();
    } catch (e: any) {
      setError(e.message);
      setIsMerging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg flex flex-col gap-4 p-6" dir="rtl">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-semibold text-lg">
            <GitMerge size={20} />
            دمج مهمة
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        {/* Target info */}
        <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
          <span className="text-gray-400 dark:text-gray-500 text-xs">المهمة الهدف (أ):</span>
          <p className="font-medium text-gray-800 dark:text-gray-100 mt-0.5">#{targetTaskId} — {targetTaskTitle}</p>
        </div>

        {/* Search */}
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
            ابحث عن المهمة المصدر (ب) لدمجها:
          </label>
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={e => handleSearch(e.target.value)}
              placeholder="اكتب عنوان المهمة..."
              className="w-full pr-9 pl-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>

          {/* Results */}
          {!selected && (isSearching || results.length > 0) && (
            <div className="mt-1 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
              {isSearching && (
                <p className="text-center text-sm text-gray-400 py-3">جاري البحث...</p>
              )}
              {!isSearching && results.map(r => (
                <button
                  key={r.TaskID}
                  onClick={() => { setSelected(r); setResults([]); setConfirmed(false); }}
                  className="w-full text-right px-4 py-2.5 hover:bg-purple-50 dark:hover:bg-purple-900/20 border-b border-gray-100 dark:border-gray-700 last:border-0 flex items-start gap-3"
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

        {/* Selected task preview */}
        {selected && (
          <div className="border border-purple-200 dark:border-purple-700 rounded-lg p-4 bg-purple-50/50 dark:bg-purple-900/10">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <p className="text-xs text-purple-500 dark:text-purple-400 font-medium">المهمة المصدر (ب):</p>
                <p className="font-semibold text-gray-800 dark:text-gray-100 mt-0.5">#{selected.TaskID} — {selected.Title}</p>
              </div>
              <button
                onClick={() => { setSelected(null); setConfirmed(false); }}
                className="text-gray-400 hover:text-gray-600 shrink-0"
              >
                <X size={16} />
              </button>
            </div>
            {selected.Description && (
              <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{selected.Description}</p>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{STATUS_LABELS[selected.Status] ?? selected.Status}</p>
          </div>
        )}

        {/* Warning */}
        {selected && (
          <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3">
            <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              ستُنقل جميع المهام الفرعية والتعليقات من المهمة (ب) إلى المهمة (أ) مع إضافة
              {' '}<span className="font-mono font-bold">(مدمجة #{selected.TaskID})</span>{' '}
              لكل منها. وسيتم إغلاق المهمة (ب) تلقائياً. هذا الإجراء لا يمكن التراجع عنه.
            </p>
          </div>
        )}

        {/* Confirm checkbox */}
        {selected && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setConfirmed(p => !p)}
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${
                confirmed
                  ? 'bg-purple-600 border-purple-600'
                  : 'border-gray-400 dark:border-gray-500'
              }`}
            >
              {confirmed && <Check size={12} className="text-white" />}
            </div>
            <span className="text-sm text-gray-700 dark:text-gray-300">أفهم أن هذا الإجراء لا يمكن التراجع عنه</span>
          </label>
        )}

        {error && (
          <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            إلغاء
          </button>
          <button
            onClick={handleMerge}
            disabled={!selected || !confirmed || isMerging}
            className="px-4 py-2 text-sm rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
          >
            <GitMerge size={15} />
            {isMerging ? 'جاري الدمج...' : 'دمج المهمتين'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MergeTaskModal;
