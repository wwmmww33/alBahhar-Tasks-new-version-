// src/components/ShareItemModal.tsx
// يحدد منشئ المهمة الفرعية/التعليق الجهات المستقلة التي يراها هذا العنصر تحديداً — ضمن القنوات
// المفتوحة على مستوى المهمة فقط (يفتحها مدير القسم). قابل للتعديل في أي وقت.
import { useEffect, useState } from 'react';
import { Share2, X } from 'lucide-react';
import { getApiUrl } from '../config/api';

type ShareRow = { SharedWithDepartmentID: number; DepartmentName: string | null };

type Props = {
  kind: 'subtask' | 'comment';
  itemId: number;
  taskId: number;
  userId: string;
  isAdmin: boolean;
  currentSharedDepartmentIds: number[];
  onClose: () => void;
  onSaved: () => void;
};

const ShareItemModal = ({ kind, itemId, taskId, userId, isAdmin, currentSharedDepartmentIds, onClose, onSaved }: Props) => {
  const [channels, setChannels] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set(currentSharedDepartmentIds));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(getApiUrl(`tasks/${taskId}/share-options?userId=${encodeURIComponent(userId)}`))
      .then(r => r.ok ? r.json() : [])
      .then(setChannels)
      .finally(() => setLoading(false));
  }, [taskId, userId]);

  const toggle = (deptId: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(deptId)) next.delete(deptId); else next.add(deptId);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const endpoint = kind === 'subtask'
        ? `subtasks/${itemId}/department-shares`
        : `comments/${itemId}/department-shares`;
      const body = kind === 'subtask'
        ? { UserID: userId, isAdmin, DepartmentIDs: Array.from(selected) }
        : { UserID: userId, isAdmin, DepartmentIDs: Array.from(selected) };
      const res = await fetch(getApiUrl(endpoint), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'تعذّر حفظ المشاركة');
        return;
      }
      onSaved();
    } catch (_) {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm flex flex-col gap-4 p-5" dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-semibold">
            <Share2 size={18} />
            مشاركة {kind === 'subtask' ? 'المهمة الفرعية' : 'التعليق'}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X size={18} />
          </button>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-md p-2">{error}</p>}

        {loading ? (
          <p className="text-sm text-gray-400">جاري التحميل...</p>
        ) : channels.length === 0 ? (
          <p className="text-sm text-gray-400">لا توجد قنوات مشاركة مفتوحة على هذه المهمة بعد. يفتحها مدير القسم أولاً.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">اختر الجهات التي ترى هذا العنصر:</p>
            {channels.map(c => (
              <label key={c.SharedWithDepartmentID} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(c.SharedWithDepartmentID)}
                  onChange={() => toggle(c.SharedWithDepartmentID)}
                  className="w-4 h-4"
                />
                {c.DepartmentName || `#${c.SharedWithDepartmentID}`}
              </label>
            ))}
          </div>
        )}

        {channels.length > 0 && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-primary text-white py-2 rounded-md hover:bg-primary-dark disabled:opacity-50"
          >
            {saving ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        )}
      </div>
    </div>
  );
};

export default ShareItemModal;
