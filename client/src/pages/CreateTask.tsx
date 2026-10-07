// src/pages/CreateTask.tsx
import React, { useState, useEffect } from 'react';
import { readClipboard } from '../utils/clipboard';
import { useNavigate } from 'react-router-dom';
import type { CurrentUser } from '../types';
import { getActiveUserId, getActiveAccount } from '../utils/activeAccount';
import { resolveCurrentActorId } from '../utils/actorIdentity';
import { getApiUrl } from '../config/api';
import { useDirectoryMention } from '../hooks/useDirectoryMention';
import DirectoryMentionDropdown from '../components/DirectoryMentionDropdown';

const AUTO_DETECT_KEY = 'autoDetectRelatedTasks';

type SuggestedTask = {
  TaskID: number;
  Title: string;
  Description?: string;
  Status?: string;
  DueDate?: string;
  hasAccess: boolean;
  CreatedByName?: string | null;
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
  const descriptionMention = useDirectoryMention(description, setDescription);
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
  const [isSearchingSuggestions, setIsSearchingSuggestions] = useState(false);
  const [canManageBroadcast, setCanManageBroadcast] = useState(false);
  const [ancestorChain, setAncestorChain] = useState<{ DepartmentID: number; Name: string }[]>([]);
  const [broadcastDeptId, setBroadcastDeptId] = useState<number | null>(null);

  // مستوى بث التقويم الافتراضي للمهمة — متاح فقط لمدير القسم المستقل أو المفوَّض له
  useEffect(() => {
    if (isPersonal || !currentUser?.DepartmentID) {
      setCanManageBroadcast(false);
      setAncestorChain([]);
      setBroadcastDeptId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const permRes = await fetch(getApiUrl(`departments/${currentUser.DepartmentID}/sharing-permission?userId=${encodeURIComponent(actorId)}&isAdmin=${currentUser.IsAdmin}`));
        const permData = permRes.ok ? await permRes.json() : { allowed: false };
        if (cancelled) return;
        setCanManageBroadcast(!!permData.allowed);
        if (!permData.allowed) return;
        const chainRes = await fetch(getApiUrl(`departments/${currentUser.DepartmentID}/ancestor-chain?userId=${encodeURIComponent(actorId)}`));
        if (chainRes.ok) {
          const chain = await chainRes.json();
          if (!cancelled) {
            setAncestorChain(chain);
            setBroadcastDeptId(currentUser.DepartmentID);
          }
        }
      } catch (_) {
        if (!cancelled) setCanManageBroadcast(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isPersonal, currentUser?.DepartmentID, actorId, currentUser.IsAdmin]);

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

  // البحث عن مهام مشابهة للعنوان عند مغادرة الحقل (blur) — وليس أثناء الكتابة — لتفادي إغراق
  // السيرفر بطلبات متكررة. يُفعَّل فقط إن كان العنوان طويلاً بما يكفي (3 كلمات فأكثر أو 8 أحرف فأكثر).
  const handleTitleBlur = async () => {
    const trimmed = title.trim();
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    if (!autoDetect || (wordCount < 3 && trimmed.length < 8)) {
      setSuggestions([]);
      setSelectedSuggestions(new Set());
      return;
    }

    setIsSearchingSuggestions(true);
    try {
      let found: SuggestedTask[] = [];
      if (isPersonal) {
        // المهام الشخصية: ابحث في المهام الشخصية الخاصة بالمستخدم فقط (دائماً لديه صلاحية وصول إليها)
        const keyword = trimmed.split(/\s+/).filter(w => w.length > 2)[0] || trimmed;
        const searchUrl = getApiUrl(`tasks/search?q=${encodeURIComponent(keyword)}&userId=${actorId}&personalOnly=true&originalUserId=${encodeURIComponent(String(currentUser.UserID))}`);
        const searchRes = await fetch(searchUrl);
        if (searchRes.ok) {
          const rows: SuggestedTask[] = await searchRes.json();
          found = rows.map(r => ({ ...r, hasAccess: true }));
        }
      } else {
        // المهام العادية: ابحث في كل قاعدة البيانات (ليس فقط ضمن نطاق وصولي) لمنع ازدواجية العمل —
        // المهام التي لا أملك صلاحية الوصول إليها تظهر باسم منشئها فقط لأتواصل معه بدل كشف محتواها.
        const similarUrl = getApiUrl(`tasks/similar?title=${encodeURIComponent(trimmed)}&userId=${actorId}&isAdmin=${currentUser.IsAdmin}`);
        const searchRes = await fetch(similarUrl);
        if (searchRes.ok) {
          found = await searchRes.json();
        }
      }
      setSuggestions(found.slice(0, 10));
    } catch (_) {
      setSuggestions([]);
    } finally {
      setIsSearchingSuggestions(false);
    }
  };

  // إن غيّر المستخدم العنوان بعد ظهور الاقتراحات، أخفِها حتى يُعيد مغادرة الحقل (منعاً لعرض اقتراحات قديمة لا تطابق العنوان الحالي)
  useEffect(() => {
    setSuggestions([]);
    setSelectedSuggestions(new Set());
  }, [title]);

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
    ...(!isPersonal && canManageBroadcast && broadcastDeptId != null && broadcastDeptId !== currentUser.DepartmentID
      ? { CalendarBroadcastDepartmentID: broadcastDeptId }
      : {}),
    isAdmin: currentUser.IsAdmin,
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

    // ربط أي مهام مشابهة اخترتها قبل الإنشاء (دون حجب الانتقال للمهمة الجديدة بنافذة وسيطة)
    if (selectedSuggestions.size > 0) {
      try {
        await Promise.allSettled(
          Array.from(selectedSuggestions).map(relId =>
            fetch(getApiUrl(`tasks/${newId}/related`), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ relatedTaskId: relId, userId: actingUserId }),
            })
          )
        );
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
          <input type="text" id="title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={handleTitleBlur} required className="mt-1 block w-full px-3 py-2 border border-content/20 bg-bkg rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"/>

          {/* مهام مشابهة تُكتشف عند مغادرة الحقل — قبل إنشاء المهمة، لتجنب تكرار مهام موجودة بالفعل */}
          {isSearchingSuggestions && (
            <p className="mt-2 text-xs text-content-secondary">جاري البحث عن مهام مشابهة...</p>
          )}
          {!isSearchingSuggestions && suggestions.length > 0 && (
            <div className="mt-2 border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/10 rounded-md p-3 space-y-2">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                وجد النظام مهاماً قد تكون مشابهة — إن كانت إحداها نفس المهمة، افتحها بدل تكرارها:
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {suggestions.map(t => t.hasAccess ? (
                  <div
                    key={t.TaskID}
                    className={`flex items-center gap-2 p-1.5 rounded border text-xs transition-colors ${
                      selectedSuggestions.has(t.TaskID) ? 'border-primary bg-primary/5' : 'border-content/10 bg-white dark:bg-gray-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSuggestions.has(t.TaskID)}
                      onChange={() => toggleSuggestion(t.TaskID)}
                      title="ربط هذه المهمة بالمهمة الجديدة بعد إنشائها"
                      className="w-3.5 h-3.5 accent-primary flex-shrink-0 cursor-pointer"
                    />
                    <span className="flex-1 min-w-0 truncate text-content">{t.Title}</span>
                    {t.Status && <span className="text-content-secondary flex-shrink-0">{STATUS_LABELS[t.Status] || t.Status}</span>}
                    <a
                      href={`/task/${t.TaskID}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline flex-shrink-0 font-semibold"
                      title="فتح المهمة في تبويب جديد"
                    >
                      فتح ↗
                    </a>
                  </div>
                ) : (
                  <div key={t.TaskID} className="p-1.5 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 text-xs">
                    <span className="block text-content truncate">{t.Title}</span>
                    <span className="block text-amber-700 dark:text-amber-400 mt-0.5">
                      لا تملك صلاحية الوصول إليها
                      {t.CreatedByName ? ` — تواصل مع (${t.CreatedByName}) إن كانت نفس المهمة` : '.'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <label htmlFor="description" className="block text-sm font-medium text-content-secondary">الوصف</label>
          <textarea
            id="description"
            ref={descriptionMention.ref}
            rows={4}
            value={description}
            onChange={descriptionMention.handleChange}
            onKeyDown={descriptionMention.handleKeyDown}
            onBlur={descriptionMention.close}
            placeholder="اكتب @ للبحث في دليل الهاتف"
            className="mt-1 block w-full px-3 py-2 border border-content/20 bg-bkg rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <DirectoryMentionDropdown
            isOpen={descriptionMention.isOpen}
            loading={descriptionMention.loading}
            suggestions={descriptionMention.suggestions}
            activeIndex={descriptionMention.activeIndex}
            onSelect={descriptionMention.selectSuggestion}
            onHover={descriptionMention.setActiveIndex}
          />
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

        {!isPersonal && canManageBroadcast && ancestorChain.length > 1 && (
          <div>
            <label htmlFor="broadcastLevel" className="block text-sm font-medium text-content-secondary">
              مستوى ظهور مهامها الفرعية وتعليقاتها في التقويم
            </label>
            <select
              id="broadcastLevel"
              value={broadcastDeptId ?? ''}
              onChange={(e) => setBroadcastDeptId(parseInt(e.target.value, 10))}
              className="mt-1 block w-full px-3 py-2 border border-content/20 bg-bkg rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {ancestorChain.map((d, idx) => (
                <option key={d.DepartmentID} value={d.DepartmentID}>
                  {idx === 0 ? `قسمي (${d.Name})` : d.Name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-content-secondary">
              كل مهمة فرعية أو تعليق تُعلّمه لاحقاً "إظهار في التقويم" يتبع هذا المستوى تلقائياً — يمكن تعديله لاحقاً من تفاصيل المهمة.
            </p>
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
            اقتراح مهام مشابهة بعد كتابة العنوان
            <span className="text-xs text-content-secondary mr-2">(يبحث عند مغادرة حقل العنوان لتجنب تكرار مهام موجودة بالفعل)</span>
          </label>
        </div>

        <button type="submit" disabled={isSubmitting} className="w-full bg-primary text-white py-2 px-4 rounded-md hover:bg-primary-dark disabled:bg-gray-400 transition-colors">
          {isSubmitting ? 'جاري الإنشاء...' : 'إنشاء المهمة'}
        </button>
      </form>
      {message && <div className={`mt-4 p-4 rounded-md text-sm ${message.type === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'}`}>{message.text}</div>}
    </div>
  );
};

export default CreateTask;