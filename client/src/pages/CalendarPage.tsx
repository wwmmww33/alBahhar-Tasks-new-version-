import { useEffect, useMemo, useState, Fragment } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, FileDown } from 'lucide-react';
import type { CurrentUser } from '../types';
import { resolveCurrentActorId } from '../utils/actorIdentity';
import { exportCalendarToPdf } from '../utils/calendarPdfExport';

type CalendarItem = {
  SubtaskID: number;
  TaskID: number;
  SubtaskTitle: string;
  TaskTitle: string;
  DueDate: string;
  EndDate?: string | null;
  AssignedToName?: string;
  AssignedToID?: string | null;
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
type ViewFilter = 'both' | 'shared' | 'vacancy' | 'personal';
type ViewLayout = 'list' | 'grid';

type CalendarPageProps = {
  currentUser: CurrentUser;
};

const CalendarPage = ({ currentUser }: CalendarPageProps) => {
  const actorId = resolveCurrentActorId(currentUser) || currentUser.UserID;
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [personalEvents, setPersonalEvents] = useState<PersonalEventItem[]>([]);
  const [commentEvents, setCommentEvents] = useState<CalendarCommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('both');
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [viewLayout, setViewLayout] = useState<ViewLayout>('grid');
  const [hideEmptyDays, setHideEmptyDays] = useState(false);
  const [hideContinuationOnly, setHideContinuationOnly] = useState(false);
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

  const displayItems = useMemo(() => {
    if (viewFilter === 'personal') return [];
    if (viewFilter === 'vacancy') return items.filter(it => String(it.AssignedToID) === String(actorId));
    return items;
  }, [items, viewFilter, actorId]);

  const itemsByDay = useMemo(() => {
    const map: Record<string, CalendarItemWithSpan[]> = {};
    for (const it of displayItems) {
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
  }, [displayItems]);

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

  // أشرطة الامتداد الرأسية لعرض القائمة/اليومي
  const verticalBars = useMemo(() => {
    if (!dateRange.length) return [] as { item: CalendarItem; startKey: string; endKey: string; lane: number }[];
    const rangeStartKey = dateRange[0].key;
    const rangeEndKey   = dateRange[dateRange.length - 1].key;
    const bars: { item: CalendarItem; startKey: string; endKey: string; lane: number }[] = [];
    for (const item of displayItems.filter(it => !!it.EndDate)) {
      const dD = new Date(item.DueDate);
      const eD = new Date(item.EndDate!);
      const dueKey = toLocalYMD(new Date(dD.getFullYear(), dD.getMonth(), dD.getDate()));
      const endKey = toLocalYMD(new Date(eD.getFullYear(), eD.getMonth(), eD.getDate()));
      if (dueKey > rangeEndKey || endKey < rangeStartKey) continue;
      const startKey = dueKey < rangeStartKey ? rangeStartKey : dueKey;
      const endKeyC  = endKey > rangeEndKey   ? rangeEndKey   : endKey;
      let lane = 0;
      while (bars.some(b => b.lane === lane && !(b.endKey < startKey || b.startKey > endKeyC))) lane++;
      bars.push({ item, startKey, endKey: endKeyC, lane });
    }
    return bars;
  }, [displayItems, dateRange]);
  const maxVLane = verticalBars.length > 0 ? Math.max(...verticalBars.map(b => b.lane)) : -1;

  // مهام بدأت قبل الفترة الحالية وتمتد خلالها
  const priorSpans = useMemo(() => {
    if (!dateRange.length) return [];
    const rangeStart = new Date(dateRange[0].date);
    rangeStart.setHours(0, 0, 0, 0);
    return displayItems.filter(it => {
      if (!it.EndDate) return false;
      const dueD = new Date(it.DueDate);
      dueD.setHours(0, 0, 0, 0);
      const endD = new Date(it.EndDate);
      endD.setHours(0, 0, 0, 0);
      return dueD < rangeStart && endD >= rangeStart;
    });
  }, [dateRange, displayItems]);

  const filteredListRange = useMemo(() => {
    if (!hideEmptyDays && !hideContinuationOnly) return dateRange;
    return dateRange.filter(d => {
      const sharedForDay   = itemsByDay[d.key] || [];
      const personalForDay = personalByDay[d.key] || [];
      const commentsForDay = commentsByDay[d.key] || [];
      const visiblePersonal = (viewFilter === 'both' || viewFilter === 'personal') ? personalForDay : [];
      const visibleComments = viewFilter !== 'personal' ? commentsForDay : [];
      const hasAnyEvents = sharedForDay.length > 0 || visiblePersonal.length > 0 || visibleComments.length > 0;
      if (hideEmptyDays && !hasAnyEvents) return false;
      if (hideContinuationOnly) {
        const hasNonCont = sharedForDay.some(it => it._spanPos === 'start' || it._spanPos === 'single') ||
                           visiblePersonal.length > 0 || visibleComments.length > 0;
        if (!hasNonCont) return false;
      }
      return true;
    });
  }, [dateRange, itemsByDay, personalByDay, commentsByDay, viewFilter, hideEmptyDays, hideContinuationOnly]);

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

      <div className="flex items-center gap-2 justify-end flex-wrap">
        <span className="text-xs text-content-secondary">عرض الأحداث:</span>
        <button
          type="button"
          onClick={() => setViewFilter('both')}
          className={`px-2 py-1 text-xs rounded border ${
            viewFilter === 'both'
              ? 'bg-primary text-white border-primary'
              : 'bg-white dark:bg-gray-700 text-content border-content/20'
          }`}
        >الكل</button>
        <button
          type="button"
          onClick={() => setViewFilter('shared')}
          className={`px-2 py-1 text-xs rounded border ${
            viewFilter === 'shared'
              ? 'bg-primary text-white border-primary'
              : 'bg-white dark:bg-gray-700 text-content border-content/20'
          }`}
        >القسم</button>
        <button
          type="button"
          onClick={() => setViewFilter('vacancy')}
          className={`px-2 py-1 text-xs rounded border ${
            viewFilter === 'vacancy'
              ? 'bg-primary text-white border-primary'
              : 'bg-white dark:bg-gray-700 text-content border-content/20'
          }`}
        >المنصب</button>
        <button
          type="button"
          onClick={() => setViewFilter('personal')}
          className={`px-2 py-1 text-xs rounded border ${
            viewFilter === 'personal'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white dark:bg-gray-700 text-emerald-700 dark:text-emerald-300 border-emerald-400'
          }`}
        >الخاص</button>
      </div>

      {loading ? (
        <div className="text-center text-content-secondary mt-8">جاري تحميل بيانات التقويم...</div>
      ) : error ? (
        <div className="text-center text-red-600 mt-8">{error}</div>
      ) : (
        <>
          {(viewMode === 'month' || viewMode === 'week') && (
            <div className="flex items-center gap-2 justify-end flex-wrap">
              {viewMode === 'month' && (
                <>
                  <span className="text-xs text-content-secondary">طريقة العرض:</span>
                  <button
                    type="button"
                    onClick={() => setViewLayout('list')}
                    className={`px-2 py-1 text-xs rounded border ${
                      viewLayout === 'list'
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white dark:bg-gray-700 text-content border-content/20'
                    }`}
                  >
                    عرض قائمة
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
                </>
              )}
              {viewMode === 'month' && viewLayout === 'list' && (
                <>
                  <span className="text-xs text-content-secondary border-r border-content/20 pr-2 mr-1">إخفاء:</span>
                  <button
                    type="button"
                    onClick={() => setHideEmptyDays(v => !v)}
                    className={`px-2 py-1 text-xs rounded border ${
                      hideEmptyDays
                        ? 'bg-gray-600 text-white border-gray-600'
                        : 'bg-white dark:bg-gray-700 text-content border-content/20'
                    }`}
                    title="إخفاء الأيام التي لا توجد بها أحداث"
                  >
                    الأيام الفارغة
                  </button>
                  <button
                    type="button"
                    onClick={() => setHideContinuationOnly(v => !v)}
                    className={`px-2 py-1 text-xs rounded border ${
                      hideContinuationOnly
                        ? 'bg-gray-600 text-white border-gray-600'
                        : 'bg-white dark:bg-gray-700 text-content border-content/20'
                    }`}
                    title="إخفاء الأيام التي تحتوي فقط على أرقام معرّفات الامتداد"
                  >
                    أيام الامتداد فقط
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => exportCalendarToPdf({
                  monthLabel: rangeLabel,
                  dateRange,
                  displayItems,
                  personalByDay,
                  commentsByDay,
                })}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded border bg-white dark:bg-gray-700 text-content border-content/20 hover:bg-gray-50 dark:hover:bg-gray-600"
                title={`تصدير التقويم ${viewMode === 'week' ? 'الأسبوعي' : 'الشهري'} كـ PDF`}
              >
                <FileDown className="w-3 h-3" />
                تصدير PDF
              </button>
            </div>
          )}

          {/* مهام بدأت قبل هذه الفترة وتمتد خلالها */}
          {priorSpans.length > 0 && (
            <div className="mt-3 border rounded-lg p-3 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700">
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-2 border-b border-amber-200 dark:border-amber-700 pb-1">
                مهام بدأت قبل {viewMode === 'month' ? 'هذا الشهر' : viewMode === 'week' ? 'هذا الأسبوع' : 'اليوم'} وتمتد خلاله
              </div>
              <div className="space-y-1">
                {priorSpans.map(it => (
                  <div key={it.SubtaskID} className="flex flex-wrap items-baseline gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => openTaskInNewTab(it.TaskID)}
                      style={{ color: getSpanColor(it.SubtaskID) }}
                      className="font-bold hover:underline flex-shrink-0"
                    >
                      {it.SubtaskID}
                    </button>
                    <span className="text-content-secondary flex-shrink-0 text-[11px]">
                      {new Date(it.DueDate).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                    <button
                      type="button"
                      onClick={() => openTaskInNewTab(it.TaskID)}
                      className="font-semibold hover:underline text-right break-words"
                    >
                      {it.SubtaskTitle}{it.AssignedToName ? ` (${it.AssignedToName})` : ''} (ضمن: {it.TaskTitle})
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {viewMode === 'month' && viewLayout === 'grid' ? (
            <div className="mt-3 border rounded-lg overflow-hidden">
              <div className="grid grid-cols-7 bg-content/5 text-xs font-semibold text-center py-2">
                {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((label, i) => (
                  <div key={label} className={i === 5 || i === 6 ? 'text-gray-400 dark:text-gray-500' : ''}>{label}</div>
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
                  const spanItems = displayItems.filter(it => !!it.EndDate);
                  // الأحداث ليوم واحد - للخلايا
                  const singleDayMap: Record<string, CalendarItem[]> = {};
                  for (const it of displayItems.filter(it => !it.EndDate)) {
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
                    const barAreaH = maxLane >= 0 ? (maxLane + 1) * 14 + 4 : 0;

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
                              <div
                                key={bar.item.SubtaskID}
                                title={`${bar.item.SubtaskTitle}${bar.item.AssignedToName ? ` (${bar.item.AssignedToName})` : ''} — ضمن: ${bar.item.TaskTitle}`}
                                style={{
                                  position: 'absolute',
                                  top:   `${bar.lane * 14 + 2}px`,
                                  right:  `calc(${(bar.startCol / 7) * 100}% + ${bar.isFirst ? 2 : 0}px)`,
                                  width: `calc(${((bar.endCol - bar.startCol + 1) / 7) * 100}% - ${(bar.isFirst ? 2 : 0) + (bar.isLast ? 2 : 0)}px)`,
                                  height: '8px',
                                  backgroundColor: barColor,
                                }}
                                className={[
                                  'z-10',
                                  bar.isFirst ? 'rounded-r-full' : '',
                                  bar.isLast  ? 'rounded-l-full' : '',
                                ].join(' ')}
                              />
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
                            const dayOfWeek = cell.date.getDay();
                            const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
                            const allCellItems   = itemsByDay[key] || [];
                            const personalForDay = (viewFilter === 'both' || viewFilter === 'personal') ? (personalByDay[key] || []) : [];
                            const commentsForDay = viewFilter !== 'personal' ? (commentsByDay[key] || []) : [];
                            const hasBarOnDay    = bars.some(b => b.startCol <= colIdx && b.endCol >= colIdx);
                            const hasEvents      = allCellItems.length > 0 || personalForDay.length > 0 || commentsForDay.length > 0 || hasBarOnDay;

                            const contSpansCell  = allCellItems
                              .filter(it => it._spanPos === 'middle' || it._spanPos === 'end')
                              .sort((a, b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime());
                            const startSpansCell = allCellItems
                              .filter(it => it._spanPos === 'start')
                              .sort((a, b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime());
                            const singlesCell    = allCellItems
                              .filter(it => it._spanPos === 'single')
                              .sort((a, b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime());

                            return (
                              <div
                                key={key}
                                className={`min-h-24 border p-1 flex flex-col ${
                                  isToday
                                    ? 'bg-yellow-100 dark:bg-yellow-900 border-yellow-400 dark:border-yellow-500'
                                    : isWeekend
                                      ? 'bg-gray-100 dark:bg-gray-800/70 border-content/10'
                                      : hasEvents
                                        ? 'bg-white dark:bg-gray-900 border-content/10'
                                        : 'bg-white/60 dark:bg-gray-900/40 border-content/10'
                                }`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className={`text-xs font-semibold ${isToday ? 'bg-primary text-white rounded-full px-1' : ''}`}>
                                    {cell.date.getDate()}
                                  </span>
                                  {(allCellItems.length > 0 || personalForDay.length > 0 || commentsForDay.length > 0) && (
                                    <span className="w-2 h-2 rounded-full bg-primary inline-block" />
                                  )}
                                </div>
                                <div className="space-y-0.5 text-[10px]">
                                  {/* 1. أرقام معرّفات الاستمرارية */}
                                  {contSpansCell.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-[2px] font-bold leading-tight">
                                      {contSpansCell.map((it, idx) => (
                                        <span key={it.SubtaskID} className="flex items-center gap-[1px]">
                                          {idx > 0 && <span className="text-gray-400 text-[9px]">|</span>}
                                          <button
                                            type="button"
                                            onClick={() => openTaskInNewTab(it.TaskID)}
                                            style={{ color: getSpanColor(it.SubtaskID) }}
                                            className="hover:underline"
                                            title={`${it.SubtaskTitle}${it.AssignedToName ? ` (${it.AssignedToName})` : ''} — ضمن: ${it.TaskTitle}`}
                                          >
                                            {it.SubtaskID}
                                          </button>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {/* 2. مهام ممتدة (يوم البداية) */}
                                  {startSpansCell.map(it => (
                                    <button
                                      key={`start-${it.SubtaskID}`}
                                      type="button"
                                      onClick={() => openTaskInNewTab(it.TaskID)}
                                      style={{ color: getSpanColor(it.SubtaskID) }}
                                      className="font-bold hover:underline text-right w-full block break-words"
                                      title={`${it.SubtaskTitle}${it.AssignedToName ? ` (${it.AssignedToName})` : ''} — ضمن: ${it.TaskTitle}`}
                                    >
                                      {it.SubtaskID}◀ {it.SubtaskTitle}{it.AssignedToName ? ` (${it.AssignedToName})` : ''} (ضمن: {it.TaskTitle})
                                    </button>
                                  ))}
                                  {/* 3. مهام يوم واحد */}
                                  {singlesCell.map(it => (
                                    <button
                                      key={`single-${it.SubtaskID}`}
                                      type="button"
                                      onClick={() => openTaskInNewTab(it.TaskID)}
                                      style={{ color: getSpanColor(it.SubtaskID) }}
                                      className="font-semibold hover:underline text-right w-full block break-words"
                                      title={`${it.SubtaskTitle}${it.AssignedToName ? ` (${it.AssignedToName})` : ''} — ضمن: ${it.TaskTitle}`}
                                    >
                                      {it.SubtaskID}◀ {it.SubtaskTitle}{it.AssignedToName ? ` (${it.AssignedToName})` : ''} (ضمن: {it.TaskTitle})
                                    </button>
                                  ))}
                                  {/* 4. أحداث خاصة */}
                                  {personalForDay.map(ev => (
                                    <div key={ev.EventID} className="font-semibold break-words" style={{ color: '#059669' }}>
                                      {ev.EventID}★ {ev.Title}
                                    </div>
                                  ))}
                                  {/* 5. تعليقات */}
                                  {commentsForDay.map(cm => (
                                    <button
                                      key={cm.CommentID}
                                      type="button"
                                      onClick={() => openTaskInNewTab(cm.TaskID)}
                                      style={{ color: '#7c3aed' }}
                                      className="hover:underline text-right w-full block break-words"
                                      title={`${cm.Content} — ضمن: ${cm.TaskTitle}`}
                                    >
                                      {cm.CommentID}💬 {cm.Content}
                                    </button>
                                  ))}
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
            <div
              className="mt-3"
              style={{
                display: 'grid',
                gridTemplateColumns: maxVLane >= 0
                  ? `${(maxVLane + 1) * 10 + maxVLane * 3}px 1fr`
                  : '1fr',
                columnGap: maxVLane >= 0 ? '8px' : '0',
                rowGap: 0,
              }}
            >
              {filteredListRange.map((d, dayIdx) => {
                const sharedForDay   = itemsByDay[d.key] || [];
                const personalForDay = personalByDay[d.key] || [];
                const commentsForDay = commentsByDay[d.key] || [];
                const visibleShared   = sharedForDay;
                const visiblePersonal = (viewFilter === 'both' || viewFilter === 'personal') ? personalForDay : [];
                const visibleComments = viewFilter !== 'personal' ? commentsForDay : [];
                const hasEvents = visibleShared.length > 0 || visiblePersonal.length > 0 || visibleComments.length > 0;
                const todayKey  = toLocalYMD(new Date());
                const isToday   = d.key === todayKey;
                const isFirst   = dayIdx === 0;
                const isLast    = dayIdx === filteredListRange.length - 1;

                const contList   = visibleShared.filter(it => it._spanPos === 'middle' || it._spanPos === 'end').sort((a,b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime());
                const startList  = visibleShared.filter(it => it._spanPos === 'start').sort((a,b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime());
                const singleList = visibleShared.filter(it => it._spanPos === 'single').sort((a,b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime());

                const dayVBars   = verticalBars.filter(b => b.startKey <= d.key && b.endKey >= d.key).sort((a,b) => a.lane - b.lane);
                const spanPosMap = new Map(visibleShared.map(it => [it.SubtaskID, it._spanPos]));

                const cardBg = isToday
                  ? 'bg-yellow-100 dark:bg-yellow-900'
                  : hasEvents ? 'bg-white dark:bg-gray-900' : 'bg-white/60 dark:bg-gray-900/40';
                const borderColor = isToday
                  ? 'border-yellow-400 dark:border-yellow-500'
                  : 'border-content/10';

                return (
                  <Fragment key={d.key}>
                    {/* خلية الأشرطة الرأسية — row-gap:0 يجعلها متصلة */}
                    {maxVLane >= 0 && (
                      <div className="flex gap-[3px]" style={{ alignSelf: 'stretch' }}>
                        {Array.from({ length: maxVLane + 1 }, (_, laneIdx) => {
                          const bar     = dayVBars.find(b => b.lane === laneIdx);
                          if (!bar) return <div key={laneIdx} className="w-2.5" />;
                          const spanPos = spanPosMap.get(bar.item.SubtaskID) ?? 'middle';
                          const isStart = spanPos === 'start';
                          const isEnd   = spanPos === 'end';
                          return (
                            <div key={laneIdx} className="w-2.5 flex flex-col" style={{ height: '100%' }}>
                              {isStart && <div style={{ height: '8px', flexShrink: 0 }} />}
                              <button
                                type="button"
                                onClick={() => openTaskInNewTab(bar.item.TaskID)}
                                title={`${bar.item.SubtaskTitle}${bar.item.AssignedToName ? ` (${bar.item.AssignedToName})` : ''} — ضمن: ${bar.item.TaskTitle}`}
                                style={{ backgroundColor: getSpanColor(bar.item.SubtaskID), flex: 1, display: 'block', width: '100%' }}
                                className={[
                                  isStart ? 'rounded-t-full' : '',
                                  isEnd   ? 'rounded-b-full' : '',
                                ].filter(Boolean).join(' ')}
                              />
                              {isEnd && <div style={{ height: '8px', flexShrink: 0 }} />}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* بطاقة اليوم */}
                    <div
                      className={[
                        'p-3 border-x border-b',
                        isFirst ? `border-t ${isLast ? 'rounded-lg' : 'rounded-t-lg'}` : '',
                        isLast && !isFirst ? 'rounded-b-lg' : '',
                        cardBg,
                        borderColor,
                      ].filter(Boolean).join(' ')}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className={`text-sm font-semibold text-right ${isToday ? 'text-primary' : ''}`}>
                          {d.label}
                        </div>
                        {!hasEvents && (
                          <div className="text-xs text-content-secondary">لا توجد أحداث في هذا اليوم.</div>
                        )}
                      </div>
                      <div className="space-y-1 text-right">
                        {contList.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 text-xs font-bold">
                            {contList.map((it, idx) => (
                              <span key={it.SubtaskID} className="flex items-center gap-0.5">
                                {idx > 0 && <span className="text-gray-400">|</span>}
                                <button type="button" onClick={() => openTaskInNewTab(it.TaskID)}
                                  style={{ color: getSpanColor(it.SubtaskID) }} className="hover:underline"
                                  title={`${it.SubtaskTitle}${it.AssignedToName ? ` (${it.AssignedToName})` : ''} — ضمن: ${it.TaskTitle}`}>
                                  {it.SubtaskID}
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {startList.map(it => (
                          <div key={`start-${it.SubtaskID}`} className="text-xs">
                            <button type="button" onClick={() => openTaskInNewTab(it.TaskID)}
                              style={{ color: getSpanColor(it.SubtaskID) }} className="font-bold hover:underline break-words text-right">
                              {it.SubtaskID}◀ {it.SubtaskTitle}{it.AssignedToName ? ` (${it.AssignedToName})` : ''} (ضمن: {it.TaskTitle})
                            </button>
                          </div>
                        ))}
                        {singleList.map(it => (
                          <div key={`single-${it.SubtaskID}`} className="text-xs">
                            <button type="button" onClick={() => openTaskInNewTab(it.TaskID)}
                              style={{ color: getSpanColor(it.SubtaskID) }} className="font-semibold hover:underline break-words text-right">
                              {it.SubtaskID}◀ {it.SubtaskTitle}{it.AssignedToName ? ` (${it.AssignedToName})` : ''} (ضمن: {it.TaskTitle})
                            </button>
                          </div>
                        ))}
                        {visiblePersonal.map(ev => (
                          <div key={ev.EventID} className="text-xs font-semibold" style={{ color: '#059669' }}>
                            {ev.EventID}★ {ev.Title}
                          </div>
                        ))}
                        {visibleComments.map(cm => (
                          <button key={cm.CommentID} type="button" onClick={() => openTaskInNewTab(cm.TaskID)}
                            className="text-xs font-semibold hover:underline text-right w-full break-words"
                            style={{ color: '#7c3aed' }}>
                            {cm.CommentID}💬 {cm.Content}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Fragment>
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
