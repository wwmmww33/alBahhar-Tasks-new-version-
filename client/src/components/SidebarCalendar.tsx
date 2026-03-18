// src/components/SidebarCalendar.tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar as CalendarIcon } from 'lucide-react';
import type { CurrentUser } from '../types';
import { resolveCurrentActorId } from '../utils/actorIdentity';

type CalendarItem = {
  SubtaskID: number;
  TaskID: number;
  SubtaskTitle: string;
  TaskTitle: string;
  DueDate: string;
  AssignedToName?: string;
};

type CalendarCommentItem = {
  CommentID: number;
  TaskID: number;
  TaskTitle: string;
  Content: string;
  CreatedAt: string;
  CommentedByName?: string;
};

type SidebarCalendarProps = {
  currentUser: CurrentUser;
};

const SidebarCalendar = ({ currentUser }: SidebarCalendarProps) => {
  const actorId = resolveCurrentActorId(currentUser) || currentUser.UserID;
  const personalUserId = currentUser.UserID;
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [extraItems, setExtraItems] = useState<CalendarItem[]>([]);
  type PersonalEventItem = { EventID: number; Title: string; EventDate: string };
  const [personalEvents, setPersonalEvents] = useState<PersonalEventItem[]>([]);
  const [extraPersonalEvents, setExtraPersonalEvents] = useState<PersonalEventItem[]>([]);
  const [commentEvents, setCommentEvents] = useState<CalendarCommentItem[]>([]);
  const [extraCommentEvents, setExtraCommentEvents] = useState<CalendarCommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEventTitle, setNewEventTitle] = useState('');
  // وضع الفلترة للتقويم: مشترك، خاص، أو كلاهما
  const [viewFilter, setViewFilter] = useState<'both' | 'shared' | 'personal'>('both');
  const getTodayStr = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  const [newEventDate, setNewEventDate] = useState(getTodayStr());
  const [submittingEvent, setSubmittingEvent] = useState(false);
  const navigate = useNavigate();
  const openTaskInNewTab = (taskId: number) => {
    window.open(`/task/${taskId}`, '_blank', 'noopener,noreferrer');
  };

  // بناء نطاق الأيام بدءًا من اليوم وحتى 30 يومًا
  const dateRange = useMemo(() => {
    const days: { key: string; date: Date; label: string }[] = [];
    const toLocalYMD = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const key = toLocalYMD(d);
      const isToday = i === 0;
      const dayLabel = isToday
        ? 'اليوم'
        : d.toLocaleDateString('ar-EG', { weekday: 'long' });
      const dateLabel = d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' });
      days.push({ key, date: d, label: `${dayLabel} - ${dateLabel}` });
    }
    return days;
  }, []);

  // جلب أحداث التقويم لمدى 30 يومًا ابتداءً من اليوم + الأحداث اللاحقة دون مربعات فارغة

  const fetchCalendarRange = async () => {
    setLoading(true);
    try {
      const start = new Date();
      const toLocalYMD = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
      };
      const startStr = toLocalYMD(start);
      const res = await fetch(`/api/calendar/subtasks?userId=${actorId}&startDate=${startStr}&days=30`);
      if (!res.ok) {
        throw new Error(`Calendar fetch failed: ${res.status}`);
      }
      const ct = res.headers.get('content-type') || '';
      let data: any = [];
      try {
        data = ct.includes('application/json') ? await res.json() : [];
      } catch (_) {
        data = [];
      }
      setItems(Array.isArray(data) ? data : []);

      try {
        const perRes = await fetch(`/api/calendar/personal-events?userId=${personalUserId}&startDate=${startStr}&days=30`);
        if (perRes.ok) {
          const pct = perRes.headers.get('content-type') || '';
          const perData = pct.includes('application/json') ? await perRes.json() : [];
          setPersonalEvents(Array.isArray(perData) ? perData : []);
        } else {
          setPersonalEvents([]);
        }
      } catch (_) {
        setPersonalEvents([]);
      }

      try {
        const commentsRes = await fetch(`/api/calendar/comments?userId=${actorId}&startDate=${startStr}&days=30`);
        if (commentsRes.ok) {
          const cct = commentsRes.headers.get('content-type') || '';
          const commentsData = cct.includes('application/json') ? await commentsRes.json() : [];
          setCommentEvents(Array.isArray(commentsData) ? commentsData : []);
        } else {
          setCommentEvents([]);
        }
      } catch (_) {
        setCommentEvents([]);
      }

      const gridEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 30);
      const gridEndStr = toLocalYMD(gridEnd);
      const extraRes = await fetch(`/api/calendar/subtasks?userId=${actorId}&startDate=${gridEndStr}&days=365`);
      if (!extraRes.ok) {
        // عدم رمي الاستثناء هنا، فقط تجاهل العناصر الإضافية
        setExtraItems([]);
      } else {
        const ect = extraRes.headers.get('content-type') || '';
        let extraData: any = [];
        try {
          extraData = ect.includes('application/json') ? await extraRes.json() : [];
        } catch (_) {
          extraData = [];
        }
        setExtraItems(Array.isArray(extraData) ? extraData : []);
      }

      try {
        const extraPerRes = await fetch(`/api/calendar/personal-events?userId=${personalUserId}&startDate=${gridEndStr}&days=365`);
        if (extraPerRes.ok) {
          const epct = extraPerRes.headers.get('content-type') || '';
          const extraPerData = epct.includes('application/json') ? await extraPerRes.json() : [];
          setExtraPersonalEvents(Array.isArray(extraPerData) ? extraPerData : []);
        } else {
          setExtraPersonalEvents([]);
        }
      } catch (_) {
        setExtraPersonalEvents([]);
      }

      try {
        const extraCommentsRes = await fetch(`/api/calendar/comments?userId=${actorId}&startDate=${gridEndStr}&days=365`);
        if (extraCommentsRes.ok) {
          const ecct = extraCommentsRes.headers.get('content-type') || '';
          const extraCommentsData = ecct.includes('application/json') ? await extraCommentsRes.json() : [];
          setExtraCommentEvents(Array.isArray(extraCommentsData) ? extraCommentsData : []);
        } else {
          setExtraCommentEvents([]);
        }
      } catch (_) {
        setExtraCommentEvents([]);
      }

    } catch (err) {
      setItems([]);
      setExtraItems([]);
      setPersonalEvents([]);
      setExtraPersonalEvents([]);
      setCommentEvents([]);
      setExtraCommentEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalendarRange();
  }, [actorId]);

  // تحديث فوري عند إنشاء مهمة فرعية جديدة أو طلب تحديث يدوي
  useEffect(() => {
    const handler = () => fetchCalendarRange();
    const commentHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ CommentID?: number | string; ShowInCalendar?: boolean }>).detail;
      const commentId = Number(detail?.CommentID);
      const shouldShow = detail?.ShowInCalendar === true;

      if (!Number.isFinite(commentId)) {
        fetchCalendarRange();
        return;
      }

      if (shouldShow) {
        fetchCalendarRange();
        return;
      }

      setCommentEvents((prev) => prev.filter((comment) => Number(comment.CommentID) !== commentId));
      setExtraCommentEvents((prev) => prev.filter((comment) => Number(comment.CommentID) !== commentId));
    };

    window.addEventListener('calendar:subtask:created', handler);
    window.addEventListener('calendar:refresh', handler);
    window.addEventListener('calendar:comment:updated', commentHandler as EventListener);
    return () => {
      window.removeEventListener('calendar:subtask:created', handler);
      window.removeEventListener('calendar:refresh', handler);
      window.removeEventListener('calendar:comment:updated', commentHandler as EventListener);
    };
  }, [actorId]);

  const itemsByDay = useMemo(() => {
    const map: Record<string, CalendarItem[]> = {};
    for (const it of items) {
      const d = new Date(it.DueDate);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map[key]) map[key] = [];
      map[key].push(it);
    }
    return map;
  }, [items]);

  const commentsByDay = useMemo(() => {
    const map: Record<string, CalendarCommentItem[]> = {};
    for (const comment of commentEvents) {
      const d = new Date(comment.CreatedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map[key]) map[key] = [];
      map[key].push(comment);
    }
    return map;
  }, [commentEvents]);

  return (
    <aside className="w-72 shrink-0 border-r border-content/10 bg-content/5 p-3">
      <div className="mb-3">
        <button
          type="button"
          onClick={() => navigate('/calendar')}
          className="flex items-center gap-2 hover:text-primary transition-colors"
        >
          <CalendarIcon className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold">التقويم</h2>
        </button>
        <p className="text-xs text-content-secondary mt-1">يعرض الأحداث خلال 30 يوماً القادمة.</p>
        {/* عناصر التحكم بالفلترة */}
        <div className="flex items-center gap-1 mt-2">
          <span className="text-xs text-content-secondary">عرض:</span>
          <button
            type="button"
            onClick={() => setViewFilter('both')}
            className={`px-2 py-1 text-xs rounded border ${viewFilter === 'both' ? 'bg-primary text-white border-primary' : 'bg-white dark:bg-gray-700 text-content border-content/20'}`}
          >مشترك + خاص</button>
          <button
            type="button"
            onClick={() => setViewFilter('shared')}
            className={`px-2 py-1 text-xs rounded border ${viewFilter === 'shared' ? 'bg-primary text-white border-primary' : 'bg-white dark:bg-gray-700 text-content border-content/20'}`}
          >مشترك فقط</button>
          <button
            type="button"
            onClick={() => setViewFilter('personal')}
            className={`px-2 py-1 text-xs rounded border ${viewFilter === 'personal' ? 'bg-primary text-white border-primary' : 'bg-white dark:bg-gray-700 text-content border-content/20'}`}
          >خاص فقط</button>
        </div>
      </div>
      {/* نموذج إضافة حدث خاص */}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newEventTitle.trim()) return;
          setSubmittingEvent(true);
          try {
            const resp = await fetch('/api/calendar/personal-events', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: currentUser.UserID, title: newEventTitle.trim(), eventDate: newEventDate })
            });
            if (resp.ok) {
              setNewEventTitle('');
              setNewEventDate(getTodayStr());
              window.dispatchEvent(new CustomEvent('calendar:refresh'));
            } else {
              const txt = await resp.text().catch(() => '');
              alert(`فشل إضافة الحدث الخاص (${resp.status}). ${txt}`);
            }
          } catch (err) {
            console.error('Network error adding personal event:', err);
            alert('تعذر الاتصال بالخادم. تأكد من أن الخادم يعمل على المنفذ 5001 والبروكسي مفعل.');
          } finally {
            setSubmittingEvent(false);
          }
        }}
        className="mb-3 p-2 border rounded bg-white/70 dark:bg-gray-800/70 border-content/10"
      >
        <div className="text-xs font-semibold mb-2 text-right">إضافة حدث خاص</div>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={newEventTitle}
            onChange={(e) => setNewEventTitle(e.target.value)}
            placeholder="عنوان الحدث..."
            className="p-2 border rounded bg-bkg text-sm"
          />
          <input
            type="date"
            value={newEventDate}
            onChange={(e) => setNewEventDate(e.target.value)}
            className="p-2 border rounded bg-bkg text-sm"
          />
          <button
            type="submit"
            disabled={submittingEvent}
            className="px-3 py-1 bg-primary text-white rounded text-sm disabled:opacity-70"
          >إضافة</button>
        </div>
      </form>
      {loading ? (
        <div className="text-sm text-content-secondary">جاري التحميل...</div>
      ) : (
        <div className="space-y-4">
          {(viewFilter === 'shared'
            ? items.length === 0
            : viewFilter === 'personal'
            ? personalEvents.length === 0 && commentEvents.length === 0
            : items.length === 0 && personalEvents.length === 0 && commentEvents.length === 0) && (
            <div className="p-2 rounded bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 text-xs text-yellow-800 dark:text-yellow-200">
              لا توجد أحداث في هذا النطاق.
              تأكد من وجود مهام فرعية بتاريخ استحقاق ضمن 30 يومًا وتفعيل خيار "إظهار في التقويم".
              إذا لم يكن لديك قسم مضبوط، ستُعرض مهامك المُسندة فقط.
              <div className="mt-2">
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('calendar:refresh'))}
                  className="px-2 py-1 bg-primary text-white rounded"
                >تحديث التقويم</button>
              </div>
            </div>
          )}
          <ul className="space-y-2">
            {dateRange.map((d) => {
              const dayItems = itemsByDay[d.key] || [];
              const dayPersonal = personalEvents.filter(pe => {
                const ev = new Date(pe.EventDate);
                const key = `${ev.getFullYear()}-${String(ev.getMonth() + 1).padStart(2, '0')}-${String(ev.getDate()).padStart(2, '0')}`;
                return key === d.key;
              });
              const dayComments = commentsByDay[d.key] || [];
              const visibleShared = viewFilter !== 'personal' ? dayItems : [];
              const visiblePersonal = viewFilter !== 'shared' ? dayPersonal : [];
              const visibleComments = viewFilter !== 'shared' ? dayComments : [];
              const hasEvents =
                visibleShared.length > 0 ||
                visiblePersonal.length > 0 ||
                visibleComments.length > 0;
              const isWeekend = d.date.getDay() === 5 || d.date.getDay() === 6; // الجمعة=5، السبت=6
              return (
                <li
                  key={d.key}
                  className={
                    `p-2 rounded border ` +
                    (hasEvents
                          ? (isWeekend
                              ? 'bg-blue-200 dark:bg-blue-900/50 border-blue-400 dark:border-blue-600'
                              : 'bg-blue-100 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700')
                          : (isWeekend
                              ? 'bg-gray-200 dark:bg-gray-900/70 border-content/30'
                              : 'bg-white/60 dark:bg-gray-800/60 border-content/10')) +
                    ''
                  }
                >
                  <div className={`text-xs font-semibold mb-1 ${hasEvents ? 'text-black' : 'text-content'} text-right`}>{d.label}</div>
                  {visibleShared.length > 0 && (
                    <div className="space-y-1 text-right">
                      {visibleShared.map((item) => (
                        <div key={item.SubtaskID} className="text-xs">
                          <button
                            type="button"
                            className="font-semibold text-blue-800 dark:text-blue-200 hover:underline cursor-pointer text-right"
                            onClick={() => openTaskInNewTab(item.TaskID)}
                          >
                            {item.SubtaskTitle}{item.AssignedToName ? ` (${item.AssignedToName})` : ''}
                          </button>
                          <div className="text-blue-600 dark:text-blue-300">ضمن: {item.TaskTitle}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {visiblePersonal.length > 0 && (
                    <div className="space-y-1 text-right mt-1">
                      {visiblePersonal.map((pe) => (
                        <div key={pe.EventID} className="text-xs">
                          <span className="font-semibold text-green-800 dark:text-green-200 text-right">{pe.Title}</span>
                          <span className="ml-1 inline-block text-[10px] text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30 px-1 py-[1px] rounded">(خاص)</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {visibleComments.length > 0 && (
                    <div className="space-y-1 text-right mt-1">
                      {visibleComments.map((comment) => (
                        <button
                          key={comment.CommentID}
                          type="button"
                          onClick={() => openTaskInNewTab(comment.TaskID)}
                          className="text-xs font-semibold text-purple-800 dark:text-purple-200 hover:underline text-right w-full"
                        >
                          {comment.Content}
                          <div className="text-[11px] text-content-secondary">ضمن: {comment.TaskTitle}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {((viewFilter !== 'personal' && extraItems.length > 0) ||
            (viewFilter !== 'shared' && (extraPersonalEvents.length > 0 || extraCommentEvents.length > 0))) && (
            <div>
              <h3 className="text-sm font-bold text-content mb-2">أحداث بعد 30 يوم</h3>
              <ul className="space-y-2">
                {viewFilter !== 'personal' && extraItems.map((item) => (
                  <li key={item.SubtaskID} className="p-2 rounded bg-white/60 dark:bg-gray-800/60 border border-content/10 text-right">
                    <div className="text-xs text-content-secondary mb-1">
                      {new Date(item.DueDate).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </div>
                    <div className="text-xs">
                      <button
                        type="button"
                        className="font-semibold text-blue-800 dark:text-blue-200 hover:underline cursor-pointer text-right"
                        onClick={() => openTaskInNewTab(item.TaskID)}
                      >
                        {item.SubtaskTitle}{item.AssignedToName ? ` (${item.AssignedToName})` : ''}
                      </button>
                      <div className="text-blue-600 dark:text-blue-300">ضمن: {item.TaskTitle}</div>
                    </div>
                  </li>
                ))}
                {viewFilter !== 'shared' && extraPersonalEvents.map((pe) => (
                  <li key={pe.EventID} className="p-2 rounded bg-white/60 dark:bg-gray-800/60 border border-content/10 text-right">
                    <div className="text-xs text-content-secondary mb-1">
                      {new Date(pe.EventDate).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </div>
                    <div className="text-xs">
                      <span className="font-semibold text-green-800 dark:text-green-200 text-right">{pe.Title}</span>
                      <span className="ml-1 inline-block text-[10px] text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30 px-1 py-[1px] rounded">(خاص)</span>
                    </div>
                  </li>
                ))}
                {viewFilter !== 'shared' && extraCommentEvents.map((comment) => (
                  <li key={comment.CommentID} className="p-2 rounded bg-white/60 dark:bg-gray-800/60 border border-content/10 text-right">
                    <div className="text-xs text-content-secondary mb-1">
                      {new Date(comment.CreatedAt).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </div>
                    <div className="text-xs">
                      <button
                        type="button"
                        onClick={() => openTaskInNewTab(comment.TaskID)}
                        className="font-semibold text-purple-800 dark:text-purple-200 hover:underline text-right w-full"
                      >
                        {comment.Content}
                        <div className="text-[11px] text-content-secondary">ضمن: {comment.TaskTitle}</div>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>
      )}
    </aside>
  );
};

export default SidebarCalendar;
