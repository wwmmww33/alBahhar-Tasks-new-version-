// src/pages/CreateTask.tsx
import React, { useState, useEffect } from 'react';
import { readClipboard } from '../utils/clipboard';
import { useNavigate } from 'react-router-dom';
import type { CurrentUser } from '../types';
import { getActiveUserId, getActiveAccount } from '../utils/activeAccount';
import { resolveCurrentActorId } from '../utils/actorIdentity';
import { getApiUrl } from '../config/api';

const AUTO_DETECT_KEY = 'autoDetectRelatedTasks';

type SuggestedTask = {
  TaskID: number;
  Title: string;
  Description?: string;
  Status: string;
};

// تعريف أنواع البيانات التي سنستخدمها
type Procedure = {
  ProcedureID: number;
  Title: string;
};
type ProcedureSubtask = {
  Title: string;
  DueDateOffset: number;
};
type Category = {
  CategoryID: number;
  Name: string;
  Description: string;
  DepartmentID: number;
};

// تعريف الـ Props بشكل صحيح
type CreateTaskProps = {
  currentUser: CurrentUser;
};

const CreateTask = ({ currentUser }: CreateTaskProps) => {
  const navigate = useNavigate();
  const actorId = getActiveUserId(resolveCurrentActorId(currentUser) || currentUser.UserID);
  // في وضع التفويض: actorId = معرّف المفوِّض (المالك الحقيقي للمهمة)
  // ActedBy يجب أن يحمل معرّف المفوَّض له (currentUser هو User B المسجَّل فعلياً)
  const _activeAccount = getActiveAccount();
  const _isDelegationMode = _activeAccount?.mode === 'delegation';
  // نُرسل VacancyID المفوَّض له إن وُجد، وإلا UserID — الخادم يحتاج لمطابقة التفويض
  const delegateUserId = _isDelegationMode
    ? (resolveCurrentActorId(currentUser) || String(currentUser.UserID || '').trim())
    : null;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [taskUrl, setTaskUrl] = useState('');
  
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [selectedProcedure, setSelectedProcedure] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPersonal, setIsPersonal] = useState(false);
  const [autoDetect, setAutoDetect] = useState<boolean>(() => {
    try { return localStorage.getItem(AUTO_DETECT_KEY) !== 'false'; } catch { return true; }
  });
  const [suggestions, setSuggestions] = useState<SuggestedTask[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [pendingTaskId, setPendingTaskId] = useState<number | null>(null);
  const [isLinking, setIsLinking] = useState(false);

  // جلب قائمة المهام الافتراضية والتصنيفات عند تحميل الصفحة
  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser) return;
      try {
        // جلب المهام الافتراضية
        const proceduresResponse = await fetch(`/api/procedures?userId=${actorId}&departmentId=${currentUser.DepartmentID}`);
        if (proceduresResponse.ok) {
          const proceduresData = await proceduresResponse.json();
          setProcedures(proceduresData);
        }
        
        // جلب التصنيفات
        if (currentUser.DepartmentID) {
          const categoriesResponse = await fetch(getApiUrl(`categories/department/${currentUser.DepartmentID}`));
          if (categoriesResponse.ok) {
            const categoriesData = await categoriesResponse.json();
            setCategories(categoriesData.Categories || categoriesData);
          }
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };
    fetchData();
  }, [actorId, currentUser, currentUser.DepartmentID]);

  // دالة يتم استدعاؤها عند تغيير المهمة الافتراضية المختارة
  const handleProcedureChange = async (procedureId: string) => {
    setSelectedProcedure(procedureId);
    if (!procedureId) {
      setSubtasks([]);
      return;
    }
    try {
      const response = await fetch(`/api/procedures/${procedureId}/subtasks`);
      if (!response.ok) throw new Error('Failed to fetch subtasks for procedure');
      const data: ProcedureSubtask[] = await response.json();
      setSubtasks(data.map(st => st.Title));
    } catch (error) {
      console.error("Error fetching procedure subtasks:", error);
    }
  };


