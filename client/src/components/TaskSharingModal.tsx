// src/components/TaskSharingModal.tsx
// إدارة تبادل المهمة بين المديريات المستقلة: فتح/إغلاق قنوات المشاركة، ومستوى بث التقويم
// الافتراضي للمهمة. متاح فقط لمدير القسم المستقل المالك للمهمة أو المفوَّض له (يتحقق منه السيرفر).
import { useEffect, useState } from 'react';
import { Share2, X, Trash2, CalendarClock } from 'lucide-react';
import { getApiUrl } from '../config/api';

type ShareRow = {
  SharedWithDepartmentID: number;
  DepartmentName: string | null;
  SharedByUserID: string;
  CreatedAt: string;
};
type DepartmentOption = { DepartmentID: number; Name: string };
type AncestorEntry = { DepartmentID: number; Name: string };

type Props = {
  taskId: number;
  taskDepartmentId: number;
  taskBroadcastDepartmentId?: number | null;
  userId: string;
  isAdmin: boolean;
  onClose: () => void;
  onBroadcastLevelChanged?: (deptId: number | null) => void;
};

const TaskSharingModal = ({ taskId, taskDepartmentId, taskBroadcastDepartmentId, userId, isAdmin, onClose, onBroadcastLevelChanged }: Props) => {
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loadingShares, setLoadingShares] = useState(true);
  const [allDepartments, setAllDepartments] = useState<DepartmentOption[]>([]);
  const [deptQuery, setDeptQuery] = useState('');
  const [selectedNewDept, setSelectedNewDept] = useState<DepartmentOption | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ancestorChain, setAncestorChain] = useState<AncestorEntry[]>([]);
  const [broadcastDeptId, setBroadcastDeptId] = useState<number | null>(taskBroadcastDepartmentId ?? taskDepartmentId);
  const [savingBroadcast, setSavingBroadcast] = useState(false);
  const [broadcastSaved, setBroadcastSaved] = useState(false);

  const fetchShares = async () => {
    setLoadingShares(true);
    try {
      const res = await fetch(getApiUrl(`tasks/${taskId}/shares`));
      if (res.ok) setShares(await res.json());
    } finally {
      setLoadingShares(false);
    }
  };

  useEffect(() => {
    fetchShares();
    fetch(getApiUrl('departments')).then(r => r.ok ? r.json() : []).then(setAllDepartments).catch(() => {});
    fetch(getApiUrl(`departments/${taskDepartmentId}/ancestor-chain?userId=${encodeURIComponent(userId)}`)).then(r => r.ok ? r.json() : []).then(setAncestorChain).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, taskDepartmentId]);

  const filteredDeptOptions = deptQuery.trim().length < 2 ? [] : allDepartments
    .filter(d => d.Name?.toLowerCase().includes(deptQuery.trim().toLowerCase()))
    .filter(d => !shares.some(s => s.SharedWithDepartmentID === d.DepartmentID))
    .slice(0, 15);

  const handleOpenChannel = async () => {
    if (!selectedNewDept) return;
    setOpening(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`tasks/${taskId}/shares`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, isAdmin, DepartmentID: selectedNewDept.DepartmentID }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'تعذّر فتح القناة');
        return;
      }
      setSelectedNewDept(null);
      setDeptQuery('');
      await fetchShares();
    } catch (_) {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setOpening(false);
    }
  };

  const handleCloseChannel = async (departmentId: number) => {
    if (!window.confirm('سيُغلق هذا قناة المشاركة — لن يرى هذا القسم أي عناصر جديدة من المهمة بعد الآن. هل أنت متأكد؟')) return;
    try {
      const res = await fetch(getApiUrl(`tasks/${taskId}/shares/${departmentId}?userId=${encodeURIComponent(userId)}&isAdmin=${isAdmin}`), {
        method: 'DELETE',
      });
      if (res.ok) await fetchShares();
    } catch (_) {}
  };

  const handleSaveBroadcastLevel = async () => {
    setSavingBroadcast(true);
    setBroadcastSaved(false);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`tasks/${taskId}/broadcast-level`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, isAdmin, DepartmentID: broadcastDeptId }),
      });
      if (res.ok) {
        onBroadcastLevelChanged?.(broadcastDeptId);
        setBroadcastSaved(true);
        setTimeout(() => setBroadcastSaved(false), 2500);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'تعذّر تحديث مستوى البث');
      }
    } catch (_) {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setSavingBroadcast(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg flex flex-col gap-5 p-6 max-h-[85vh] overflow-y-auto" dir="rtl">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-semibold text-lg">
            <Share2 size={20} />
            مشاركة المهمة بين المديريات
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={20} />
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-md p-2">{error}</p>
        )}

        {/* القنوات المفتوحة */}
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
            المديريات المستقلة المفتوحة للمشاركة:
          </label>
          {loadingShares ? (
            <p className="text-xs text-gray-400">جاري التحميل...</p>
          ) : shares.length === 0 ? (
            <p className="text-xs text-gray-400">لا توجد قنوات مفتوحة حالياً.</p>
          ) : (
            <div className="space-y-1.5">
              {shares.map(s => (
                <div key={s.SharedWithDepartmentID} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-md px-3 py-2 text-sm">
                  <span className="text-gray-800 dark:text-gray-100">{s.DepartmentName || `#${s.SharedWithDepartmentID}`}</span>
                  <button onClick={() => handleCloseChannel(s.SharedWithDepartmentID)} className="text-red-500 hover:text-red-700" title="إغلاق القناة">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* فتح قناة جديدة */}
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">
            فتح قناة مشاركة جديدة مع مديرية مستقلة أخرى:
          </label>
          <input
            type="text"
            value={selectedNewDept ? selectedNewDept.Name : deptQuery}
            onChange={e => { setDeptQuery(e.target.value); setSelectedNewDept(null); }}
            placeholder="اكتب اسم القسم..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {!selectedNewDept && filteredDeptOptions.length > 0 && (
            <div className="mt-1 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
              {filteredDeptOptions.map(d => (
                <button
                  key={d.DepartmentID}
                  onClick={() => { setSelectedNewDept(d); setDeptQuery(''); }}
                  className="w-full text-right px-3 py-2 hover:bg-primary/10 text-sm border-b border-gray-100 dark:border-gray-700 last:border-0"
                >
                  {d.Name}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={!selectedNewDept || opening}
            onClick={handleOpenChannel}
            className="mt-2 w-full bg-primary text-white py-2 rounded-md hover:bg-primary-dark disabled:opacity-50"
          >
            {opening ? 'جارٍ الفتح...' : 'فتح القناة'}
          </button>
        </div>

        {/* مستوى بث التقويم */}
        {ancestorChain.length > 1 && (
          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1.5">
              <CalendarClock size={15} />
              مستوى بث التقويم الافتراضي لهذه المهمة:
            </label>
            <select
              value={broadcastDeptId ?? ''}
              onChange={e => { setBroadcastDeptId(parseInt(e.target.value, 10)); setBroadcastSaved(false); }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
            >
              {ancestorChain.map((d, idx) => (
                <option key={d.DepartmentID} value={d.DepartmentID}>
                  {idx === 0 ? `قسمها (${d.Name})` : d.Name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={savingBroadcast}
              onClick={handleSaveBroadcastLevel}
              className={`mt-2 w-full py-2 rounded-md disabled:opacity-50 transition-colors ${
                broadcastSaved
                  ? 'border border-green-500 text-green-600 bg-green-50 dark:bg-green-900/20'
                  : 'border border-primary text-primary hover:bg-primary/5'
              }`}
            >
              {savingBroadcast ? 'جارٍ الحفظ...' : broadcastSaved ? '✓ تم الحفظ بنجاح' : 'حفظ مستوى البث'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskSharingModal;
