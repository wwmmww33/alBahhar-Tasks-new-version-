// src/components/TaskLineageSection.tsx
// "المهمة المنبثقة": نسَب/تفرّع بين المهام (أب واحد لكل مهمة) — يختلف عن "المهام المرتبطة"
// (RelatedTasksSection) التي هي ارتباط أفقي تعريفي بين مهمتين قائمتين بلا اتجاه. هنا نعرض المهمة
// الأم (إن وُجدت، مع إمكانية تغييرها أو إزالتها) والمهام المنبثقة مباشرة من هذه المهمة (الأبناء).
import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GitBranch, Search, X, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { getApiUrl } from '../config/api';

type ParentTask = { TaskID: number; Title: string; hasAccess: boolean };
type ChildTask = {
  TaskID: number;
  Title: string;
  Status?: string;
  Priority?: string;
  DueDate?: string;
  hasAccess: boolean;
  CreatedByName?: string | null;
};
type SearchResult = { TaskID: number; Title: string; Description?: string; Status: string };

type Props = {
  taskId: number;
  userId: string;
  isAdmin: boolean;
  parentTask: ParentTask | null;
  deptId?: number | null;
  onParentChanged: () => void;
};

const STATUS_LABELS: Record<string, string> = {
  open: 'مفتوحة',
  'in-progress': 'قيد التنفيذ',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
  external: 'خارجية',
};

