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
  PersonalOwnerUserID?: string | null;
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

type ViewMode = 'month' | 'week' | 'day' | 'year';
type ViewFilter = 'both' | 'shared' | 'vacancy' | 'personal';
type ViewLayout = 'list' | 'grid';

type CalendarPageProps = {
  currentUser: CurrentUser;
};

const CalendarPage = ({ currentUser }: CalendarPageProps) => {
  const actorId = resolveCurrentActorId(currentUser) || currentUser.UserID;
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [commentEvents, setCommentEvents] = useState<CalendarCommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('both');
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [viewLayout, setViewLayout] = useState<ViewLayout>('grid');
  const [hideEmptyDays, setHideEmptyDays] = useState(false);
  const [hideContinuationOnly, setHideContinuationOnly] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [taskSearch, setTaskSearch] = useState('');
  const [taskSearchOpen, setTaskSearchOpen] = useState(false);

  const openTaskInNewTab = (taskId: number) => {
    window.open(`/task/${taskId}`, '_blank', 'noopener,noreferrer');
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
    if (mode === 'year') {
      const start = new Date(ref.getFullYear(), 0, 1);
      const end = new Date(ref.getFullYear() + 1, 0, 1);
      const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      return { start, days };
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
          viewMode === 'year' ||
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
      const label = d.toLocaleDateString('ar-EG-u-nu-latn', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      daysArr.push({ key, date: d, label });
    }
    return daysArr;
  }, [viewMode, currentDate]);

  const taskList = useMemo(() => {
    const map = new Map<number, { title: string; isPersonal: boolean }>();
    for (const it of items) {
      if (!map.has(it.TaskID)) map.set(it.TaskID, { title: it.TaskTitle, isPersonal: !!it.PersonalOwnerUserID });
    }
    for (const cm of commentEvents) {
      if (!map.has(cm.TaskID)) map.set(cm.TaskID, { title: cm.TaskTitle, isPersonal: !!(cm as any).PersonalOwnerUserID });
    }
    return [...map.entries()]
      .map(([id, { title, isPersonal }]) => ({ id, title, isPersonal }))
      .sort((a, b) => {
        if (a.isPersonal !== b.isPersonal) return a.isPersonal ? 1 : -1;
        return a.title.localeCompare(b.title, 'ar');
      });
  }, [items, commentEvents]);

  const filteredTaskOptions = useMemo(() => {
    if (!taskSearch.trim()) return taskList;
    const q = taskSearch.trim().toLowerCase();
    return taskList.filter(t => t.title.toLowerCase().includes(q));
  }, [taskList, taskSearch]);

  const displayItems = useMemo(() => {
    // المهام الشخصية تُعرض دائماً عبر personalByDay، نُبعدها من مجموعة العمل
    const workItems = items.filter(it => !it.PersonalOwnerUserID);
    const taskFiltered = selectedTaskId !== null ? workItems.filter(it => it.TaskID === selectedTaskId) : workItems;
    if (viewFilter === 'personal') return [];
    if (viewFilter === 'vacancy') return taskFiltered.filter(it => String(it.AssignedToID) === String(actorId));
    return taskFiltered;
  }, [items, viewFilter, actorId, selectedTaskId]);

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
    const map: Record<string, CalendarItemWithSpan[]> = {};
    for (const it of items) {
      if (!it.PersonalOwnerUserID) continue;
      if (selectedTaskId !== null && it.TaskID !== selectedTaskId) continue;
      const d = new Date(it.DueDate);
      const key = toLocalYMD(d);
      if (!map[key]) map[key] = [];
      map[key].push({ ...it, _spanPos: 'single' });
    }
    return map;
  }, [items, selectedTaskId]);

  const commentsByDay = useMemo(() => {
    const map: Record<string, CalendarCommentItem[]> = {};
    const filtered = selectedTaskId !== null ? commentEvents.filter(c => c.TaskID === selectedTaskId) : commentEvents;
    for (const comment of filtered) {
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
    const effectiveHideEmpty = hideEmptyDays || selectedTaskId !== null;
    if (!effectiveHideEmpty && !hideContinuationOnly) return dateRange;
    return dateRange.filter(d => {
      const sharedForDay   = itemsByDay[d.key] || [];
      const personalForDay = personalByDay[d.key] || [];
      const commentsForDay = commentsByDay[d.key] || [];
      const visiblePersonal = (viewFilter === 'both' || viewFilter === 'personal') ? personalForDay : [];
      const visibleComments = viewFilter === 'personal'
        ? commentsForDay.filter(c => c.PersonalOwnerUserID)
        : viewFilter === 'both'
          ? commentsForDay
          : commentsForDay.filter(c => !c.PersonalOwnerUserID);
      const hasAnyEvents = sharedForDay.length > 0 || visiblePersonal.length > 0 || visibleComments.length > 0;
      if (effectiveHideEmpty && !hasAnyEvents) return false;
      if (hideContinuationOnly) {
        const hasNonCont = sharedForDay.some(it => it._spanPos === 'start' || it._spanPos === 'single' || it._spanPos === 'end') ||
                           visiblePersonal.length > 0 || visibleComments.length > 0;
        if (!hasNonCont) return false;
      }
      return true;
    });
  }, [dateRange, itemsByDay, personalByDay, commentsByDay, viewFilter, hideEmptyDays, hideContinuationOnly, selectedTaskId]);

  const handlePrev = () => {
    setCurrentDate((prev) => {
      const d = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate());
      if (viewMode === 'day') {
        d.setDate(d.getDate() - 1);
      } else if (viewMode === 'week') {
        d.setDate(d.getDate() - 7);
      } else if (viewMode === 'year') {
        d.setFullYear(d.getFullYear() - 1);
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
      } else if (viewMode === 'year') {
        d.setFullYear(d.getFullYear() + 1);
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
    if (viewMode === 'year') {
      return String(currentDate.getFullYear());
    }
    if (viewMode === 'day') {
      return currentDate.toLocaleDateString('ar-EG-u-nu-latn', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }
    const { start, days } = computeRange(viewMode, currentDate);
    if (viewMode === 'week') {
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days - 1);
      const startStr = start.toLocaleDateString('ar-EG-u-nu-latn', {
        day: 'numeric',
        month: 'long',
      });
      const endStr = end.toLocaleDateString('ar-EG-u-nu-latn', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      return `من ${startStr} إلى ${endStr}`;
    }
    return currentDate.toLocaleDateString('ar-EG-u-nu-latn', {
      month: 'long',
      year: 'numeric',
    });
  }, [viewMode, currentDate]);

  // دالة مساعدة: ترسم شبكة مربعات لأيام محددة (شهر أو أسبوع أو شهر ضمن السنوي)
  const renderMonthGrid = (daysToRender: typeof dateRange) => {
    if (daysToRender.length === 0) return null;
    const firstDate = daysToRender[0].date;
    const startOffset = firstDate.getDay();
    const cells: { key: string; date: Date | null }[] = [];
    for (let i = 0; i < startOffset; i++) cells.push({ key: `empty-${i}`, date: null });
    for (const d of daysToRender) cells.push({ key: d.key, date: d.date });

    const weeks: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, Math.min(i + 7, cells.length)));

    const spanItems = displayItems.filter(it => !!it.EndDate);
    const todayKey = toLocalYMD(new Date());

    return (
      <div className="mt-3 border rounded-lg overflow-hidden">
        <div className="grid grid-cols-7 bg-content/5 text-xs font-semibold text-center py-2">
          {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((label, i) => (
            <div key={label} className={i === 5 || i === 6 ? 'text-gray-400 dark:text-gray-500' : ''}>{label}</div>
          ))}
        </div>
        <div className="border-t border-content/10">
          {weeks.map((week, weekIdx) => {
            const validCells = week.filter(c => c.date !== null);
            if (validCells.length === 0) return <div key={`week-empty-${weekIdx}`} className="grid grid-cols-7">{week.map((c,i) => <div key={c.key+i} className="h-24 border border-content/10 bg-transparent" />)}</div>;

            const wd0 = validCells[0].date!;
            const wdN = validCells[validCells.length - 1].date!;
            const weekStartD = new Date(wd0.getFullYear(), wd0.getMonth(), wd0.getDate());
            const weekEndD   = new Date(wdN.getFullYear(), wdN.getMonth(), wdN.getDate());

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
                {barAreaH > 0 && (
                  <div className="relative bg-content/[0.02]" style={{ height: `${barAreaH}px` }}>
                    <div className="absolute inset-0 grid grid-cols-7 pointer-events-none">
                      {week.map((_c, i) => <div key={i} className="border-r border-content/10 last:border-r-0 h-full" />)}
                    </div>
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
                          className={['z-10', bar.isFirst ? 'rounded-r-full' : '', bar.isLast ? 'rounded-l-full' : ''].join(' ')}
                        />
                      );
                    })}
                  </div>
                )}
                <div className="grid grid-cols-7">
                  {week.map((cell, colIdx) => {
                    if (!cell.date) return <div key={cell.key + colIdx} className="h-24 border border-content/10 bg-transparent" />;
                    const key = toLocalYMD(cell.date);
                    const isToday = key === todayKey;
                    const dayOfWeek = cell.date.getDay();
                    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
                    const allCellItems   = itemsByDay[key] || [];
                    const personalForDay = (viewFilter === 'both' || viewFilter === 'personal') ? (personalByDay[key] || []) : [];
                    const rawCommentsForDay = commentsByDay[key] || [];
                    const commentsForDay = viewFilter === 'personal'
                      ? rawCommentsForDay.filter(c => c.PersonalOwnerUserID)
                      : viewFilter === 'both'
                        ? rawCommentsForDay
                        : rawCommentsForDay.filter(c => !c.PersonalOwnerUserID);
                    const hasBarOnDay = bars.some(b => b.startCol <= colIdx && b.endCol >= colIdx);
                    const hasEvents   = allCellItems.length > 0 || personalForDay.length > 0 || commentsForDay.length > 0 || hasBarOnDay;

                    const contSpansCell  = allCellItems.filter(it => it._spanPos === 'middle' || it._spanPos === 'end').sort((a,b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime());
                    const startSpansCell = allCellItems.filter(it => it._spanPos === 'start').sort((a,b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime());
                    const singlesCell    = allCellItems.filter(it => it._spanPos === 'single').sort((a,b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime());

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
                          {contSpansCell.length > 0 && (
                            <div className="flex flex-wrap items-center gap-[2px] font-bold leading-tight">
                              {contSpansCell.map((it, idx) => (
                                <span key={it.SubtaskID} className="flex items-center gap-[1px]">
                                  {idx > 0 && <span className="text-gray-400 text-[9px]">|</span>}
                                  <button type="button" onClick={() => openTaskInNewTab(it.TaskID)}
                                    style={{ color: getSpanColor(it.SubtaskID) }} className="hover:underline"
                                    title={`${it.SubtaskTitle}${it.AssignedToName ? ` (${it.AssignedToName})` : ''} — ضمن: ${it.TaskTitle}`}>
                                    {it.SubtaskID}
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                          {startSpansCell.map(it => (
                            <button key={`start-${it.SubtaskID}`} type="button" onClick={() => openTaskInNewTab(it.TaskID)}
                              style={{ color: getSpanColor(it.SubtaskID) }}
                              className="font-bold hover:underline text-right w-full block break-words"
                              title={`${it.SubtaskTitle}${it.AssignedToName ? ` (${it.AssignedToName})` : ''} — ضمن: ${it.TaskTitle}`}>
                              {formatEventTime(it.DueDate)}{it.SubtaskID}◀ {it.SubtaskTitle}{it.AssignedToName ? ` (${it.AssignedToName})` : ''} (ضمن: {it.TaskTitle})
                            </button>
                          ))}
                          {singlesCell.map(it => (
                            <button key={`single-${it.SubtaskID}`} type="button" onClick={() => openTaskInNewTab(it.TaskID)}
                              style={{ color: getSpanColor(it.SubtaskID) }}
                              className="font-semibold hover:underline text-right w-full block break-words"
                              title={`${it.SubtaskTitle}${it.AssignedToName ? ` (${it.AssignedToName})` : ''} — ضمن: ${it.TaskTitle}`}>
                              {formatEventTime(it.DueDate)}{it.SubtaskID}◀ {it.SubtaskTitle}{it.AssignedToName ? ` (${it.AssignedToName})` : ''} (ضمن: {it.TaskTitle})
                            </button>
                          ))}
                          {[...personalForDay].sort((a,b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime()).map(it => (
                            <button key={it.SubtaskID} type="button" onClick={() => openTaskInNewTab(it.TaskID)}
                              className="w-full text-right break-words hover:underline font-semibold"
                              style={{ color: '#059669' }}>
                              {formatEventTime(it.DueDate)}★ {it.SubtaskTitle || it.TaskTitle}
                            </button>
                          ))}
                          {commentsForDay.map(cm => (
                            <button key={cm.CommentID} type="button" onClick={() => openTaskInNewTab(cm.TaskID)}
                              style={{ color: '#7c3aed' }}
                              className="hover:underline text-right w-full block break-words"
                              title={`${cm.Content} — ضمن: ${cm.TaskTitle}`}>
                              {formatEventTime(cm.CreatedAt)}{cm.CommentID}💬 {cm.Content}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* العنوان */}
      <div className="flex items-center gap-3">
        <CalendarIcon className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">التقويم</h1>
          <p className="text-sm text-content-secondary">
            عرض {viewMode === 'year' ? 'سنوي' : viewMode === 'month' ? 'شهري' : viewMode === 'week' ? 'أسبوعي' : 'يومي'} للمهام الفرعية.
          </p>
        </div>
      </div>

      {/* صف التحكم: طريقة العرض + الفترة الزمنية + خيارات الإخفاء */}
      <div className="flex flex-wrap items-center gap-2">
        {/* طريقة العرض: شبكة / قائمة */}
        <div className="flex items-center overflow-hidden rounded-md border border-content/20">
          <button
            type="button"
            onClick={() => setViewLayout('list')}
            disabled={viewMode === 'day'}
            className={`px-3 py-1 text-sm transition-colors disabled:opacity-40 ${
              viewLayout === 'list' || viewMode === 'day'
                ? 'bg-primary text-white'
                : 'bg-white dark:bg-gray-800 text-content'
            }`}
          >
            قائمة
          </button>
          <button
            type="button"
            onClick={() => setViewLayout('grid')}
            disabled={viewMode === 'day'}
            className={`px-3 py-1 text-sm transition-colors disabled:opacity-40 ${
              viewLayout === 'grid' && viewMode !== 'day'
                ? 'bg-primary text-white'
                : 'bg-white dark:bg-gray-800 text-content'
            }`}
          >
            شبكة
          </button>
        </div>

        <span className="text-content/30 mx-1 select-none">|</span>

        {/* الفترة الزمنية */}
        <div className="flex items-center gap-1">
          {(['day', 'week', 'month', 'year'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 rounded-md text-sm border ${
                viewMode === mode
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white dark:bg-gray-800 text-content border-content/20'
              }`}
            >
              {mode === 'day' ? 'يومي' : mode === 'week' ? 'أسبوعي' : mode === 'month' ? 'شهري' : 'سنوي'}
            </button>
          ))}
        </div>

        {/* خيارات الإخفاء — فقط في عرض القائمة */}
        {viewLayout === 'list' && (viewMode === 'month' || viewMode === 'week' || viewMode === 'year') && (
          <>
            <span className="text-content/30 mx-1 select-none">|</span>
            <span className="text-xs text-content-secondary">إخفاء:</span>
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
      </div>

      {/* صف التنقل: السابقة / اليوم / التالية + العنوان + PDF */}
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
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">{rangeLabel}</span>
          {viewMode !== 'day' && (
            <button
              type="button"
              onClick={() => exportCalendarToPdf({
                monthLabel: rangeLabel,
                dateRange,
                displayItems,
                personalByDay,
                commentsByDay,
                viewMode,
                viewLayout,
                filteredListRange,
                deptName: currentUser.DepartmentName,
              })}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded border bg-white dark:bg-gray-700 text-content border-content/20 hover:bg-gray-50 dark:hover:bg-gray-600"
              title={`تصدير التقويم كـ PDF`}
            >
              <FileDown className="w-3 h-3" />
              تصدير PDF
            </button>
          )}
        </div>
      </div>

      {/* صف الفلترة: نوع الحدث + البحث عن مهمة */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-content-secondary">الأحداث:</span>
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

        {/* صندوق البحث عن مهمة */}
        {taskList.length > 0 && (
          <div className="relative mr-auto">
            <input
              type="text"
              value={taskSearch}
              onChange={e => { setTaskSearch(e.target.value); setSelectedTaskId(null); setTaskSearchOpen(true); }}
              onFocus={() => setTaskSearchOpen(true)}
              onBlur={() => setTimeout(() => setTaskSearchOpen(false), 150)}
              placeholder={selectedTaskId ? (taskList.find(t => t.id === selectedTaskId)?.title ?? 'ابحث عن مهمة...') : 'ابحث عن مهمة...'}
              className={`text-xs px-2 py-1 pr-7 rounded border w-48 ${
                selectedTaskId
                  ? 'bg-primary/10 border-primary text-primary font-semibold placeholder:text-primary'
                  : 'bg-white dark:bg-gray-700 text-content border-content/20'
              }`}
            />
            {/* أيقونة البحث */}
            {!selectedTaskId && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-content-secondary text-xs pointer-events-none">🔍</span>
            )}
            {/* زر المسح */}
            {selectedTaskId && (
              <button
                type="button"
                onMouseDown={() => { setSelectedTaskId(null); setTaskSearch(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-content-secondary hover:text-red-500"
              >✕</button>
            )}
            {/* قائمة الاقتراحات */}
            {taskSearchOpen && filteredTaskOptions.length > 0 && (
              <ul className="absolute z-50 top-full mt-0.5 right-0 w-64 bg-white dark:bg-gray-800 border border-content/20 rounded-md shadow-lg max-h-52 overflow-auto text-xs">
                {filteredTaskOptions.map(t => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onMouseDown={() => { setSelectedTaskId(t.id); setTaskSearch(''); setTaskSearchOpen(false); }}
                      className="w-full text-right px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1"
                    >
                      {t.isPersonal && <span className="text-emerald-500 flex-shrink-0 text-xs">★</span>}
                      <span className="truncate">{t.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center text-content-secondary mt-8">جاري تحميل بيانات التقويم...</div>
      ) : error ? (
        <div className="text-center text-red-600 mt-8">{error}</div>
      ) : (
        <>
          {/* عرض سنوي — شبكة كاملة: 12 شهر بالتفصيل */}
          {viewMode === 'year' && viewLayout === 'grid' && (
            <div className="space-y-8 mt-3">
              {Array.from({ length: 12 }, (_, m) => {
                const monthDays = dateRange.filter(d => d.date.getMonth() === m);
                if (monthDays.length === 0) return null;
                const monthName = new Date(currentDate.getFullYear(), m, 1)
                  .toLocaleDateString('ar-EG-u-nu-latn', { month: 'long' });
                return (
                  <div key={m}>
                    <h3 className="text-base font-bold mb-1 text-content border-b border-content/10 pb-1">{monthName}</h3>
                    {renderMonthGrid(monthDays)}
                  </div>
                );
              })}
            </div>
          )}

          {/* مهام بدأت قبل هذه الفترة وتمتد خلالها */}
          {viewMode !== 'year' && priorSpans.length > 0 && (
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
                      {formatEventTime(it.DueDate)}{new Date(it.DueDate).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' })}
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

          {(viewMode === 'month' || viewMode === 'week') && viewLayout === 'grid' ? (
            renderMonthGrid(dateRange)
          ) : (viewMode === 'day' || viewLayout === 'list') ? (
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
                const visibleComments = viewFilter === 'personal'
                  ? commentsForDay.filter(c => c.PersonalOwnerUserID)
                  : viewFilter === 'both'
                    ? commentsForDay
                    : commentsForDay.filter(c => !c.PersonalOwnerUserID);
                const hasEvents = visibleShared.length > 0 || visiblePersonal.length > 0 || visibleComments.length > 0;
                const todayKey  = toLocalYMD(new Date());
                const isToday   = d.key === todayKey;
                const isWeekend = d.date.getDay() === 5 || d.date.getDay() === 6;
                const isFirst   = dayIdx === 0;
                const isLast    = dayIdx === filteredListRange.length - 1;

                const contList   = visibleShared.filter(it => it._spanPos === 'middle' || it._spanPos === 'end').sort((a,b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime());
                const startList  = visibleShared.filter(it => it._spanPos === 'start').sort((a,b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime());
                const singleList = visibleShared.filter(it => it._spanPos === 'single').sort((a,b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime());

                const dayVBars   = verticalBars.filter(b => b.startKey <= d.key && b.endKey >= d.key).sort((a,b) => a.lane - b.lane);
                const spanPosMap = new Map(visibleShared.map(it => [it.SubtaskID, it._spanPos]));

                const cardBg = isToday
                  ? 'bg-yellow-100 dark:bg-yellow-900'
                  : isWeekend
                    ? 'bg-gray-100 dark:bg-gray-800/60'
                    : hasEvents ? 'bg-white dark:bg-gray-900' : 'bg-white/60 dark:bg-gray-900/40';
                const borderColor = isToday
                  ? 'border-yellow-400 dark:border-yellow-500'
                  : isWeekend
                    ? 'border-gray-300 dark:border-gray-600'
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
                        <div className={`text-sm font-semibold text-right ${isToday ? 'text-primary' : isWeekend ? 'text-gray-400 dark:text-gray-500' : ''}`}>
                          {d.label}{isWeekend && !isToday && <span className="mr-1 text-xs font-normal opacity-70">إجازة</span>}
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
                              {formatEventTime(it.DueDate)}{it.SubtaskID}◀ {it.SubtaskTitle}{it.AssignedToName ? ` (${it.AssignedToName})` : ''} (ضمن: {it.TaskTitle})
                            </button>
                          </div>
                        ))}
                        {singleList.map(it => (
                          <div key={`single-${it.SubtaskID}`} className="text-xs">
                            <button type="button" onClick={() => openTaskInNewTab(it.TaskID)}
                              style={{ color: getSpanColor(it.SubtaskID) }} className="font-semibold hover:underline break-words text-right">
                              {formatEventTime(it.DueDate)}{it.SubtaskID}◀ {it.SubtaskTitle}{it.AssignedToName ? ` (${it.AssignedToName})` : ''} (ضمن: {it.TaskTitle})
                            </button>
                          </div>
                        ))}
                        {[...visiblePersonal].sort((a, b) => new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime()).map(it => (
                          <button key={it.SubtaskID} type="button" onClick={() => openTaskInNewTab(it.TaskID)}
                            className="text-xs font-semibold hover:underline text-right w-full break-words"
                            style={{ color: '#059669' }}>
                            {formatEventTime(it.DueDate)}★ {it.SubtaskTitle || it.TaskTitle}
                          </button>
                        ))}
                        {visibleComments.map(cm => (
                          <button key={cm.CommentID} type="button" onClick={() => openTaskInNewTab(cm.TaskID)}
                            className="text-xs font-semibold hover:underline text-right w-full break-words"
                            style={{ color: '#7c3aed' }}>
                            {formatEventTime(cm.CreatedAt)}{cm.CommentID}💬 {cm.Content}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          ) : null}

        </>
      )}
    </div>
  );
};

export default CalendarPage;
