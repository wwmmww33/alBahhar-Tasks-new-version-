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
  EndDate?: string | null;
  AssignedToName?: string;
};

type SpanPos = 'single' | 'start' | 'middle' | 'end';
type CalendarItemWithSpan = CalendarItem & { _spanPos: SpanPos };

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

const SPAN_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#f97316',
  '#ec4899', '#14b8a6', '#ef4444', '#eab308',
];
const getSpanColor = (subtaskId: number) => SPAN_COLORS[subtaskId % SPAN_COLORS.length];

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

  const toLocalYMD = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const itemsByDay = useMemo(() => {
    const map: Record<string, CalendarItemWithSpan[]> = {};
    for (const it of items) {
      const due = new Date(it.DueDate);
      const dueNorm = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      const endRaw = it.EndDate ? new Date(it.EndDate) : null;
      const endNorm = endRaw ? new Date(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate()) : null;

      if (!endNorm) {
        const key = toLocalYMD(dueNorm);
        if (!map[key]) map[key] = [];
        map[key].push({ ...it, _spanPos: 'single' });
      } else {
        const cur = new Date(dueNorm);
        let safety = 0;
        while (cur <= endNorm && safety < 366) {
          const key = toLocalYMD(cur);
          if (!map[key]) map[key] = [];
          const isFirst = cur.getTime() === dueNorm.getTime();
          const isLast  = cur.getTime() === endNorm.getTime();
          const pos: SpanPos = isFirst && isLast ? 'single' : isFirst ? 'start' : isLast ? 'end' : 'middle';
          map[key].push({ ...it, _spanPos: pos });
          cur.setDate(cur.getDate() + 1);
          safety++;
        }
      }
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

  // تعيين lane ثابت لكل حدث ممتد بحيث لا تتداخل الخطوط أفقياً
  const laneMap = useMemo(() => {
    const spans = items
      .filter(it => !!it.EndDate)
      .map(it => {
        const d = new Date(it.DueDate);
        const e = new Date(it.EndDate!);
        return {
          id: it.SubtaskID,
          start: toLocalYMD(new Date(d.getFullYear(), d.getMonth(), d.getDate())),
          end: toLocalYMD(new Date(e.getFullYear(), e.getMonth(), e.getDate())),
        };
      })
      .sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.id - b.id);

    const map = new Map<number, number>();
    const laneEnds: string[] = [];

    for (const span of spans) {
      let lane = 0;
      while (lane < laneEnds.length && laneEnds[lane] >= span.start) lane++;
      map.set(span.id, lane);
      if (lane < laneEnds.length) laneEnds[lane] = span.end;
      else laneEnds.push(span.end);
    }

    return map;
  }, [items]);

  // أول يوم مرئي لكل حدث ممتد (لعرض عنوانه حتى لو بدأ قبل نطاق التقويم)
  const firstVisibleDayMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const d of dateRange) {
      for (const item of (itemsByDay[d.key] || [])) {
        if (item._spanPos !== 'single' && !map.has(item.SubtaskID)) {
          map.set(item.SubtaskID, d.key);
        }
      }
    }
    return map;
  }, [itemsByDay, dateRange]);

  const stripWidth = useMemo(() => {
    if (laneMap.size === 0) return 0;
    const maxLane = Math.max(...laneMap.values());
    return (maxLane + 1) * 7 + 1;
  }, [laneMap]);

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
          <div className="space-y-1">
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
              const isWeekend = d.date.getDay() === 5 || d.date.getDay() === 6;

              // الأحداث الممتدة لهذا اليوم (بدون تكرار، مرتبة بثبات)
              const spanningItems = visibleShared.filter(it => it._spanPos !== 'single');
              const uniqueSpanItems = [...new Map(spanningItems.map(it => [it.SubtaskID, it])).values()];

              // أحداث بدأت قبل هذا اليوم لكنه أول يوم مرئي لها في النطاق
              const carryOverItems = visibleShared.filter(it => {
                const isFirstVisible = firstVisibleDayMap.get(it.SubtaskID) === d.key;
                return isFirstVisible && it._spanPos !== 'start' && it._spanPos !== 'single';
              });

              return (
                <div key={d.key}>
                  {/* شريط الامتداد + [الأحداث المتجاوزة + مربع اليوم] في صف واحد */}
                  <div className="flex items-stretch" dir="ltr">
                    {/* شريط خطوط الامتداد — يمتد عبر صفوف الأحداث المتجاوزة والمربع معاً */}
                    {stripWidth > 0 && (
                      <div className="relative flex-shrink-0" style={{ width: `${stripWidth}px` }}>
                        {uniqueSpanItems.map((item) => {
                          const pos = item._spanPos;
                          const color = getSpanColor(item.SubtaskID);
                          const lane = laneMap.get(item.SubtaskID) ?? 0;
                          const isCarryOver = carryOverItems.some(c => c.SubtaskID === item.SubtaskID);
                          const carryOverIndex = carryOverItems.findIndex(c => c.SubtaskID === item.SubtaskID);
                          const ROW_HEIGHT = 20;

                          let top: string;
                          let bottom: string;

                          if (isCarryOver) {
                            // الخط ينطلق من منتصف سطر هذا الحدث في منطقة الأحداث المتجاوزة
                            top = `${carryOverIndex * ROW_HEIGHT + ROW_HEIGHT / 2}px`;
                            bottom = '-4px';
                          } else if (pos === 'start') {
                            // الخط ينطلق من أعلى مربع اليوم (بعد صفوف الأحداث المتجاوزة)
                            top = `${carryOverItems.length * ROW_HEIGHT}px`;
                            bottom = '-4px';
                          } else if (pos === 'end') {
                            top = '-4px';
                            bottom = '0';
                          } else {
                            top = '-4px';
                            bottom = '-4px';
                          }

                          return (
                            <div
                              key={item.SubtaskID}
                              className="absolute rounded-full"
                              style={{
                                left: `${lane * 7 + 2}px`,
                                width: '3px',
                                backgroundColor: color,
                                top,
                                bottom,
                                zIndex: 1,
                              }}
                            />
                          );
                        })}
                      </div>
                    )}

                    {/* العمود الأيمن: الأحداث المتجاوزة (يسار) + مربع اليوم */}
                    <div className="flex-1 min-w-0">
                      {/* أحداث بدأت قبل النطاق — محاذاة يسار، ارتفاع ثابت 20px لكل سطر */}
                      {carryOverItems.map((item) => {
                        const color = getSpanColor(item.SubtaskID);
                        const startLabel = new Date(item.DueDate).toLocaleDateString('ar-EG', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        });
                        return (
                          <div key={item.SubtaskID} className="flex items-center h-5 gap-1 text-xs overflow-hidden pl-1">
                            <button
                              type="button"
                              style={{ color }}
                              className="font-semibold hover:underline truncate text-left"
                              onClick={() => openTaskInNewTab(item.TaskID)}
                            >
                              {item.SubtaskTitle}{item.AssignedToName ? ` (${item.AssignedToName})` : ''}
                            </button>
                            <span className="text-[10px] text-content-secondary shrink-0 whitespace-nowrap">
                              (بدأ: {startLabel})
                            </span>
                          </div>
                        );
                      })}

                      {/* مربع محتوى اليوم */}
                      <div
                        dir="rtl"
                        className={
                          `p-2 rounded border min-w-0 ` +
                          (hasEvents
                            ? (isWeekend
                                ? 'bg-blue-200 dark:bg-blue-900/50 border-blue-400 dark:border-blue-600'
                                : 'bg-blue-100 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700')
                            : (isWeekend
                                ? 'bg-gray-200 dark:bg-gray-900/70 border-content/30'
                                : 'bg-white/60 dark:bg-gray-800/60 border-content/10'))
                        }
                      >
                        <div className={`text-xs font-semibold mb-1 ${hasEvents ? 'text-black dark:text-white' : 'text-content'} text-right`}>{d.label}</div>
                        {visibleShared.length > 0 && (
                          <div className="space-y-0.5 text-right">
                            {visibleShared.map((item) => {
                              const pos = item._spanPos;
                              const isFirstVisible = firstVisibleDayMap.get(item.SubtaskID) === d.key;
                              if (pos !== 'single' && !(isFirstVisible && pos === 'start')) return null;
                              const spanning = pos === 'start';
                              const color = spanning ? getSpanColor(item.SubtaskID) : undefined;
                              return (
                                <div key={`${item.SubtaskID}-${pos}`} className="text-xs">
                                  <button
                                    type="button"
                                    style={{ color }}
                                    className="font-semibold hover:underline cursor-pointer text-right w-full truncate block"
                                    onClick={() => openTaskInNewTab(item.TaskID)}
                                  >
                                    {item.SubtaskTitle}{item.AssignedToName ? ` (${item.AssignedToName})` : ''}
                                  </button>
                                  <div style={{ color }} className="opacity-70">ضمن: {item.TaskTitle}</div>
                                </div>
                              );
                            })}
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
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

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