const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (isSubmitting) return;

  // --- تحقق مهم هنا ---
  if (!isPersonal && (!currentUser || currentUser.DepartmentID === null)) {
      setMessage({ type: 'error', text: 'لا يمكن إنشاء مهمة بدون قسم. يرجى التأكد من أن حسابك مرتبط بقسم.' });
      return;
  }

  setIsSubmitting(true);
  setMessage(null);

  const actingUserId = actorId;
  const newTaskPayload = {
    Title: title,
    Description: description,
    DueDate: new Date().toISOString(),
    ...(isPersonal ? {} : { DepartmentID: currentUser.DepartmentID }),
    IsPersonal: isPersonal,
    PersonalOwnerUserID: isPersonal ? String(currentUser.UserID) : null,
    Priority: 'normal',
    Status: 'open',
    AssignedTo: actingUserId,
    subtasks: subtasks,
    CreatedBy: actingUserId,
    ActedBy: _isDelegationMode ? delegateUserId : actingUserId,
    CategoryID: !isPersonal && selectedCategory ? parseInt(selectedCategory) : null,
    URL: taskUrl.trim() || null,
  };

  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTaskPayload),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || 'فشل في إنشاء المهمة.');
    }
    const newId: number = result.newTaskId;

    if (autoDetect && title.trim().length >= 3) {
      try {
        const keyword = title.trim().split(/\s+/).filter(w => w.length > 2)[0] || title.trim();
        // المهام الشخصية: ابحث في المهام الشخصية الخاصة بالمستخدم فقط
        const deptParam = (!isPersonal && currentUser.DepartmentID != null) ? `&deptId=${currentUser.DepartmentID}` : '';
        const searchUrl = isPersonal
          ? getApiUrl(`tasks/search?q=${encodeURIComponent(keyword)}&userId=${actingUserId}&excludeTaskId=${newId}&personalOnly=true&originalUserId=${encodeURIComponent(String(currentUser.UserID))}`)
          : getApiUrl(`tasks/search?q=${encodeURIComponent(keyword)}&userId=${actingUserId}&isAdmin=${currentUser.IsAdmin}&excludeTaskId=${newId}${deptParam}`);
        const searchRes = await fetch(searchUrl);
        if (searchRes.ok) {
          const found: SuggestedTask[] = await searchRes.json();
          if (found.length > 0) {
            setSuggestions(found.slice(0, 10));
            setPendingTaskId(newId);
            return;
          }
        }
      } catch (_) {}
    }
    navigate(`/task/${newId}`);
  } catch (error: any) {
    setMessage({ type: 'error', text: error.message });
  } finally {
    setIsSubmitting(false);
  }
};

  const handleAutoDetectToggle = (val: boolean) => {
    setAutoDetect(val);
    try { localStorage.setItem(AUTO_DETECT_KEY, String(val)); } catch (_) {}
  };

  const handleConfirmLinks = async () => {
    if (!pendingTaskId) return;
    if (selectedSuggestions.size > 0) {
      setIsLinking(true);
      const actingUserId = actorId;
      await Promise.allSettled(
        Array.from(selectedSuggestions).map(relId =>
          fetch(getApiUrl(`tasks/${pendingTaskId}/related`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relatedTaskId: relId, userId: actingUserId }),
          })
        )
      );
      setIsLinking(false);
    }
    navigate(`/task/${pendingTaskId}`);
  };

  const toggleSuggestion = (id: number) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const STATUS_LABELS: Record<string, string> = {
    open: 'مفتوحة', 'in-progress': 'قيد التنفيذ',
    completed: 'مكتملة', cancelled: 'ملغاة', external: 'خارجية',
  };

  return (
    <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 p-8 rounded-lg shadow">
      <h1 className="text-3xl font-bold text-content mb-6">إنشاء مهمة جديدة</h1>
      
      <form onSubmit={handleSubmit} className="space-y-6">

        {/* خيار المهمة الشخصية — لا يظهر في وضع التفويض */}
        {!_isDelegationMode && (
          <div className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer select-none transition-colors ${
            isPersonal
              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
              : 'border-content/10 bg-white dark:bg-gray-700/30 hover:border-content/30'
          }`}
            onClick={() => setIsPersonal(v => !v)}
          >
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
              isPersonal ? 'border-emerald-500 bg-emerald-500' : 'border-content/30'
            }`}>
              {isPersonal && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
            </div>
            <div>
              <div className="text-sm font-semibold text-content">مهمة شخصية خاصة</div>
              <div className="text-xs text-content-secondary">مرتبطة بك شخصياً — لا تظهر لأحد غيرك ولا تنتمي لأي قسم</div>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="title" className="block text-sm font-medium text-content-secondary">عنوان المهمة</label>
          <input type="text" id="title" value={title} onChange={(e) => setTitle(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-content/20 bg-bkg rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"/>
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-content-secondary">الوصف</label>
          <textarea id="description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-content/20 bg-bkg rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"/>
        </div>

        {!isPersonal && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="procedure" className="block text-sm font-medium text-content-secondary">اختيار مهمة افتراضية (اختياري)</label>
              <select id="procedure" value={selectedProcedure} onChange={(e) => handleProcedureChange(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-content/20 bg-bkg rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">-- اختر مهمة افتراضية --</option>
                {procedures.map(proc => (
                  <option key={proc.ProcedureID} value={proc.ProcedureID}>{proc.Title}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="category" className="block text-sm font-medium text-content-secondary">التصنيف (اختياري)</label>
              <select id="category" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-content/20 bg-bkg rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">بدون تصنيف</option>
                {categories.map(category => (
                  <option key={category.CategoryID} value={category.CategoryID}>{category.Name}</option>
                ))}
              </select>
            </div>
          </div>
        )}


        <div>
          <label htmlFor="taskUrl" className="block text-sm font-medium text-content-secondary">الرابط الخارجي (اختياري)</label>
          <div className="mt-1 flex gap-2">
            <input
              type="url"
              id="taskUrl"
              value={taskUrl}
              onChange={(e) => setTaskUrl(e.target.value)}
              placeholder="https://example.com/path"
              className="flex-1 px-3 py-2 border border-content/20 bg-bkg rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  const text = await readClipboard();
                  if (text.trim()) setTaskUrl(text.trim());
                } catch {}
              }}
              className="px-3 py-2 text-sm border border-content/20 bg-bkg rounded-md hover:bg-content/10 text-content-secondary whitespace-nowrap"
            >
              لصق الرابط
            </button>
          </div>
        </div>

        {subtasks.length > 0 && (
          <div>
            <h3 className="text-lg font-medium text-content mb-2">المهام الفرعية المقترحة</h3>
            <div className="space-y-2">
              {subtasks.map((subtask, index) => (
                <div key={index} className="flex items-center gap-2 p-2 bg-content/5 rounded">
                  <input type="text" value={subtask} readOnly className="flex-grow bg-transparent focus:outline-none text-content-secondary" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* خيار الاكتشاف التلقائي للمهام المرتبطة */}
        <div className="flex items-center gap-3 p-3 bg-content/5 rounded-md border border-content/10">
          <input
            type="checkbox"
            id="autoDetect"
            checked={autoDetect}
            onChange={(e) => handleAutoDetectToggle(e.target.checked)}
            className="w-4 h-4 accent-primary cursor-pointer"
          />
          <label htmlFor="autoDetect" className="text-sm text-content cursor-pointer select-none">
            اقتراح مهام مرتبطة تلقائياً عند الإنشاء
            <span className="text-xs text-content-secondary mr-2">(يبحث في المهام الموجودة بناءً على عنوان المهمة)</span>
          </label>
        </div>

        <button type="submit" disabled={isSubmitting} className="w-full bg-primary text-white py-2 px-4 rounded-md hover:bg-primary-dark disabled:bg-gray-400 transition-colors">
          {isSubmitting ? 'جاري الإنشاء...' : 'إنشاء المهمة'}
        </button>
      </form>
      {message && <div className={`mt-4 p-4 rounded-md text-sm ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{message.text}</div>}

      {/* نافذة اقتراح المهام المرتبطة */}
      {pendingTaskId && suggestions.length > 0 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" dir="rtl">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl">
            <h2 className="text-lg font-bold text-content mb-1">مهام مرتبطة مقترحة</h2>
            <p className="text-sm text-content-secondary mb-4">
              وجد النظام مهاماً قد تكون مرتبطة بـ "<span className="font-medium text-content">{title}</span>".<br />
              اختر المهام التي تريد ربطها ثم اضغط إنشاء، أو اضغط إلغاء للعودة إلى نموذج الإنشاء.
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto mb-5">
              {suggestions.map(t => (
                <div
                  key={t.TaskID}
                  className={`flex items-center gap-3 p-2 rounded-md border transition-colors ${
                    selectedSuggestions.has(t.TaskID)
                      ? 'border-primary bg-primary/5'
                      : 'border-content/10 bg-content/5'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedSuggestions.has(t.TaskID)}
                    onChange={() => toggleSuggestion(t.TaskID)}
                    className="w-4 h-4 accent-primary flex-shrink-0 cursor-pointer"
                  />
                  <span
                    className="flex-1 min-w-0 cursor-pointer select-none"
                    onClick={() => toggleSuggestion(t.TaskID)}
                  >
                    <span className="block text-sm text-content truncate">{t.Title}</span>
                    {t.Description?.trim() && (
                      <span className="block text-xs text-content-secondary truncate">
                        {t.Description.trim().slice(0, 80)}{t.Description.trim().length > 80 ? '...' : ''}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-content-secondary flex-shrink-0">
                    {STATUS_LABELS[t.Status] || t.Status}
                  </span>
                  <a
                    href={`/task/${t.TaskID}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline flex-shrink-0"
                    title="فتح المهمة في تبويب جديد"
                    onClick={(e) => e.stopPropagation()}
                  >
                    عرض ↗
                  </a>
                </div>
              ))}
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setPendingTaskId(null);
                  setSuggestions([]);
                  setSelectedSuggestions(new Set());
                }}
                disabled={isLinking}
                className="px-4 py-2 text-sm text-content bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={handleConfirmLinks}
                disabled={isLinking}
                className="px-4 py-2 text-sm bg-primary text-white rounded hover:bg-primary/90 disabled:bg-gray-400 transition-colors"
              >
                {isLinking ? 'جاري الإنشاء...' : 'إنشاء'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreateTask;