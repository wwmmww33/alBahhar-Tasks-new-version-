import { useEffect, useMemo, useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CurrentUser } from '../types';

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

type PersonalEventItem = {
  EventID: number;
  Title: string;
  EventDate: string;
};

type CalendarCommentItem = {
  CommentID: number;
  TaskID: number;
  TaskTitle: string;
  Content: string;
  CreatedAt: string;
  CommentedByName?: string;
};

type ViewMode = 'month' | 'week' | 'day';
type ViewFilter = 'both' | 'shared' | 'personal';
type ViewLayout = 'list' | 'grid';

type CalendarPageProps = {
  currentUser: CurrentUser;
};

const CalendarPage = ({ currentUser }: CalendarPageProps) => {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [personalEvents, setPersonalEvents] = useState<PersonalEventItem[]>([]);
  const [commentEvents, setCommentEvents] = useState<CalendarCommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('both');
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [viewLayout, setViewLayout] = useState<ViewLayout>('grid');
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDate, setNewEventDate] = useState(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  });
  const [submittingEvent, setSubmittingEvent] = useState(false);
  const [editingEventId, setEditingEventId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDate, setEditDate] = useState('');

  const openTaskInNewTab = (taskId: number) => {
    window.open(`/task/${taskId}`, '_blank', 'noopener,noreferrer');
  };

  const SPAN_COLORS = [
    '#3b82f6', '#22c55e', '#a855f7', '#f97316',
    '#ec4899', '#14b8a6', '#ef4444', '#eab308',
  ];
  const getSpanColor = (subtaskId: number) => SPAN_COLORS[subtaskId % SPAN_COLORS.length];

  const toLocalYMD = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  const computeRange = (mode: ViewMode, ref: Date) => {
    const base = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    if (mode === 'day') {
      const start = base;
      return { start, days: 1 };
    }
    if (mode === 'week') {
      const start = new Date(base);
      const dayIndex = start.getDay();
      start.setDate(start.getDate() - dayIndex);
      return { start, days: 7 };
    }
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    const diffMs = end.getTime() - start.getTime();
    const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return { start, days };
  };

  useEffect(() => {
    const fetchCalendar = async () => {
      setLoading(true);
      setError(null);
      try {
        const { start, days } = computeRange(viewMode, currentDate);
        const startStr = toLocalYMD(start);
        const now = new Date();
        const isPastMonth =
          currentDate.getFullYear() < now.getFullYear() ||
          (currentDate.getFullYear() === now.getFullYear() &&
            currentDate.getMonth() < now.getMonth());
        const params = new URLSearchParams({
          userId: String(currentUser.UserID),
          startDate: startStr,
          days: String(days),
        });
        if (isPastMonth) {
          params.append('includePast', 'true');
        }

        const subtasksRes = await fetch(`/api/calendar/subtasks?${params.toString()}`);
        if (!subtasksRes.ok) {
          throw new Error(`Calendar subtasks fetch failed: ${subtasksRes.status}`);
        }
        const subtasksCt = subtasksRes.headers.get('content-type') || '';
        let subtasksData: any = [];
        try {
          subtasksData = subtasksCt.includes('application/json') ? await subtasksRes.json() : [];
        } catch (_) {
          subtasksData = [];
        }
        setItems(Array.isArray(subtasksData) ? subtasksData : []);

        try {
          const personalRes = await fetch(
            `/api/calendar/personal-events?${params.toString()}`
          );
          if (personalRes.ok) {
            const pct = personalRes.headers.get('content-type') || '';
            const personalData = pct.includes('application/json') ? await personalRes.json() : [];
            setPersonalEvents(Array.isArray(personalData) ? personalData : []);
          } else {
            setPersonalEvents([]);
          }
        } catch (_) {
          setPersonalEvents([]);
        }

        try {
          const commentsRes = await fetch(
            `/api/calendar/comments?${params.toString()}`
          );
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
      } catch (err: any) {
        setItems([]);
        setPersonalEvents([]);
        setCommentEvents([]);
        setError(err?.message || 'حدث خطأ أثناء جلب بيانات التقويم.');
      } finally {
        setLoading(false);
      }
    };

    fetchCalendar();
  }, [currentUser.UserID, viewMode, currentDate]);

  useEffect(() => {
    const handleCommentUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ CommentID?: number | string; ShowInCalendar?: boolean }>).detail;
      const commentId = Number(detail?.CommentID);
      const shouldShow = detail?.ShowInCalendar === true;

      if (!Number.isFinite(commentId)) {
        setCurrentDate((prev) => new Date(prev.getTime()));
        return;
      }

      if (shouldShow) {
        setCurrentDate((prev) => new Date(prev.getTime()));
        return;
      }

      setCommentEvents((prev) => prev.filter((comment) => Number(comment.CommentID) !== commentId));
    };

    window.addEventListener('calendar:comment:updated', handleCommentUpdated as EventListener);
    return () => {
      window.removeEventListener('calendar:comment:updated', handleCommentUpdated as EventListener);
    };
  }, []);

  const dateRange = useMemo(() => {
    const { start, days } = computeRange(viewMode, currentDate);
    const daysArr: { key: string; date: Date; label: string }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = toLocalYMD(d);
      const label = d.toLocaleDateString('ar-EG', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      daysArr.push({ key, date: d, label });
    }
    return daysArr;
  }, [viewMode, currentDate]);

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
          const isLast = cur.getTime() === endNorm.getTime();
          const pos: SpanPos = isFirst && isLast ? 'single' : isFirst ? 'start' : isLast ? 'end' : 'middle';
          map[key].push({ ...it, _spanPos: pos });
          cur.setDate(cur.getDate() + 1);
          safety++;
        }
      }
    }
    return map;
  }, [items]);

  const personalByDay = useMemo(() => {
    const map: Record<string, PersonalEventItem[]> = {};
    for (const ev of personalEvents) {
      const d = new Date(ev.EventDate);
      const key = toLocalYMD(d);
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    }
    return map;
  }, [personalEvents]);

  const commentsByDay = useMemo(() => {
    const map: Record<string, CalendarCommentItem[]> = {};
    for (const comment of commentEvents) {
      const d = new Date(comment.CreatedAt);
      const key = toLocalYMD(d);
      if (!map[key]) map[key] = [];
      map[key].push(comment);
    }
    return map;
  }, [commentEvents]);

  const handlePrev = () => {
    setCurrentDate((prev) => {
      const d = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate());
      if (viewMode === 'day') {
        d.setDate(d.getDate() - 1);
      } else if (viewMode === 'week') {
        d.setDate(d.getDate() - 7);
      } else {
        d.setMonth(d.getMonth() - 1);
      }
      return d;
    });
  };

  const handleNext = () => {
    setCurrentDate((prev) => {
      const d = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate());
      if (viewMode === 'day') {
        d.setDate(d.getDate() + 1);
      } else if (viewMode === 'week') {
        d.setDate(d.getDate() + 7);
      } else {
        d.setMonth(d.getMonth() + 1);
      }
      return d;
    });
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const rangeLabel = useMemo(() => {
    if (viewMode === 'day') {
      return currentDate.toLocaleDateString('ar-EG', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }
    const { start, days } = computeRange(viewMode, currentDate);
    if (viewMode === 'week') {
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days - 1);
      const startStr = start.toLocaleDateString('ar-EG', {
        day: 'numeric',
        month: 'long',
      });
      const endStr = end.toLocaleDateString('ar-EG', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      return `من ${startStr} إلى ${endStr}`;
    }
    return currentDate.toLocaleDateString('ar-EG', {
      month: 'long',
      year: 'numeric',
    });
  }, [viewMode, currentDate]);

  const sortedPersonalEvents = useMemo(() => {
    const copy = [...personalEvents];
    copy.sort((a, b) => {
      const ad = new Date(a.EventDate).getTime();
      const bd = new Date(b.EventDate).getTime();
      if (ad === bd) return a.EventID - b.EventID;
      return ad - bd;
    });
    return copy;
  }, [personalEvents]);

  const handleCreatePersonalEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventTitle.trim()) return;
    setSubmittingEvent(true);
    try {
      const resp = await fetch('/api/calendar/personal-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.UserID,
          title: newEventTitle.trim(),
          eventDate: newEventDate,
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`فشل إضافة الحدث الخاص (${resp.status}). ${txt}`);
      }
      const created: PersonalEventItem = await resp.json();
      setPersonalEvents(prev => {
        const merged = [...prev, created];
        merged.sort((a, b) => {
          const ad = new Date(a.EventDate).getTime();
          const bd = new Date(b.EventDate).getTime();
          if (ad === bd) return a.EventID - b.EventID;
          return ad - bd;
        });
        return merged;
      });
      setNewEventTitle('');
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      setNewEventDate(`${y}-${m}-${dd}`);
    } catch (err: any) {
      alert(err?.message || 'فشل إضافة الحدث الخاص.');
    } finally {
      setSubmittingEvent(false);
    }
  };

  const startEditEvent = (ev: PersonalEventItem) => {
    setEditingEventId(ev.EventID);
    setEditTitle(ev.Title);
    const d = new Date(ev.EventDate);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    setEditDate(`${y}-${m}-${dd}`);
  };

  const handleUpdatePersonalEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEventId) return;
    if (!editTitle.trim()) return;
    setSubmittingEvent(true);
    try {
      const resp = await fetch(`/api/calendar/personal-events/${editingEventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.UserID,
          title: editTitle.trim(),
          eventDate: editDate,
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`فشل تعديل الحدث الخاص (${resp.status}). ${txt}`);
      }
      const updated: PersonalEventItem = await resp.json();
      setPersonalEvents(prev => {
        const mapped = prev.map(ev => (ev.EventID === updated.EventID ? updated : ev));
        mapped.sort((a, b) => {
          const ad = new Date(a.EventDate).getTime();
          const bd = new Date(b.EventDate).getTime();
          if (ad === bd) return a.EventID - b.EventID;
          return ad - bd;
        });
        return mapped;
      });
      setEditingEventId(null);
      setEditTitle('');
      setEditDate('');
    } catch (err: any) {
      alert(err?.message || 'فشل تعديل الحدث الخاص.');
    } finally {
      setSubmittingEvent(false);
    }
  };

  const handleDeletePersonalEvent = async (id: number) => {
    const confirmDelete = window.confirm('هل أنت متأكد من حذف هذا الحدث الخاص؟');
    if (!confirmDelete) return;
    setSubmittingEvent(true);
    try {
      const params = new URLSearchParams({
        userId: String(currentUser.UserID),
      });
      const resp = await fetch(`/api/calendar/personal-events/${id}?${params.toString()}`, {
        method: 'DELETE',
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`فشل حذف الحدث الخاص (${resp.status}). ${txt}`);
      }
      setPersonalEvents(prev => prev.filter(ev => ev.EventID !== id));
      if (editingEventId === id) {
        setEditingEventId(null);
        setEditTitle('');
        setEditDate('');
      }
    } catch (err: any) {
      alert(err?.message || 'فشل حذف الحدث الخاص.');
    } finally {
      setSubmittingEvent(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <CalendarIcon className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">التقويم</h1>
            <p className="text-sm text-content-secondary">
              عرض {viewMode === 'month' ? 'شهري' : viewMode === 'week' ? 'أسبوعي' : 'يومي'} للمهام الفرعية والأحداث الخاصة.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode('month')}
            className={`px-3 py-1 rounded-md text-sm border ${
              viewMode === 'month'
                ? 'bg-primary text-white border-primary'
                : 'bg-white dark:bg-gray-800 text-content border-content/20'
            }`}
          >
            شهري
          </button>
          <button
            type="button"
            onClick={() => setViewMode('week')}
            className={`px-3 py-1 rounded-md text-sm border ${
              viewMode === 'week'
                ? 'bg-primary text-white border-primary'
                : 'bg-white dark:bg-gray-800 text-content border-content/20'
            }`}
          >
            أسبوعي
          </button>
          <button
            type="button"
            onClick={() => setViewMode('day')}
            className={`px-3 py-1 rounded-md text-sm border ${
              viewMode === 'day'
                ? 'bg-primary text-white border-primary'
                : 'bg-white dark:bg-gray-800 text-content border-content/20'
            }`}
          >
            يومي
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-content/5 rounded-md p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrev}
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-content/20 bg-white dark:bg-gray-800 text-sm"
          >
            <ChevronRight className="w-4 h-4" />
            السابقة
          </button>
          <button
            type="button"
            onClick={handleToday}
            className="px-3 py-1 rounded-md bg-primary text-white text-sm"
          >
            اليوم
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-content/20 bg-white dark:bg-gray-800 text-sm"
          >
            التالية
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
        <div className="text-lg font-semibold text-right">{rangeLabel}</div>
      </div>

      <div className="flex items-center gap-2 justify-end">
        <span className="text-xs text-content-secondary">عرض الأحداث:</span>
        <button
          type="button"
          onClick={() => setViewFilter('both')}
          className={`px-2 py-1 text-xs rounded border ${
            viewFilter === 'both'
              ? 'bg-primary text-white border-primary'
              : 'bg-white dark:bg-gray-700 text-content border-content/20'
          }`}
        >
          مشترك + خاص
        </button>
        <button
          type="button"
          onClick={() => setViewFilter('shared')}
          className={`px-2 py-1 text-xs rounded border ${
            viewFilter === 'shared'
              ? 'bg-primary text-white border-primary'
              : 'bg-white dark:bg-gray-700 text-content border-content/20'
          }`}
        >
          مشترك فقط
        </button>
        <button
          type="button"
          onClick={() => setViewFilter('personal')}
          className={`px-2 py-1 text-xs rounded border ${
            viewFilter === 'personal'
              ? 'bg-primary text-white border-primary'
              : 'bg-white dark:bg-gray-700 text-content border-content/20'
          }`}
        >
          خاص فقط
        </button>
      </div>

      {loading ? (
        <div className="text-center text-content-secondary mt-8">جاري تحميل بيانات التقويم...</div>
      ) : error ? (
        <div className="text-center text-red-600 mt-8">{error}</div>
      ) : (
        <>
          {viewMode === 'month' && (
            <div className="flex items-center gap-2 justify-end">
              <span className="text-xs text-content-secondary">طريقة عرض الشهر:</span>
              <button
                type="button"
                onClick={() => setViewLayout('list')}
                className={`px-2 py-1 text-xs rounded border ${
                  viewLayout === 'list'
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white dark:bg-gray-700 text-content border-content/20'
                }`}
              >
                قائمة الأيام
              </button>
              <button
                type="button"
                onClick={() => setViewLayout('grid')}
                className={`px-2 py-1 text-xs rounded border ${
                  viewLayout === 'grid'
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white dark:bg-gray-700 text-content border-content/20'
                }`}
              >
                شبكة مربعات
              </button>
            </div>
          )}

          {viewMode === 'month' && viewLayout === 'grid' ? (
            <div className="mt-3 border rounded-lg overflow-hidden">
              <div className="grid grid-cols-7 bg-content/5 text-xs font-semibold text-center py-2">
                {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((label) => (
                  <div key={label}>{label}</div>
                ))}
              </div>
              <div className="border-t border-content/10">
                {(() => {
                  if (dateRange.length === 0) return null;
                  const firstDate = dateRange[0].date;
                  const startOffset = firstDate.getDay();
                  const cells: { key: string; date: Date | null }[] = [];
                  for (let i = 0; i < startOffset; i++) cells.push({ key: `empty-${i}`, date: null });
                  for (const d of dateRange) cells.push({ key: d.key, date: d.date });

                  // تقسيم إلى أسابيع
                  const weeks: typeof cells[] = [];
                  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, Math.min(i + 7, cells.length)));

                  // الأحداث الممتدة (بتاريخ انتهاء) - للأشرطة
                  const spanItems = viewFilter !== 'personal' ? items.filter(it => !!it.EndDate) : [];
                  // الأحداث ليوم واحد - للخلايا
                  const singleDayMap: Record<string, CalendarItem[]> = {};
                  for (const it of items.filter(it => !it.EndDate)) {
                    const key = toLocalYMD(new Date(it.DueDate));
                    if (!singleDayMap[key]) singleDayMap[key] = [];
                    singleDayMap[key].push(it);
                  }

                  const todayKey = toLocalYMD(new Date());

                  return weeks.map((week, weekIdx) => {
                    const validCells = week.filter(c => c.date !== null);
                    if (validCells.length === 0) return <div key={`week-empty-${weekIdx}`} className="grid grid-cols-7">{week.map((c,i) => <div key={c.key+i} className="h-24 border border-content/10 bg-transparent" />)}</div>;

                    const wd0 = validCells[0].date!;
                    const wdN = validCells[validCells.length - 1].date!;
                    const weekStartD = new Date(wd0.getFullYear(), wd0.getMonth(), wd0.getDate());
                    const weekEndD   = new Date(wdN.getFullYear(), wdN.getMonth(), wdN.getDate());

                    // بناء أشرطة الأسبوع
                    type BarInfo = { item: CalendarItem; startCol: number; endCol: number; lane: number; isFirst: boolean; isLast: boolean };
                    const bars: BarInfo[] = [];

                    for (const item of spanItems) {
                      const dD = new Date(item.DueDate); const dueD = new Date(dD.getFullYear(), dD.getMonth(), dD.getDate());
                      const eD = new Date(item.EndDate!); const endD = new Date(eD.getFullYear(), eD.getMonth(), eD.getDate());
                      if (dueD > weekEndD || endD < weekStartD) continue;

                      const clampedStart = dueD < weekStartD ? weekStartD : dueD;
                      const clampedEnd   = endD > weekEndD   ? weekEndD   : endD;

                      const startCol = week.findIndex(c => c.date && toLocalYMD(c.date) === toLocalYMD(clampedStart));
                      const endCol   = week.findIndex(c => c.date && toLocalYMD(c.date) === toLocalYMD(clampedEnd));
                      if (startCol === -1 || endCol === -1) continue;

                      let lane = 0;
                      while (bars.some(b => b.lane === lane && b.startCol <= endCol && b.endCol >= startCol)) lane++;

                      bars.push({ item, startCol, endCol, lane, isFirst: dueD >= weekStartD, isLast: endD <= weekEndD });
                    }

                    const maxLane = bars.length > 0 ? Math.max(...bars.map(b => b.lane)) : -1;
                    const barAreaH = maxLane >= 0 ? (maxLane + 1) * 22 + 4 : 0;

                    return (
                      <div key={weekIdx}>
                        {/* منطقة أشرطة الأحداث الممتدة */}
                        {barAreaH > 0 && (
                          <div className="relative bg-content/[0.02]" style={{ height: `${barAreaH}px` }}>
                            {/* خطوط الأعمدة */}
                            <div className="absolute inset-0 grid grid-cols-7 pointer-events-none">
                              {week.map((_c, i) => <div key={i} className="border-r border-content/10 last:border-r-0 h-full" />)}
                            </div>
                            {/* الأشرطة */}
                            {bars.map(bar => {
                              const barColor = getSpanColor(bar.item.SubtaskID);
                              return (
                              <button
                                key={bar.item.SubtaskID}
                                type="button"
                                onClick={() => openTaskInNewTab(bar.item.TaskID)}
                                title={`${bar.item.SubtaskTitle} — ضمن: ${bar.item.TaskTitle}`}
                                style={{
                                  position: 'absolute',
                                  top:   `${bar.lane * 22 + 2}px`,
                                  right:  `calc(${(bar.startCol / 7) * 100}% + ${bar.isFirst ? 2 : 0}px)`,
                                  width: `calc(${((bar.endCol - bar.startCol + 1) / 7) * 100}% - ${(bar.isFirst ? 2 : 0) + (bar.isLast ? 2 : 0)}px)`,
                                  height: '18px',
                                  backgroundColor: barColor,
                                }}
                                className={[
                                  'text-white text-[9px] px-2 flex items-center overflow-hidden whitespace-nowrap z-10',
                                  bar.isFirst ? 'rounded-r-full' : '',
                                  bar.isLast  ? 'rounded-l-full' : '',
                                ].join(' ')}
                              >
                                {bar.isFirst && bar.item.SubtaskTitle}
                              </button>
                              );
                            })}
                          </div>
                        )}

                        {/* خلايا الأيام */}
                        <div className="grid grid-cols-7">
                          {week.map((cell, colIdx) => {
                            if (!cell.date) {
                              return <div key={cell.key + colIdx} className="h-24 border border-content/10 bg-transparent" />;
                            }
                            const key = toLocalYMD(cell.date);
                            const isToday = key === todayKey;
                            const sharedForDay   = viewFilter !== 'personal' ? (singleDayMap[key] || []) : [];
                            const personalForDay = viewFilter !== 'shared'   ? (personalByDay[key] || []) : [];
                            const commentsForDay = viewFilter !== 'shared'   ? (commentsByDay[key] || []) : [];
                            const hasBarOnDay    = bars.some(b => b.startCol <= colIdx && b.endCol >= colIdx);
                            const hasEvents = sharedForDay.length > 0 || personalForDay.length > 0 || commentsForDay.length > 0 || hasBarOnDay;

                            return (
                              <div
                                key={key}
                                className={`h-24 border p-1 flex flex-col ${
                                  isToday
                                    ? 'bg-yellow-100 dark:bg-yellow-900 border-yellow-400 dark:border-yellow-500'
                                    : hasEvents
                                      ? 'bg-white dark:bg-gray-900 border-content/10'
                                      : 'bg-white/60 dark:bg-gray-900/40 border-content/10'
                                }`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className={`text-xs font-semibold ${isToday ? 'bg-primary text-white rounded-full px-1' : ''}`}>
                                    {cell.date.getDate()}
                                  </span>
                                  {(sharedForDay.length > 0 || personalForDay.length > 0 || commentsForDay.length > 0) && (
                                    <span className="w-2 h-2 rounded-full bg-primary inline-block" />
                                  )}
                                </div>
                                <div className="space-y-0.5 overflow-y-auto">
                                  {sharedForDay.slice(0, 2).map((item) => (
                                    <button key={item.SubtaskID} type="button" onClick={() => openTaskInNewTab(item.TaskID)} className="text-[10px] text-right text-blue-800 dark:text-blue-200 hover:underline w-full">
                                      <div>{item.SubtaskTitle}{item.AssignedToName ? ` (${item.AssignedToName})` : ''}</div>
                                      <div className="text-[9px] text-blue-600 dark:text-blue-300">ضمن: {item.TaskTitle}</div>
                                    </button>
                                  ))}
                                  {personalForDay.slice(0, 1).map((ev) => (
                                    <div key={ev.EventID} className="text-[10px] text-right">
                                      <span className="text-green-800 dark:text-green-200">{ev.Title}</span>
                                    </div>
                                  ))}
                                  {commentsForDay.slice(0, 1).map((comment) => (
                                    <button key={comment.CommentID} type="button" onClick={() => openTaskInNewTab(comment.TaskID)} className="text-[10px] text-right text-purple-800 dark:text-purple-200 hover:underline w-full">
                                      <div>{comment.Content}</div>
                                      <div className="text-[9px] text-content-secondary">ضمن: {comment.TaskTitle}</div>
                                    </button>
                                  ))}
                                  {hasEvents && (sharedForDay.length > 2 || personalForDay.length > 1 || commentsForDay.length > 1) && (
                                    <div className="text-[10px] text-content-secondary text-right">المزيد...</div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          ) : (
            <div className="space-y-3 mt-3">
              {dateRange.map((d) => {
                const sharedForDay = itemsByDay[d.key] || [];
                const personalForDay = personalByDay[d.key] || [];
                const commentsForDay = commentsByDay[d.key] || [];
                const visibleShared = viewFilter !== 'personal' ? sharedForDay : [];
                const visiblePersonal = viewFilter !== 'shared' ? personalForDay : [];
                const visibleComments = viewFilter !== 'shared' ? commentsForDay : [];
                const hasEvents =
                  visibleShared.length > 0 ||
                  visiblePersonal.length > 0 ||
                  visibleComments.length > 0;
                const todayKey = toLocalYMD(new Date());
                const isToday = d.key === todayKey;

                return (
                  <div
                    key={d.key}
                    className={`border rounded-lg p-3 ${
                      isToday
                        ? 'bg-yellow-100 dark:bg-yellow-900 border-yellow-400 dark:border-yellow-500'
                        : hasEvents
                          ? 'bg-white dark:bg-gray-900 border-blue-300 dark:border-blue-700'
                          : 'bg-white/60 dark:bg-gray-900/40 border-content/10'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div
                        className={`text-sm font-semibold text-right ${
                          isToday ? 'text-primary' : ''
                        }`}
                      >
                        {d.label}
                      </div>
                      {!hasEvents && (
                        <div className="text-xs text-content-secondary">لا توجد أحداث في هذا اليوم.</div>
                      )}
                    </div>
                    {visibleShared.length > 0 && (
                      <div className="space-y-1 text-right">
                        {visibleShared.map((item) => {
                          if (item._spanPos === 'middle' || item._spanPos === 'end') return null;
                          const spanning = item._spanPos === 'start';
                          const color = spanning ? getSpanColor(item.SubtaskID) : undefined;
                          return (
                            <div key={`${item.SubtaskID}-${item._spanPos}`} className="text-xs">
                              <button
                                type="button"
                                onClick={() => openTaskInNewTab(item.TaskID)}
                                style={{ color }}
                                className="font-semibold hover:underline"
                              >
                                {item.SubtaskTitle}
                                {item.AssignedToName ? ` (${item.AssignedToName})` : ''}
                              </button>
                              <div className="opacity-70">ضمن: {item.TaskTitle}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {visiblePersonal.length > 0 && (
                      <div className="space-y-1 text-right mt-2">
                        {visiblePersonal.map((ev) => (
                          <div key={ev.EventID} className="text-xs">
                            <span className="font-semibold text-green-800 dark:text-green-200">{ev.Title}</span>
                            <span className="ml-1 inline-block text-[10px] text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/30 px-1 py-[1px] rounded">
                              (خاص)
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {visibleComments.length > 0 && (
                      <div className="space-y-1 text-right mt-2">
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
                );
              })}
            </div>
          )}

          <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border rounded-lg p-4 bg-white/80 dark:bg-gray-900/80 border-content/10">
              <h2 className="text-lg font-semibold mb-3 text-right">إضافة حدث خاص</h2>
              <form onSubmit={handleCreatePersonalEvent} className="space-y-3">
                <div className="flex flex-col gap-1">
                  <label className="text-sm text-right">عنوان الحدث</label>
                  <input
                    type="text"
                    value={newEventTitle}
                    onChange={(e) => setNewEventTitle(e.target.value)}
                    className="border border-content/20 rounded px-3 py-2 text-sm text-right bg-white dark:bg-gray-800"
                    disabled={submittingEvent}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm text-right">تاريخ الحدث</label>
                  <input
                    type="date"
                    value={newEventDate}
                    onChange={(e) => setNewEventDate(e.target.value)}
                    className="border border-content/20 rounded px-3 py-2 text-sm text-right bg-white dark:bg-gray-800"
                    disabled={submittingEvent}
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submittingEvent || !newEventTitle.trim()}
                    className="px-4 py-2 rounded-md bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    حفظ الحدث
                  </button>
                </div>
              </form>
            </div>

            <div className="border rounded-lg p-4 bg-white/80 dark:bg-gray-900/80 border-content/10">
              <h2 className="text-lg font-semibold mb-3 text-right">إدارة الأحداث الخاصة</h2>
              {sortedPersonalEvents.length === 0 ? (
                <div className="text-sm text-content-secondary text-right">
                  لا توجد أحداث خاصة حالياً في الفترة المعروضة.
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {sortedPersonalEvents.map((ev) =>
                    editingEventId === ev.EventID ? (
                      <form
                        key={ev.EventID}
                        onSubmit={handleUpdatePersonalEvent}
                        className="flex flex-col gap-2 border rounded-md p-2 bg-content/5"
                      >
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="border border-content/20 rounded px-2 py-1 text-sm text-right bg-white dark:bg-gray-800"
                          disabled={submittingEvent}
                        />
                        <input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          className="border border-content/20 rounded px-2 py-1 text-sm text-right bg-white dark:bg-gray-800"
                          disabled={submittingEvent}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEventId(null);
                              setEditTitle('');
                              setEditDate('');
                            }}
                            className="px-3 py-1 rounded-md border border-content/30 text-sm"
                            disabled={submittingEvent}
                          >
                            إلغاء
                          </button>
                          <button
                            type="submit"
                            disabled={submittingEvent || !editTitle.trim()}
                            className="px-3 py-1 rounded-md bg-primary text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            حفظ
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div
                        key={ev.EventID}
                        className="flex items-center justify-between border border-content/10 rounded-md px-3 py-2 text-sm bg-white/70 dark:bg-gray-800/70"
                      >
                        <div className="flex-1 text-right">
                          <div className="font-semibold text-green-800 dark:text-green-200">
                            {ev.Title}
                          </div>
                          <div className="text-xs text-content-secondary">
                            {new Date(ev.EventDate).toLocaleDateString('ar-EG', {
                              weekday: 'long',
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                            })}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-3">
                          <button
                            type="button"
                            onClick={() => startEditEvent(ev)}
                            className="px-2 py-1 text-xs rounded-md border border-primary text-primary hover:bg-primary/10"
                            disabled={submittingEvent}
                          >
                            تعديل
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePersonalEvent(ev.EventID)}
                            className="px-2 py-1 text-xs rounded-md border border-red-500 text-red-600 hover:bg-red-500/10"
                            disabled={submittingEvent}
                          >
                            حذف
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CalendarPage;
