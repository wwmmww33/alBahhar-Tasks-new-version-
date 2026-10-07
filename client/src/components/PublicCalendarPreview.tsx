// src/components/PublicCalendarPreview.tsx
// التقويم العام في صفحة الدخول — مفكرة عامة بلا أي حاجة لتسجيل الدخول. تعرض فقط الأحداث التي
// حدَّدها مدير القسم المستقل (أو المفوَّض له) صراحة كـ"بث مفتوح"، بصيغة قائمة زمنية (أقرب للأعلى)
// تتخطى الأيام التي لا تحتوي أحداثاً ولا يعبرها أي حدث ممتد. لا تُعرض هوية المُسنَد إليه أو صاحب
// التعليق أبداً هنا (الخادم نفسه لا يرسلها).
import { useEffect, useState } from 'react';
import { Calendar as CalendarIcon, Clock } from 'lucide-react';

type PublicEvent = {
  type: 'subtask' | 'comment';
  id: number;
  title: string;
  taskTitle: string;
  startDate: string;
  endDate: string | null;
};

const formatDayLabel = (d: Date) =>
  d.toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const formatShortDate = (d: Date) =>
  d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });

// يُعرض التوقيت دوماً حتى لو كان 00:00 — المهام يجب أن تظهر بتوقيتها دائماً على التقويم العام.
const formatTime = (dateStr: string): string => {
  const d = new Date(dateStr);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// نفس لوحة ألوان خط الامتداد في التقويم الجانبي بالصفحة الرئيسية.
const SPAN_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#f97316',
  '#ec4899', '#14b8a6', '#ef4444', '#eab308',
];
const getSpanColor = (id: number) => SPAN_COLORS[id % SPAN_COLORS.length];

// يبني نص التوقيت لعنصر على التقويم العام — إن كانت البداية والنهاية في نفس اليوم يُعرض مدى الوقت
// لكليهما، وإلا (حدث ممتد عبر أيام، له خط امتداد خاص به) يُعرض وقت البداية فقط في مربع أول يوم.
const formatEventTimeRange = (ev: PublicEvent): string => {
  const start = new Date(ev.startDate);
  const startTime = formatTime(ev.startDate);
  if (!ev.endDate) return startTime || '';

  const end = new Date(ev.endDate);
  if (isSameDay(start, end)) {
    const endTime = formatTime(ev.endDate);
    if (startTime && endTime) return `${startTime} — ${endTime}`;
    return startTime || endTime || '';
  }

  return startTime || '';
};

type PreparedEvent = PublicEvent & { carriedOverFrom?: Date; sortTime: number; spanColor?: string };
type SpanSegment = { id: number; color: string; lane: number; position: 'start' | 'middle' | 'end' };
type DayRow = { key: string; date: Date; events: PreparedEvent[]; spanSegments: SpanSegment[] };

const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const groupKeyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

const addDays = (d: Date, n: number): Date => {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
};

