// src/components/CalendarBroadcastSettings.tsx
// إعدادات التقويم والبث العامة على مستوى النظام (المدير العام فقط) — مستخرَجة من إدارة الأقسام
// إلى تبويب مستقل: (١) الحد الأعلى لمستوى بث التقويم الذي يمكن لأي مدير قسم الصعود إليه،
// (٢) تفعيل/تسمية التقويم العام في صفحة الدخول. ضبط بث/تفويض منصب معيّن تحديداً يبقى ضمن إدارة
// الأقسام نفسها (ضمن جدول مناصب كل قسم)، لأنه إجراء سياقي مرتبط بذلك المنصب تحديداً.
import { useCallback, useEffect, useState } from 'react';
import type { CurrentUser } from '../types';
import DepartmentTreeSelect, { type Department } from './DepartmentTreeSelect';

const CalendarBroadcastSettings = ({ currentUser }: { currentUser?: CurrentUser }) => {
  const isSystemAdmin = !!currentUser?.IsAdmin;

  const [departments, setDepartments] = useState<Department[]>([]);

  const fetchDepartments = useCallback(async () => {
    try {
      const res = await fetch('/api/departments');
      const data = await res.json();
      setDepartments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch departments:', error);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  // ---- الحد الأعلى لمستوى بث التقويم (المدير العام للنظام فقط) ----
  const [maxBroadcastSelection, setMaxBroadcastSelection] = useState<string>('');
  const [savingMaxBroadcast, setSavingMaxBroadcast] = useState(false);
  const [maxBroadcastSaved, setMaxBroadcastSaved] = useState(false);

  useEffect(() => {
    if (!isSystemAdmin) return;
    fetch('/api/departments/max-broadcast-level')
      .then(r => r.ok ? r.json() : { DepartmentID: null })
      .then(data => setMaxBroadcastSelection(data.DepartmentID != null ? String(data.DepartmentID) : ''))
      .catch(() => {});
  }, [isSystemAdmin]);

  const handleSaveMaxBroadcast = async () => {
    setSavingMaxBroadcast(true);
    setMaxBroadcastSaved(false);
    try {
      const deptId = maxBroadcastSelection === '' ? null : parseInt(maxBroadcastSelection, 10);
      const res = await fetch('/api/departments/max-broadcast-level', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser?.UserID, isAdmin: !!currentUser?.IsAdmin, DepartmentID: deptId }),
      });
      if (res.ok) {
        setMaxBroadcastSaved(true);
        setTimeout(() => setMaxBroadcastSaved(false), 2500);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || 'تعذّر حفظ الحد الأعلى لمستوى البث');
      }
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء الحفظ');
    } finally {
      setSavingMaxBroadcast(false);
    }
  };

  // ---- التقويم العام في صفحة الدخول (المدير العام للنظام فقط) ----
  const [publicCalendarEnabled, setPublicCalendarEnabled] = useState(false);
  const [publicCalendarTitle, setPublicCalendarTitle] = useState('');
  // القسم الذي "يمثّل" التقويم العام — مستقل تماماً عن "الحد الأعلى لمستوى بث التقويم" أعلاه (ذلك
  // يحدد سقف تصعيد مدير قسم لمستوى البث الداخلي بين الأقسام؛ هذا يحدد من يملك أصلاً صلاحية تفعيل
  // "بث مفتوح" لعنصر على التقويم العام). فارغ = بلا قيد (أي مدير قسم مستقل، السلوك الحالي).
  const [publicCalendarOwnerDeptId, setPublicCalendarOwnerDeptId] = useState<string>('');
  const [savingPublicCalendar, setSavingPublicCalendar] = useState(false);
  const [publicCalendarSaved, setPublicCalendarSaved] = useState(false);

  useEffect(() => {
    if (!isSystemAdmin || !currentUser?.UserID) return;
    fetch(`/api/departments/public-calendar-settings?userId=${encodeURIComponent(currentUser.UserID)}`)
      .then(r => r.ok ? r.json() : { enabled: false, title: '', ownerDepartmentId: null })
      .then(data => {
        setPublicCalendarEnabled(!!data.enabled);
        setPublicCalendarTitle(data.title || '');
        setPublicCalendarOwnerDeptId(data.ownerDepartmentId != null ? String(data.ownerDepartmentId) : '');
      })
      .catch(() => {});
  }, [isSystemAdmin, currentUser?.UserID]);

  const handleSavePublicCalendar = async () => {
    setSavingPublicCalendar(true);
    setPublicCalendarSaved(false);
    try {
      const ownerDepartmentId = publicCalendarOwnerDeptId === '' ? null : parseInt(publicCalendarOwnerDeptId, 10);
      const res = await fetch('/api/departments/public-calendar-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser?.UserID, enabled: publicCalendarEnabled, title: publicCalendarTitle, ownerDepartmentId }),
      });
      if (res.ok) {
        const data = await res.json();
        setPublicCalendarTitle(data.title || '');
        setPublicCalendarOwnerDeptId(data.ownerDepartmentId != null ? String(data.ownerDepartmentId) : '');
        setPublicCalendarSaved(true);
        setTimeout(() => setPublicCalendarSaved(false), 2500);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || 'تعذّر حفظ إعدادات التقويم العام');
      }
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء الحفظ');
    } finally {
      setSavingPublicCalendar(false);
    }
  };

  if (!isSystemAdmin) {
    return (
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow text-sm text-gray-500 dark:text-gray-400">
        هذه الإعدادات متاحة للمدير العام للنظام فقط.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-2">الحد الأعلى لمستوى بث التقويم</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          يحدد أعلى مستوى (أكثر عمومية) يمكن لأي مدير قسم اختياره عند ضبط مستوى بث مهمة في التقويم. اتركه فارغاً للسماح بالصعود حتى ما قبل جذر النظام مباشرة.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <DepartmentTreeSelect
              departments={departments}
              value={maxBroadcastSelection === '' ? null : parseInt(maxBroadcastSelection, 10)}
              onChange={(id) => { setMaxBroadcastSelection(id == null ? '' : String(id)); setMaxBroadcastSaved(false); }}
              noneLabel="بدون حد — حتى ما قبل جذر النظام (الافتراضي)"
            />
          </div>
          <button
            type="button"
            disabled={savingMaxBroadcast}
            onClick={handleSaveMaxBroadcast}
            className={`px-4 py-2 rounded-md text-sm disabled:opacity-50 transition-colors ${
              maxBroadcastSaved
                ? 'border border-green-500 text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400'
                : 'bg-primary text-white hover:bg-primary-dark'
            }`}
          >
            {savingMaxBroadcast ? 'جارٍ الحفظ...' : maxBroadcastSaved ? '✓ تم الحفظ' : 'حفظ'}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-2">التقويم العام في صفحة الدخول</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          يعرض الأحداث التي حدَّدها مديرو الأقسام كـ"بث مفتوح" لأي زائر لصفحة الدخول دون الحاجة لتسجيل الدخول، بلا كشف اسم المُسنَد إليه.
        </p>
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={publicCalendarEnabled}
              onChange={(e) => { setPublicCalendarEnabled(e.target.checked); setPublicCalendarSaved(false); }}
              className="w-4 h-4"
            />
            <span className="text-sm">إظهار التقويم العام في صفحة الدخول</span>
          </label>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">عنوان التقويم العام</label>
            <input
              type="text"
              value={publicCalendarTitle}
              onChange={(e) => { setPublicCalendarTitle(e.target.value); setPublicCalendarSaved(false); }}
              placeholder="التقويم العام"
              className="w-full max-w-sm p-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
            />
          </div>
          <div className="pt-2 border-t dark:border-gray-700">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">القسم الذي يمثّل التقويم العام</label>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              عند تحديد قسم، يصبح تفعيل "بث مفتوح" على مهمة فرعية أو تعليق متاحاً فقط لمدير هذا القسم (أو القسم المستقل التابع له ضمن نفس المجموعة المستقلة) — بخلاف "الحد الأعلى لمستوى بث التقويم" أعلاه الذي يحدد سقف الصعود بين الأقسام لأي مدير. إلغاء البث المفتوح يبقى متاحاً دوماً لمن يملك صلاحيته الحالية بلا قيد.
            </p>
            <div className="max-w-sm">
              <DepartmentTreeSelect
                departments={departments}
                value={publicCalendarOwnerDeptId === '' ? null : parseInt(publicCalendarOwnerDeptId, 10)}
                onChange={(id) => { setPublicCalendarOwnerDeptId(id == null ? '' : String(id)); setPublicCalendarSaved(false); }}
                noneLabel="بلا تقييد — أي مدير قسم مستقل (الافتراضي)"
              />
            </div>
          </div>
          <button
            type="button"
            disabled={savingPublicCalendar}
            onClick={handleSavePublicCalendar}
            className={`px-4 py-2 rounded-md text-sm disabled:opacity-50 transition-colors ${
              publicCalendarSaved
                ? 'border border-green-500 text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400'
                : 'bg-primary text-white hover:bg-primary-dark'
            }`}
          >
            {savingPublicCalendar ? 'جارٍ الحفظ...' : publicCalendarSaved ? '✓ تم الحفظ' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CalendarBroadcastSettings;
