// src/utils/taskUrgency.ts
// مستويات إلحاح المهام النشطة بحسب الوقت المتبقي على الموعد

export type UrgencyLevel = 'overdue' | 'critical' | 'soon' | 'comfortable' | 'none';

export type UrgencyInfo = {
  level: UrgencyLevel;
  deadline: Date | null;
  msLeft: number | null;
  remainingLabel: string;
  source: 'subtask' | 'task' | null;
  sourceTitle?: string;
};

type UrgencyMeta = {
  label: string;
  hint: string;
  color: string;
  softBg: string;
  softText: string;
  ring: string;
  chipActive: string;
  chipIdle: string;
};

// ملاحظة: كل أسماء الأصناف حرفية ليلتقطها Tailwind
export const URGENCY_ORDER: UrgencyLevel[] = ['overdue', 'critical', 'soon', 'comfortable', 'none'];

export const URGENCY_META: Record<UrgencyLevel, UrgencyMeta> = {
  overdue: {
    label: 'متأخرة',
    hint: 'تجاوزت الوقت المحدد',
    color: '#ef4444',
    softBg: 'bg-red-100 dark:bg-red-900/40',
    softText: 'text-red-700 dark:text-red-200',
    ring: 'ring-1 ring-red-300 dark:ring-red-700',
    chipActive: 'bg-red-500 text-white border-red-500',
    chipIdle: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800',
  },
  critical: {
    label: 'عاجلة جداً',
    hint: 'يتبقى أقل من يوم',
    color: '#f97316',
    softBg: 'bg-orange-100 dark:bg-orange-900/40',
    softText: 'text-orange-700 dark:text-orange-200',
    ring: 'ring-1 ring-orange-300 dark:ring-orange-700',
    chipActive: 'bg-orange-500 text-white border-orange-500',
    chipIdle: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800',
  },
  soon: {
    label: 'قريبة',
    hint: 'يتبقى 3 أيام أو أقل',
    color: '#eab308',
    softBg: 'bg-yellow-100 dark:bg-yellow-900/40',
    softText: 'text-yellow-800 dark:text-yellow-200',
    ring: '',
    chipActive: 'bg-yellow-500 text-white border-yellow-500',
    chipIdle: 'bg-yellow-50 text-yellow-800 border-yellow-200 hover:bg-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-300 dark:border-yellow-800',
  },
  comfortable: {
    label: 'وقت كافٍ',
    hint: 'يتبقى أكثر من 3 أيام',
    color: '#22c55e',
    softBg: 'bg-green-100 dark:bg-green-900/40',
    softText: 'text-green-700 dark:text-green-200',
    ring: '',
    chipActive: 'bg-green-600 text-white border-green-600',
    chipIdle: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800',
  },
  none: {
    label: 'بلا موعد',
    hint: 'لا يوجد موعد محدد',
    color: '#9ca3af',
    softBg: 'bg-gray-100 dark:bg-gray-700',
    softText: 'text-gray-600 dark:text-gray-300',
    ring: '',
    chipActive: 'bg-gray-500 text-white border-gray-500',
    chipIdle: 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600',
  },
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// الموعد بدون وقت (00:00) يعني نهاية ذلك اليوم
export const parseDeadline = (value?: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  if (d.getHours() === 0 && d.getMinutes() === 0) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  }
  return d;
};

const pluralize = (n: number, one: string, two: string, few: string, many: string): string => {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
};

const days = (n: number) => pluralize(n, 'يوم واحد', 'يومان', 'أيام', 'يوماً');
const hours = (n: number) => pluralize(n, 'ساعة واحدة', 'ساعتان', 'ساعات', 'ساعة');
const minutes = (n: number) => pluralize(n, 'دقيقة واحدة', 'دقيقتان', 'دقائق', 'دقيقة');

export const formatDuration = (absMs: number): string => {
  if (absMs < HOUR) return minutes(Math.max(1, Math.floor(absMs / MINUTE)));
  if (absMs < DAY) {
    const h = Math.floor(absMs / HOUR);
    const m = Math.floor((absMs % HOUR) / MINUTE);
    return m > 0 && h < 6 ? `${hours(h)} و${minutes(m)}` : hours(h);
  }
  const d = Math.floor(absMs / DAY);
  const h = Math.floor((absMs % DAY) / HOUR);
  return h > 0 && d < 3 ? `${days(d)} و${hours(h)}` : days(d);
};

export const getUrgencyFromDeadline = (
  deadline: Date | null,
  now: number,
  source: UrgencyInfo['source'] = null,
  sourceTitle?: string
): UrgencyInfo => {
  if (!deadline) {
    return { level: 'none', deadline: null, msLeft: null, remainingLabel: 'بلا موعد', source: null };
  }
  const msLeft = deadline.getTime() - now;
  let level: UrgencyLevel;
  if (msLeft < 0) level = 'overdue';
  else if (msLeft < DAY) level = 'critical';
  else if (msLeft <= 3 * DAY) level = 'soon';
  else level = 'comfortable';

  const remainingLabel = msLeft < 0
    ? `متأخرة ${formatDuration(-msLeft)}`
    : `باقي ${formatDuration(msLeft)}`;

  return { level, deadline, msLeft, remainingLabel, source, sourceTitle };
};

type DeadlineSubtask = { IsCompleted?: boolean | number; DueDate?: string | null; Title?: string };

// الموعد الفعّال للمهمة: أقرب موعد لمهامي الفرعية غير المكتملة، وإلا موعد المهمة نفسها
export const computeTaskUrgency = (
  taskDueDate: string | null | undefined,
  relevantSubtasks: DeadlineSubtask[],
  now: number
): UrgencyInfo => {
  let best: { date: Date; title?: string } | null = null;
  for (const st of relevantSubtasks) {
    if (st.IsCompleted) continue;
    const d = parseDeadline(st.DueDate);
    if (d && (!best || d.getTime() < best.date.getTime())) best = { date: d, title: st.Title };
  }
  if (best) return getUrgencyFromDeadline(best.date, now, 'subtask', best.title);
  return getUrgencyFromDeadline(parseDeadline(taskDueDate), now, 'task');
};
