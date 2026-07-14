// src/components/SidebarCalendar.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
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
  AssignedToID?: string | null;
  PersonalOwnerUserID?: string | null;
  IsCompleted?: boolean | number;
};

// تجاوز وقت المهمة اليوم (لها وقت محدد غير 00:00 وحان موعدها)
const isPastDueToday = (dateStr: string): boolean => {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (d.getHours() === 0 && d.getMinutes() === 0) return false;
  return d.getTime() < Date.now();
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
  PersonalOwnerUserID?: string | null;
};

type SidebarCalendarProps = {
  currentUser: CurrentUser;
};

const SPAN_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#f97316',
  '#ec4899', '#14b8a6', '#ef4444', '#eab308',
];
const getSpanColor = (subtaskId: number) => SPAN_COLORS[subtaskId % SPAN_COLORS.length];

const formatEventTime = (dateStr: string): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const h = d.getHours();
  const m = d.getMinutes();
  if (h === 0 && m === 0) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} `;
};

const SidebarCalendar = ({ currentUser }: SidebarCalendarProps) => {
  // calendarUserId: always the user's own UserID for department-scope resolution (matches CalendarPage)
  // actorId: may be VacancyID (used only for client-side AssignedToID filtering)
  const calendarUserId = currentUser.UserID;
  const actorId = resolveCurrentActorId(currentUser) || currentUser.UserID;
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [extraItems, setExtraItems] = useState<CalendarItem[]>([]);
  const [commentEvents, setCommentEvents] = useState<CalendarCommentItem[]>([]);
  const [extraCommentEvents, setExtraCommentEvents] = useState<CalendarCommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewFilter, setViewFilter] = useState<'both' | 'shared' | 'vacancy' | 'personal'>('both');
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
        : d.toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long' });
      const dateLabel = d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long' });
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
      const res = await fetch(`/api/calendar/subtasks?userId=${calendarUserId}&startDate=${startStr}&days=30`);
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
        const commentsRes = await fetch(`/api/calendar/comments?userId=${calendarUserId}&startDate=${startStr}&days=30`);
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
      const extraRes = await fetch(`/api/calendar/subtasks?userId=${calendarUserId}&startDate=${gridEndStr}&days=365`);
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
        const extraCommentsRes = await fetch(`/api/calendar/comments?userId=${calendarUserId}&startDate=${gridEndStr}&days=365`);
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
      setCommentEvents([]);
      setExtraCommentEvents([]);
    } finally {
      setLoading(false);
    }
  };

  // ref يضمن أن event handlers تستدعي دائماً أحدث نسخة من fetchCalendarRange
  const fetchRef = useRef(fetchCalendarRange);
  useEffect(() => { fetchRef.current = fetchCalendarRange; });

  useEffect(() => {
    fetchRef.current();
  }, [calendarUserId]);

  // تحديث فوري عند إنشاء/تحديث مهمة فرعية أو تعليق أو طلب تحديث يدوي
  useEffect(() => {
    // إنشاء جديد: نُحدِّث فقط إذا كان ShowInCalendar=true
    const createdHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ ShowInCalendar?: boolean }>).detail;
      if (detail?.ShowInCalendar === true) fetchRef.current();
    };
    // تبديل ShowInCalendar لمهمة فرعية: نُحدِّث دائماً (إظهار أو إخفاء)
    const subtaskUpdatedHandler = () => fetchRef.current();
    // تبديل ShowInCalendar لتعليق: نُحدِّث إذا أُضيف، أو نُزيل من الحالة إذا أُخفي
    const commentToggleHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ CommentID?: number | string; ShowInCalendar?: boolean }>).detail;
      const commentId = Number(detail?.CommentID);
      if (detail?.ShowInCalendar === true) {
        fetchRef.current();
      } else if (Number.isFinite(commentId)) {
        setCommentEvents(prev => prev.filter(c => Number(c.CommentID) !== commentId));
        setExtraCommentEvents(prev => prev.filter(c => Number(c.CommentID) !== commentId));
      } else {
        fetchRef.current();
      }
    };

    window.addEventListener('calendar:subtask:created', createdHandler as EventListener);
    window.addEventListener('calendar:comment:created', createdHandler as EventListener);
    window.addEventListener('calendar:subtask:updated', subtaskUpdatedHandler);
    window.addEventListener('calendar:comment:updated', commentToggleHandler as EventListener);
    window.addEventListener('calendar:refresh', subtaskUpdatedHandler);
    const hourlyTimer = setInterval(() => fetchRef.current(), 60 * 60 * 1000);
    return () => {
      window.removeEventListener('calendar:subtask:created', createdHandler as EventListener);
      window.removeEventListener('calendar:comment:created', createdHandler as EventListener);
      window.removeEventListener('calendar:subtask:updated', subtaskUpdatedHandler);
      window.removeEventListener('calendar:comment:updated', commentToggleHandler as EventListener);
      window.removeEventListener('calendar:refresh', subtaskUpdatedHandler);
      clearInterval(hourlyTimer);
    };
  }, []);

  const toLocalYMD = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const personalByDay = useMemo(() => {
    const map: Record<string, CalendarItemWithSpan[]> = {};
    for (const it of items) {
      if (!it.PersonalOwnerUserID) continue;
      const key = toLocalYMD(new Date(it.DueDate));
      if (!map[key]) map[key] = [];
      map[key].push({ ...it, _spanPos: 'single' });
    }
    return map;
  }, [items]);

  const itemsByDay = useMemo(() => {
    const map: Record<string, CalendarItemWithSpan[]> = {};
    for (const it of items) {
      if (it.PersonalOwnerUserID) continue;
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
      .filter(it => !!it.EndDate && !it.PersonalOwnerUserID)
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
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          <button
            type="button"
            onClick={() => setViewFilter('both')}
            className={`px-2 py-1 text-xs rounded border ${viewFilter === 'both' ? 'bg-primary text-white border-primary' : 'bg-white dark:bg-gray-700 text-content border-content/20'}`}
          >الكل</button>
          <button
            type="button"
            onClick={() => setViewFilter('shared')}
            className={`px-2 py-1 text-xs rounded border ${viewFilter === 'shared' ? 'bg-primary text-white border-primary' : 'bg-white dark:bg-gray-700 text-content border-content/20'}`}
          >القسم</button>
          <button
            type="button"
            onClick={() => setViewFilter('vacancy')}
            className={`px-2 py-1 text-xs rounded border ${viewFilter === 'vacancy' ? 'bg-primary text-white border-primary' : 'bg-white dark:bg-gray-700 text-content border-content/20'}`}
          >المنصب</button>
          <button
            type="button"
            onClick={() => setViewFilter('personal')}
            className={`px-2 py-1 text-xs rounded border ${viewFilter === 'personal' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-gray-700 text-emerald-700 dark:text-emerald-300 border-emerald-400'}`}
          >الخاص</button>
        </div>
      </div>
      {loading ? (
        <div className="text-sm text-content-secondary">جاري التحميل...</div>
      ) : (
        <div className="space-y-4">
          {(viewFilter === 'shared'
            ? items.filter(it => !it.PersonalOwnerUserID).length === 0
            : viewFilter === 'personal'
            ? items.filter(it => it.PersonalOwnerUserID).length === 0 && commentEvents.filter(c => c.PersonalOwnerUserID).length === 0
            : items.length === 0 && commentEvents.length === 0) && (
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
              const dayComments = commentsByDay[d.key] || [];
              const visibleShared = viewFilter === 'personal' ? []
                : viewFilter === 'vacancy' ? dayItems.filter(it => String(it.AssignedToID) === String(actorId))
                : dayItems;
              const visiblePersonal = (viewFilter === 'both' || viewFilter === 'personal') ? (personalByDay[d.key] || []) : [];
              const visibleComments = viewFilter === 'personal'
                ? dayComments.filter(c => c.PersonalOwnerUserID)
                : viewFilter === 'both'
                  ? dayComments
                  : dayComments.filter(c => !c.PersonalOwnerUserID);
              // hasEvents = true فقط عندما يوجد محتوى حقيقي يُعرض في المربع
              // (أيام الامتداد الوسطى والنهائية لا تُلوَّن — يكفيها الخط الجانبي)
              const hasEvents =
                visibleShared.some(it => {
                  const isFirstVisible = firstVisibleDayMap.get(it.SubtaskID) === d.key;
                  return it._spanPos === 'single' || (isFirstVisible && it._spanPos === 'start');
                }) ||
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
                  {/* كل حدث متجاوز في مربع مستقل: خط ملون على اليسار + نص كامل حر */}
                  {carryOverItems.map((item) => {
                    const color = getSpanColor(item.SubtaskID);
                    const startLabel = new Date(item.DueDate).toLocaleDateString('ar-EG-u-nu-latn', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    });
                    const pastDue = isPastDueToday(item.DueDate);
                    const completed = !!item.IsCompleted;
                    return (
                      <div
                        key={item.SubtaskID}
                        dir="rtl"
                        className={`py-0.5 mb-0.5 text-xs min-w-0 ${pastDue ? 'opacity-50' : ''}`}
                        style={{ borderLeft: `3px solid ${color}`, paddingLeft: '6px' }}
                      >
                        <button
                          type="button"
                          style={{ color }}
                          className={`font-semibold hover:underline break-words text-right w-full block min-w-0 ${completed ? 'line-through' : ''}`}
                          onClick={() => openTaskInNewTab(item.TaskID)}
                        >
                          {item.SubtaskTitle}{item.AssignedToName ? ` (${item.AssignedToName})` : ''}
                        </button>
                        <div className="text-[10px] text-content-secondary text-right">
                          (بدأ: {startLabel})
                        </div>
                      </div>
                    );
                  })}

                  {/* مربع اليوم مع شريط الامتداد الزمني */}
                  <div
                    className="flex items-stretch"
                    dir="ltr"
                    style={{ marginTop: carryOverItems.length > 0 ? '4px' : undefined }}
                  >
                    {stripWidth > 0 && (
                      <div className="relative flex-shrink-0" style={{ width: `${stripWidth}px` }}>
                        {uniqueSpanItems.map((si) => {
                          const siLane = laneMap.get(si.SubtaskID) ?? 0;
                          const siColor = getSpanColor(si.SubtaskID);
                          const isCarryOverItem = carryOverItems.some(c => c.SubtaskID === si.SubtaskID);
                          const pos = si._spanPos;
                          // أحداث متجاوزة وأحداث بادئة اليوم: الخط ينطلق من أعلى المربع
                          // أحداث وسطى: الخط يمتد من أعلى (-4px) للتواصل مع اليوم السابق
                          const top = (isCarryOverItem || pos === 'start') ? '0' : '-4px';
                          const bottom = pos === 'end' ? '0' : '-4px';
                          return (
                            <div key={si.SubtaskID} className="absolute rounded-full" style={{
                              left: `${siLane * 7 + 2}px`,
                              width: '3px',
                              top,
                              bottom,
                              backgroundColor: siColor,
                            }} />
                          );
                        })}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
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
                            {[...visibleShared]
                              .sort((a, b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime())
                              .map((item) => {
                              const pos = item._spanPos;
                              const isFirstVisible = firstVisibleDayMap.get(item.SubtaskID) === d.key;
                              if (pos !== 'single' && !(isFirstVisible && pos === 'start')) return null;
                              const spanning = pos === 'start';
                              const color = spanning ? getSpanColor(item.SubtaskID) : undefined;
                              const timePrefix = formatEventTime(item.DueDate);
                              const pastDue = isPastDueToday(item.DueDate);
                              const completed = !!item.IsCompleted;
                              return (
                                <div key={`${item.SubtaskID}-${pos}`} className={`text-xs ${pastDue ? 'opacity-50' : ''}`}>
                                  <button
                                    type="button"
                                    style={{ color }}
                                    className={`font-semibold hover:underline cursor-pointer text-right w-full break-words block ${completed ? 'line-through' : ''}`}
                                    onClick={() => openTaskInNewTab(item.TaskID)}
                                  >
                                    {timePrefix}{item.SubtaskTitle}{item.AssignedToName ? ` (${item.AssignedToName})` : ''}
                                  </button>
                                  <div style={{ color }} className="opacity-70">ضمن: {item.TaskTitle}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {visiblePersonal.length > 0 && (
                          <div className="space-y-1 text-right mt-1">
                            {[...visiblePersonal]
                              .sort((a, b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime())
                              .map((it) => {
                                const pastDue = isPastDueToday(it.DueDate);
                                const completed = !!it.IsCompleted;
                                return (
                              <div key={it.SubtaskID} className={`text-xs ${pastDue ? 'opacity-50' : ''}`}>
                                <button
                                  type="button"
                                  onClick={() => openTaskInNewTab(it.TaskID)}
                                  className={`font-semibold text-emerald-800 dark:text-emerald-200 hover:underline text-right w-full block ${completed ? 'line-through' : ''}`}
                                >
                                  {formatEventTime(it.DueDate)}{it.SubtaskTitle}
                                </button>
                                <div className="text-[10px] text-emerald-600 dark:text-emerald-400">ضمن: {it.TaskTitle}</div>
                              </div>
                                );
                              })}
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
                                {formatEventTime(comment.CreatedAt)}{comment.Content}
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

          {(() => {
            type ExtraEntry =
              | { kind: 'subtask';  date: string; item: CalendarItem }
              | { kind: 'personal'; date: string; item: CalendarItem }
              | { kind: 'comment';  date: string; comment: CalendarCommentItem };

            const filteredExtraWork = viewFilter === 'personal' ? []
              : viewFilter === 'vacancy' ? extraItems.filter(it => !it.PersonalOwnerUserID && String(it.AssignedToID) === String(actorId))
              : extraItems.filter(it => !it.PersonalOwnerUserID);
            const filteredExtraPersonal = (viewFilter === 'both' || viewFilter === 'personal')
              ? extraItems.filter(it => it.PersonalOwnerUserID)
              : [];
            const filteredExtraComments = viewFilter === 'personal'
              ? extraCommentEvents.filter(c => c.PersonalOwnerUserID)
              : viewFilter === 'both'
                ? extraCommentEvents
                : extraCommentEvents.filter(c => !c.PersonalOwnerUserID);

            if (filteredExtraWork.length === 0 && filteredExtraPersonal.length === 0 && filteredExtraComments.length === 0) return null;

            // آخر يوم مرئي في النطاق (اليوم + 30) — يجب حسابه قبل بناء merged
            const gridEndDate = dateRange.length > 0
              ? new Date(dateRange[dateRange.length - 1].date.getTime() + 86400000)
              : null;

            const merged: ExtraEntry[] = [
              ...filteredExtraWork.map(item => {
                // مهمة بدأت ضمن الـ30 يوم ونهايتها بعدها → نرتّبها ونعرضها بتاريخ النهاية
                const isEnd = !!item.EndDate && !!gridEndDate && new Date(item.DueDate) < gridEndDate;
                return { kind: 'subtask' as const, date: isEnd ? item.EndDate! : item.DueDate, item };
              }),
              ...filteredExtraPersonal.map(item => ({ kind: 'personal' as const, date: item.DueDate, item })),
              ...filteredExtraComments.map(comment => ({ kind: 'comment' as const, date: comment.CreatedAt, comment })),
            ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            return (
              <div>
                <h3 className="text-sm font-bold text-content mb-2">أحداث بعد 30 يوم</h3>
                <ul className="space-y-2">
                  {merged.map((entry) => {
                    const dateLabel = new Date(entry.date).toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
                    if (entry.kind === 'subtask') {
                      const item = entry.item;
                      // (نهاية): مهمة بدأت ضمن الـ30 يوم ونهايتها بعدها
                      const isEndMarker = !!item.EndDate && !!gridEndDate && new Date(item.DueDate) < gridEndDate;
                      const timePrefix = formatEventTime(isEndMarker ? item.EndDate! : item.DueDate);
                      const pastDue = isPastDueToday(item.DueDate);
                      const completed = !!item.IsCompleted;
                      return (
                        <li key={`s-${item.SubtaskID}`} className={`p-2 rounded bg-white/60 dark:bg-gray-800/60 border border-content/10 text-right ${pastDue ? 'opacity-50' : ''}`}>
                          <div className="text-xs text-content-secondary mb-1">{timePrefix}{dateLabel}</div>
                          <div className="text-xs">
                            <button
                              type="button"
                              className={`font-semibold text-blue-800 dark:text-blue-200 hover:underline cursor-pointer text-right ${completed ? 'line-through' : ''}`}
                              onClick={() => openTaskInNewTab(item.TaskID)}
                            >
                              {isEndMarker ? '(نهاية) ' : ''}{item.SubtaskTitle}{item.AssignedToName ? ` (${item.AssignedToName})` : ''}
                            </button>
                            <div className="text-blue-600 dark:text-blue-300">ضمن: {item.TaskTitle}</div>
                          </div>
                        </li>
                      );
                    } else if (entry.kind === 'personal') {
                      const it = entry.item;
                      const timePrefix = formatEventTime(it.DueDate);
                      const pastDue = isPastDueToday(it.DueDate);
                      const completed = !!it.IsCompleted;
                      return (
                        <li key={`p-${it.SubtaskID}`} className={`p-2 rounded bg-white/60 dark:bg-gray-800/60 border border-emerald-200 dark:border-emerald-800 text-right ${pastDue ? 'opacity-50' : ''}`}>
                          <div className="text-xs text-content-secondary mb-1">{timePrefix}{dateLabel}</div>
                          <div className="text-xs">
                            <button
                              type="button"
                              onClick={() => openTaskInNewTab(it.TaskID)}
                              className={`font-semibold text-emerald-800 dark:text-emerald-200 hover:underline text-right w-full block ${completed ? 'line-through' : ''}`}
                            >
                              {it.SubtaskTitle}
                            </button>
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400">ضمن: {it.TaskTitle}</div>
                          </div>
                        </li>
                      );
                    } else {
                      const comment = entry.comment;
                      return (
                        <li key={`c-${comment.CommentID}`} className="p-2 rounded bg-white/60 dark:bg-gray-800/60 border border-content/10 text-right">
                          <div className="text-xs text-content-secondary mb-1">{formatEventTime(comment.CreatedAt)}{dateLabel}</div>
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
                      );
                    }
                  })}
                </ul>
              </div>
            );
          })()}

        </div>
      )}
    </aside>
  );
};

export default SidebarCalendar;
