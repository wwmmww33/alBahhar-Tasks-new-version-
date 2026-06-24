// src/components/RelatedTasksSection.tsx
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Link2, X, Search, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { getApiUrl } from '../config/api';

type RelatedTask = {
  TaskID: number;
  Title: string;
  Description?: string;
  Status: string;
  Priority: string;
  DueDate?: string;
  LinkedAt?: string;
};

type Props = {
  taskId: number;
  userId: string;
  isAdmin: boolean;
  isPersonal?: boolean;
  originalUserId?: string;
  deptId?: number | null;
};

const STATUS_LABELS: Record<string, string> = {
  open: 'مفتوحة',
  'in-progress': 'قيد التنفيذ',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  external: 'خارجية',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'in-progress': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  external: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
};

const RelatedTasksSection = ({ taskId, userId, isAdmin, isPersonal = false, originalUserId, deptId }: Props) => {
  const [relatedTasks, setRelatedTasks] = useState<RelatedTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RelatedTask[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedToAdd, setSelectedToAdd] = useState<Set<number>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRelated = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(getApiUrl(`tasks/${taskId}/related`));
      if (res.ok) setRelatedTasks(await res.json());
    } catch (_) {
      // silent
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRelated();
  }, [taskId]);

  const handleSearchInput = (val: string) => {
    setSearchQuery(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (val.trim().length < 2) { setSearchResults([]); return; }
    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const deptParam = (!isPersonal && deptId != null) ? `&deptId=${deptId}` : '';
        const searchUrl = isPersonal
          ? getApiUrl(`tasks/search?q=${encodeURIComponent(val.trim())}&userId=${userId}&excludeTaskId=${taskId}&personalOnly=true&originalUserId=${encodeURIComponent(originalUserId || userId)}`)
          : getApiUrl(`tasks/search?q=${encodeURIComponent(val.trim())}&userId=${userId}&isAdmin=${isAdmin}&excludeTaskId=${taskId}${deptParam}`);
        const res = await fetch(searchUrl);
        if (res.ok) setSearchResults(await res.json());
      } catch (_) {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const toggleSelect = (id: number) => {
    setSelectedToAdd(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAddSelected = async () => {
    if (selectedToAdd.size === 0) return;
    setIsAdding(true);
    await Promise.allSettled(
      Array.from(selectedToAdd).map(relatedTaskId =>
        fetch(getApiUrl(`tasks/${taskId}/related`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relatedTaskId, userId }),
        })
      )
    );
    setIsAdding(false);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedToAdd(new Set());
    await fetchRelated();
  };

  const handleRemove = async (relatedTaskId: number) => {
    await fetch(getApiUrl(`tasks/${taskId}/related/${relatedTaskId}`), { method: 'DELETE' });
    setRelatedTasks(prev => prev.filter(t => t.TaskID !== relatedTaskId));
  };

  const linkedIds = new Set(relatedTasks.map(t => t.TaskID));
  const filteredResults = searchResults.filter(t => !linkedIds.has(t.TaskID));

  return (
    <div className="mt-6 border border-content/10 rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-content/5 cursor-pointer select-none"
        onClick={() => setIsExpanded(v => !v)}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-content">
          <Link2 size={15} className="text-primary" />
          <span>المهام المرتبطة</span>
          {relatedTasks.length > 0 && (
            <span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full">
              {relatedTasks.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isExpanded && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowSearch(v => !v); setSearchQuery(''); setSearchResults([]); setSelectedToAdd(new Set()); }}
              className="text-xs text-primary hover:underline flex items-center gap-1"
              title="إضافة ارتباط بمهمة أخرى"
            >
              <Plus size={13} />
              إضافة
            </button>
          )}
          {isExpanded ? <ChevronUp size={15} className="text-content-secondary" /> : <ChevronDown size={15} className="text-content-secondary" />}
        </div>
      </div>

      {/* Body */}
      {isExpanded && (
        <div className="p-4">
          {/* Search panel */}
          {showSearch && (
            <div className="mb-4 p-3 bg-content/5 rounded-md border border-content/10">
              <div className="relative">
                <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-content-secondary pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  placeholder="ابحث عن مهمة بالاسم..."
                  className="w-full pr-8 pl-3 py-2 text-sm border border-content/20 bg-bkg rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                />
              </div>

              {isSearching && (
                <p className="text-xs text-content-secondary mt-2 text-center">جاري البحث...</p>
              )}

              {filteredResults.length > 0 && (
                <div className="mt-2">
                  <div className="space-y-1 max-h-52 overflow-y-auto">
                    {filteredResults.map(t => (
                      <label
                        key={t.TaskID}
                        className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors ${
                          selectedToAdd.has(t.TaskID)
                            ? 'border-primary bg-primary/5'
                            : 'border-content/10 bg-white dark:bg-gray-800 hover:bg-content/5'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedToAdd.has(t.TaskID)}
                          onChange={() => toggleSelect(t.TaskID)}
                          className="w-4 h-4 accent-primary flex-shrink-0"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-content truncate">{t.Title}</span>
                          {t.Description?.trim() && (
                            <span className="block text-xs text-content-secondary truncate">
                              {t.Description.trim().slice(0, 80)}{t.Description.trim().length > 80 ? '...' : ''}
                            </span>
                          )}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${STATUS_COLORS[t.Status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[t.Status] || t.Status}
                        </span>
                        <a
                          href={`/task/${t.TaskID}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline flex-shrink-0"
                          title="فتح في تبويب جديد"
                          onClick={(e) => e.stopPropagation()}
                        >
                          ↗
                        </a>
                      </label>
                    ))}
                  </div>
                  {selectedToAdd.size > 0 && (
                    <button
                      onClick={handleAddSelected}
                      disabled={isAdding}
                      className="mt-2 w-full py-1.5 text-sm bg-primary text-white rounded hover:bg-primary/90 disabled:bg-gray-400 transition-colors"
                    >
                      {isAdding ? 'جاري الإضافة...' : `إضافة المحددة (${selectedToAdd.size})`}
                    </button>
                  )}
                </div>
              )}

              {searchQuery.trim().length >= 2 && !isSearching && filteredResults.length === 0 && (
                <p className="text-xs text-content-secondary mt-2 text-center">لا توجد نتائج.</p>
              )}
            </div>
          )}

          {/* List */}
          {isLoading ? (
            <p className="text-sm text-content-secondary text-center py-2">جاري التحميل...</p>
          ) : relatedTasks.length === 0 ? (
            <p className="text-sm text-content-secondary italic text-center py-2">لا توجد مهام مرتبطة.</p>
          ) : (
            <div className="space-y-2">
              {relatedTasks.map(t => (
                <div
                  key={t.TaskID}
                  className="flex items-center gap-2 py-2 border-b border-content/10 last:border-b-0 group"
                >
                  <Link
                    to={`/task/${t.TaskID}`}
                    className="flex-1 text-sm text-primary hover:underline truncate"
                  >
                    {t.Title}
                  </Link>
                  <a
                    href={`/task/${t.TaskID}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary/60 hover:text-primary flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="فتح في تبويب جديد"
                  >
                    ↗
                  </a>
                  <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${STATUS_COLORS[t.Status] || 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABELS[t.Status] || t.Status}
                  </span>
                  <button
                    onClick={() => handleRemove(t.TaskID)}
                    className="text-content/30 hover:text-red-500 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                    title="إزالة الارتباط"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RelatedTasksSection;