const TaskLineageSection = ({ taskId, userId, isAdmin, parentTask, deptId, onParentChanged }: Props) => {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(!!parentTask);
  const [children, setChildren] = useState<ChildTask[]>([]);
  const [isLoadingChildren, setIsLoadingChildren] = useState(true);

  const [showParentSearch, setShowParentSearch] = useState(false);
  const [parentQuery, setParentQuery] = useState('');
  const [parentResults, setParentResults] = useState<SearchResult[]>([]);
  const [isSearchingParent, setIsSearchingParent] = useState(false);
  const [isSavingParent, setIsSavingParent] = useState(false);
  const [parentError, setParentError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchChildren = async () => {
    setIsLoadingChildren(true);
    try {
      const res = await fetch(getApiUrl(`tasks/${taskId}/children?userId=${encodeURIComponent(userId)}&isAdmin=${isAdmin}`));
      if (res.ok) {
        const data = await res.json();
        setChildren(data);
        if (data.length > 0) setIsExpanded(true);
      }
    } catch (_) {
      // silent
    } finally {
      setIsLoadingChildren(false);
    }
  };

  useEffect(() => {
    fetchChildren();
  }, [taskId]);

  const handleParentSearchInput = (val: string) => {
    setParentQuery(val);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (val.trim().length < 2) { setParentResults([]); return; }
    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearchingParent(true);
      try {
        const deptParam = deptId != null ? `&deptId=${deptId}` : '';
        const res = await fetch(getApiUrl(`tasks/search?q=${encodeURIComponent(val.trim())}&userId=${userId}&isAdmin=${isAdmin}&excludeTaskId=${taskId}${deptParam}`));
        if (res.ok) setParentResults(await res.json());
      } catch (_) {
        setParentResults([]);
      } finally {
        setIsSearchingParent(false);
      }
    }, 300);
  };

  const handleSetParent = async (parentTaskId: number | null) => {
    setIsSavingParent(true);
    setParentError(null);
    try {
      const res = await fetch(getApiUrl(`tasks/${taskId}/parent`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, isAdmin, parentTaskId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || 'فشل تحديد المهمة الأم');
      }
      setShowParentSearch(false);
      setParentQuery('');
      setParentResults([]);
      onParentChanged();
    } catch (e: any) {
      setParentError(e.message);
    } finally {
      setIsSavingParent(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 hover:bg-content/5 cursor-pointer select-none transition-colors"
        onClick={() => setIsExpanded(v => !v)}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-content">
          <GitBranch size={15} className="text-primary" />
          <span>نسَب المهمة</span>
          {children.length > 0 && (
            <span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full">
              {children.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isExpanded && (
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/create-task?parentTaskId=${taskId}`); }}
              className="text-xs text-primary hover:underline flex items-center gap-1"
              title="إنشاء مهمة جديدة منبثقة من هذه المهمة"
            >
              <Plus size={13} />
              مهمة منبثقة
            </button>
          )}
          {isExpanded ? <ChevronUp size={15} className="text-content-secondary" /> : <ChevronDown size={15} className="text-content-secondary" />}
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* المهمة الأم */}
          <div>
            <p className="text-xs font-medium text-content-secondary mb-1.5">المهمة الأم:</p>
            {parentTask ? (
              <div className="flex items-center gap-2 group">
                {parentTask.hasAccess ? (
                  <Link to={`/task/${parentTask.TaskID}`} className="flex-1 text-sm text-primary hover:underline truncate">
                    {parentTask.Title}
                  </Link>
                ) : (
                  <span className="flex-1 text-sm text-content-secondary italic truncate">
                    {parentTask.Title} — لا تملك صلاحية الوصول إليها
                  </span>
                )}
                <button
                  onClick={() => setShowParentSearch(v => !v)}
                  className="text-xs text-primary hover:underline flex-shrink-0"
                >
                  تغيير
                </button>
                <button
                  onClick={() => handleSetParent(null)}
                  disabled={isSavingParent}
                  className="text-content/30 hover:text-red-500 transition-colors flex-shrink-0 disabled:opacity-40"
                  title="إزالة الربط بالمهمة الأم"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-content-secondary italic">لا توجد مهمة أم — مهمة أصلية.</span>
                <button
                  onClick={() => setShowParentSearch(v => !v)}
                  className="text-xs text-primary hover:underline flex-shrink-0"
                >
                  تحديد مهمة أم
                </button>
              </div>
            )}

            {/* لوحة البحث لتحديد/تغيير المهمة الأم */}
            {showParentSearch && (
              <div className="mt-2 p-3 bg-content/5 rounded-md border border-content/10">
                <div className="relative">
                  <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-content-secondary pointer-events-none" />
                  <input
                    type="text"
                    value={parentQuery}
                    onChange={(e) => handleParentSearchInput(e.target.value)}
                    placeholder="ابحث عن المهمة الأم بالاسم..."
                    className="w-full pr-8 pl-3 py-2 text-sm border border-content/20 bg-bkg rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                  />
                </div>
                {isSearchingParent && (
                  <p className="text-xs text-content-secondary mt-2 text-center">جاري البحث...</p>
                )}
                {parentError && (
                  <p className="text-xs text-red-500 mt-2">{parentError}</p>
                )}
                {!isSearchingParent && parentResults.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-52 overflow-y-auto">
                    {parentResults.map(t => (
                      <button
                        key={t.TaskID}
                        onClick={() => handleSetParent(t.TaskID)}
                        disabled={isSavingParent}
                        className="w-full text-right px-3 py-2 text-sm rounded border border-content/10 bg-white dark:bg-gray-800 hover:bg-primary/5 transition-colors disabled:opacity-50"
                      >
                        <span className="block text-content truncate">{t.Title}</span>
                        <span className="block text-xs text-content-secondary">{STATUS_LABELS[t.Status] ?? t.Status}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!isSearchingParent && parentQuery.trim().length >= 2 && parentResults.length === 0 && (
                  <p className="text-xs text-content-secondary mt-2 text-center">لا توجد نتائج.</p>
                )}
              </div>
            )}
          </div>

          {/* المهام المنبثقة (الأبناء) */}
          <div>
            <p className="text-xs font-medium text-content-secondary mb-1.5">المهام المنبثقة من هذه المهمة:</p>
            {isLoadingChildren ? (
              <p className="text-sm text-content-secondary text-center py-2">جاري التحميل...</p>
            ) : children.length === 0 ? (
              <p className="text-sm text-content-secondary italic">لا توجد مهام منبثقة بعد.</p>
            ) : (
              <div className="space-y-2">
                {children.map(c => (
                  <div key={c.TaskID} className="flex items-center gap-2 py-2 border-b border-content/10 last:border-b-0">
                    {c.hasAccess ? (
                      <Link to={`/task/${c.TaskID}`} className="flex-1 text-sm text-primary hover:underline truncate">
                        {c.Title}
                      </Link>
                    ) : (
                      <span className="flex-1 text-sm text-content-secondary italic truncate">
                        {c.Title}
                        {c.CreatedByName ? ` — تواصل مع (${c.CreatedByName}) للوصول إليها` : ''}
                      </span>
                    )}
                    {c.hasAccess && c.Status && (
                      <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0 bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        {STATUS_LABELS[c.Status] ?? c.Status}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskLineageSection;