// يستثني الأحداث المنتهية كلياً قبل اليوم. الأحداث التي بدأت قبل اليوم ولا تزال سارية ("ممتدة من
// الماضي") تُفرَد في قائمة مستقلة تُعرض قبل مربع اليوم الحالي مباشرة (بعد عنوان المفكرة)، وتوقيتها
// يحمل تاريخ بدايتها الحقيقي بدل الاعتماد على عنوان يوم (لأنها لا تنتمي لعنوان يوم محدَّد). غيرها
// من الأحداث يُعرض بعنوانه مرة واحدة في يوم بدايته الفعلي. الأحداث الممتدة (تنتهي في يوم مختلف)
// تحصل على خط امتداد لونه ثابت بين يومي البداية والنهاية فقط — لا تُنشأ أيام فارغة للأيام الوسطى
// التي لا تحتوي أحداثاً خاصة بها (فلا يكبر الفراغ بينهما مع ازدياد عددها)، وإن وُجد يوم وسطي فيه
// أحداثه الخاصة فعلاً يمر الخط عبره دون انقطاع. توزَّع الأحداث المتداخلة زمنياً على ممرّات مستقلة.
const prepareCalendar = (events: PublicEvent[]): { carriedOver: PreparedEvent[]; days: DayRow[]; laneCount: number } => {
  const today = startOfToday();

  type Prepped = { ev: PublicEvent; displayStart: Date; end: Date; carriedOverFrom?: Date; spans: boolean };
  const prepped: Prepped[] = [];

  events.forEach(ev => {
    const start = new Date(ev.startDate);
    const end = ev.endDate ? new Date(ev.endDate) : start;
    if (end.getTime() < today.getTime()) return; // انتهى كلياً قبل اليوم — لا يُعرض

    const displayStart = start.getTime() < today.getTime() ? today : start;
    const carriedOverFrom = start.getTime() < today.getTime() ? start : undefined;
    prepped.push({ ev, displayStart, end, carriedOverFrom, spans: !isSameDay(displayStart, end) });
  });

  // توزيع الأحداث الممتدة على ممرّات: كل ممرّ يحمل تاريخ آخر نهاية مشغولة فيه، ونعيد استخدام أول
  // ممرّ صار فارغاً (انتهت مهمته قبل بداية الحدث الحالي) بدل فتح ممرّ جديد دوماً.
  const spanning = prepped.filter(p => p.spans).sort((a, b) => a.displayStart.getTime() - b.displayStart.getTime());
  const laneEndTimes: number[] = [];
  const laneOf = new Map<number, number>();
  spanning.forEach(p => {
    let lane = laneEndTimes.findIndex(endTime => endTime < p.displayStart.getTime());
    if (lane === -1) { lane = laneEndTimes.length; laneEndTimes.push(p.end.getTime()); }
    else { laneEndTimes[lane] = p.end.getTime(); }
    laneOf.set(p.ev.id, lane);
  });

  const dayMap = new Map<string, DayRow>();
  const ensureDay = (date: Date): DayRow => {
    const key = groupKeyOf(date);
    if (!dayMap.has(key)) dayMap.set(key, { key, date, events: [], spanSegments: [] });
    return dayMap.get(key)!;
  };
  // اليوم الحالي يُنشأ دوماً — ليظهر كعنوان واضح حتى لو لم يحمل إلا خطوط أحداث ممتدة من الماضي.
  ensureDay(today);

  const carriedOver: PreparedEvent[] = [];

  // المرحلة الأولى: نضع كل حدث في يومه (أو القائمة المستقلة إن كان ممتداً من الماضي)، ونُنشئ
  // دوماً يومي البداية والنهاية لأي حدث ممتد — حتى لو لم يكن لهما أحداث أخرى — لتبقى طرفا الخط
  // واضحين، لكن بلا إنشاء أي يوم للأيام الفارغة بينهما (هذا ما كان يُسبِّب فراغاً يكبر مع عدد
  // الأيام الوسطى).
  prepped.forEach(p => {
    const color = p.spans ? getSpanColor(p.ev.id) : undefined;
    const prepared: PreparedEvent = {
      ...p.ev,
      carriedOverFrom: p.carriedOverFrom,
      sortTime: p.displayStart.getTime(),
      spanColor: color,
    };

    if (p.carriedOverFrom) {
      carriedOver.push(prepared);
    } else {
      ensureDay(p.displayStart).events.push(prepared);
    }

    if (p.spans) {
      const lane = laneOf.get(p.ev.id)!;
      // الممتد من الماضي: حتى في يوم ظهوره الأول (اليوم الحالي) يُعامَل الخط كمنتصف الامتداد
      // لا كبداية حقيقية (البداية الحقيقية قبل النطاق المعروض) — فيمتد كامل ارتفاع المربع.
      const startPosition: SpanSegment['position'] = p.carriedOverFrom ? 'middle' : 'start';
      ensureDay(p.displayStart).spanSegments.push({ id: p.ev.id, color: color!, lane, position: startPosition });
      ensureDay(p.end).spanSegments.push({ id: p.ev.id, color: color!, lane, position: 'end' });
    }
  });

  // المرحلة الثانية: أي يوم بين البداية والنهاية أصبح موجوداً فعلاً (لأن حدثاً آخر له أحداثه
  // الخاصة فيه) يحصل على مقطع "وسط" ليستمر الخط عابراً من خلاله دون قطع.
  spanning.forEach(p => {
    const color = getSpanColor(p.ev.id);
    const lane = laneOf.get(p.ev.id)!;
    let cursor = addDays(p.displayStart, 1);
    while (cursor.getTime() < p.end.getTime()) {
      const key = groupKeyOf(cursor);
      if (dayMap.has(key)) {
        dayMap.get(key)!.spanSegments.push({ id: p.ev.id, color, lane, position: 'middle' });
      }
      cursor = addDays(cursor, 1);
    }
  });

  const days = [...dayMap.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  days.forEach(d => d.events.sort((a, b) => a.sortTime - b.sortTime));
  carriedOver.sort((a, b) => (a.carriedOverFrom?.getTime() ?? 0) - (b.carriedOverFrom?.getTime() ?? 0));
  const laneCount = laneEndTimes.length;
  return { carriedOver, days, laneCount };
};

type Props = {
  // يُستدعى عند تحديد ما إذا كان المكوّن سيُعرض فعلياً أم لا (بعد انتهاء التحميل)، لتمكين الصفحة
  // الحاضنة (صفحة الدخول) من تعديل توزيع العناصر (ربع/ثلاثة أرباع) تبعاً لذلك.
  onAvailabilityChange?: (visible: boolean) => void;
  className?: string;
};

const LANE_WIDTH = 10;

const PublicCalendarPreview = ({ onAvailabilityChange, className = 'w-full max-w-md' }: Props) => {
  const [enabled, setEnabled] = useState(false);
  const [title, setTitle] = useState('التقويم العام');
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  // عند تمرير الفأرة على حدث ممتد (بطاقته أو أي مقطع من خطه) تُخفى خطوط الأحداث الممتدة الأخرى
  // لتسهيل تمييزه وتتبّعه بصرياً — نفس فكرة التظليل في التقويم الجانبي.
  const [hoveredSpanId, setHoveredSpanId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/public/calendar')
      .then(r => r.ok ? r.json() : { enabled: false, title: '', events: [] })
      .then(data => {
        if (cancelled) return;
        setEnabled(!!data.enabled);
        setTitle(data.title || 'التقويم العام');
        setEvents(Array.isArray(data.events) ? data.events : []);
      })
      .catch(() => { if (!cancelled) setEnabled(false); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const { carriedOver, days, laneCount } = prepareCalendar(events);
  // اليوم الحالي يُنشأ دوماً حتى بلا محتوى، فلا يُعتمَد على عدد الأيام وحده لتحديد وجود محتوى فعلي.
  const hasContent = carriedOver.length > 0 || days.some(d => d.events.length > 0 || d.spanSegments.length > 0);
  const isVisible = !loading && enabled && hasContent;

  useEffect(() => {
    if (!loading) onAvailabilityChange?.(isVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isVisible]);

  if (!isVisible) return null;

  // سطر حدث واحد — بلا مربع/خلفية، فقط نص مُلوَّن إن كان الحدث ممتداً (بنفس لون خط امتداده)
  // ليتضح بصرياً دون الحاجة لصندوق منفصل. يُستخدم للأحداث العادية ضمن يومها وللأحداث الممتدة من
  // الماضي في قسمها المستقل أعلى القائمة. timeLabel: نص التوقيت الجاهز للعرض (قد يتضمن تاريخ البداية).
  const renderCard = (ev: PreparedEvent, timeLabel: string, showTime: boolean) => {
    const isDimmed = !!ev.spanColor && hoveredSpanId !== null && hoveredSpanId !== ev.id;
    return (
      <div
        key={`${ev.type}-${ev.id}`}
        className={`flex items-start justify-between gap-2 text-sm transition-opacity duration-150 ${
          ev.spanColor ? 'cursor-pointer' : 'text-gray-700 dark:text-gray-200'
        }`}
        style={ev.spanColor ? { color: ev.spanColor, opacity: isDimmed ? 0.4 : 1 } : undefined}
        onMouseEnter={ev.spanColor ? () => setHoveredSpanId(ev.id) : undefined}
        onMouseLeave={ev.spanColor ? () => setHoveredSpanId(null) : undefined}
      >
        <span className={`shrink-0 flex items-center gap-1 text-xs text-content-secondary whitespace-nowrap ${showTime ? '' : 'invisible'}`}>
          <Clock size={11} />
          {showTime ? timeLabel : timeLabel || '00:00'}
        </span>
        <span className="flex-1 truncate">
          {ev.title}
          {ev.taskTitle && <span className="text-content-secondary"> › {ev.taskTitle}</span>}
        </span>
      </div>
    );
  };

  return (
    <div className={`${className} bg-white dark:bg-gray-800 rounded-lg shadow-md p-6`} dir="rtl">
      <div className="flex items-center gap-2 mb-4">
        <CalendarIcon size={20} className="text-primary" />
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">{title}</h2>
      </div>
      <div>
        {/* أحداث ممتدة بدأت قبل اليوم الحالي ولا تزال سارية — تُعرض هنا قبل مربع اليوم، بتوقيت
            يتضمن تاريخ بدايتها الحقيقي بدل الاعتماد على عنوان يوم (لا تنتمي ليوم واحد محدَّد). */}
        {carriedOver.length > 0 && (
          <div className="space-y-1.5 pb-4">
            {carriedOver.map(ev =>
              renderCard(ev, `${formatShortDate(ev.carriedOverFrom!)} ${formatTime(ev.startDate)}`, true)
            )}
          </div>
        )}
        {days.map(day => {
          const hasEvents = day.events.length > 0;
          const isToday = isSameDay(day.date, startOfToday());
          // يوم نهاية حدث ممتد بلا أحداث خاصة به — يظهر تاريخه فقط (ليتضح أين ينتهي الخط)
          // بلا تكرار لعنوان الحدث نفسه. اليوم الحالي يظهر عنوانه دوماً كمرجع ثابت للزائر.
          const isSpanEndOnly = !hasEvents && day.spanSegments.some(s => s.position === 'end');
          const showHeader = hasEvents || isSpanEndOnly || isToday;
          return (
            <div key={day.key} className="flex items-stretch gap-2">
              {laneCount > 0 && (
                <div className="relative shrink-0" style={{ width: laneCount * LANE_WIDTH }}>
                  {day.spanSegments.map(seg => {
                    const isDimmed = hoveredSpanId !== null && hoveredSpanId !== seg.id;
                    return (
                      <div
                        key={seg.id}
                        className="absolute rounded-full cursor-pointer transition-opacity duration-150"
                        style={{
                          right: seg.lane * LANE_WIDTH + 2,
                          width: 4,
                          backgroundColor: seg.color,
                          top: seg.position === 'start' ? '50%' : 0,
                          bottom: seg.position === 'end' ? '50%' : 0,
                          opacity: isDimmed ? 0.12 : 1,
                        }}
                        onMouseEnter={() => setHoveredSpanId(seg.id)}
                        onMouseLeave={() => setHoveredSpanId(null)}
                      />
                    );
                  })}
                </div>
              )}
              <div className={`flex-1 min-w-0 ${showHeader ? 'pb-4' : 'pb-1.5'}`}>
                {showHeader && (
                  <p className={`text-xs font-semibold mb-1.5 ${hasEvents ? 'text-primary' : 'text-content-secondary'}`}>
                    {formatDayLabel(day.date)}
                  </p>
                )}
                {hasEvents && (
                  <div className="space-y-1.5">
                    {day.events.map((ev, idx) => {
                      const timeRange = formatEventTimeRange(ev);
                      // لا نُكرر توقيتاً مطابقاً لتوقيت الحدث السابق مباشرة ضمن نفس اليوم.
                      const prevTimeRange = idx > 0 ? formatEventTimeRange(day.events[idx - 1]) : null;
                      const showTime = !!timeRange && timeRange !== prevTimeRange;
                      return renderCard(ev, timeRange, showTime);
                    })}
                  </div>
                )}
                {!showHeader && (
                  // يوم عبور بلا أحداث خاصة به — موجود فقط ليحمل خط امتداد حدث آخر
                  <div className="h-3" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PublicCalendarPreview;
