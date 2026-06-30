import { useEffect, useRef, useState } from 'react';
import { X, Clock, Bell } from 'lucide-react';
import type { CurrentUser } from '../types';
import { resolveCurrentActorId } from '../utils/actorIdentity';

type ReminderItem = {
  SubtaskID: number;
  TaskID: number;
  SubtaskTitle: string;
  TaskTitle: string;
  DueDate: string;
  ReminderEnabled: boolean | number;
  ReminderMinutes: number;
};

type Props = { currentUser: CurrentUser };

const CHECK_INTERVAL_MS = 60 * 1000;
const STORAGE_KEY = 'albahar_subtask_reminded';

function loadNotifiedMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: Record<string, number> = JSON.parse(raw);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return Object.fromEntries(Object.entries(parsed).filter(([, ts]) => ts > cutoff));
  } catch {
    return {};
  }
}

function saveNotified(id: number) {
  try {
    const existing = loadNotifiedMap();
    existing[id] = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {}
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function minutesUntil(dateStr: string): number {
  return Math.round((new Date(dateStr).getTime() - Date.now()) / 60000);
}

const SubtaskReminder = ({ currentUser }: Props) => {
  // قائمة انتظار الإشعارات — نعرض واحداً في كل مرة
  const [queue, setQueue] = useState<ReminderItem[]>([]);
  const notifiedRef = useRef<Record<string, number>>(loadNotifiedMap());
  const actorId = resolveCurrentActorId(currentUser) || String(currentUser.UserID || '');

  useEffect(() => {
    // حارس إلغاء: في وضع React.StrictMode (تطوير) يُركَّب المكوّن مرتين؛
    // بدون هذا الحارس قد تُطلق النسخة "الوهمية" الصوت/الإشعار وتكتب في localStorage
    // قبل إزالتها، بينما تحديث الحالة (ظهور النافذة) يُهمَل لأنها لم تعد مُركَّبة.
    let cancelled = false;

    const check = async () => {
      if (!actorId) return;
      try {
        const res = await fetch(`/api/calendar/reminders?userId=${encodeURIComponent(actorId)}`);
        if (cancelled || !res.ok) return;
        const items: ReminderItem[] = await res.json();
        if (cancelled) return;

        const now = Date.now();
        const newItems: ReminderItem[] = [];

        for (const item of items) {
          // فقط المهام التي فعّل صاحبها التذكير
          if (!item.ReminderEnabled) continue;
          if (!item.DueDate) continue;

          const due = new Date(item.DueDate);
          // تجاهل 00:00 (بلا وقت محدد)
          if (due.getHours() === 0 && due.getMinutes() === 0) continue;

          const reminderWindowMs = (item.ReminderMinutes || 15) * 60 * 1000;
          const diff = due.getTime() - now;

          if (diff > 0 && diff <= reminderWindowMs) {
            const key = String(item.SubtaskID);
            if (!notifiedRef.current[key]) {
              notifiedRef.current[key] = now;
              saveNotified(item.SubtaskID);
              newItems.push(item);

              // إشعار المتصفح (يعمل على HTTPS أو localhost)
              if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                try {
                  new Notification(`⏰ ${item.SubtaskTitle}`, {
                    body: `الاستحقاق: ${formatTime(item.DueDate)} · ${item.TaskTitle}`,
                    tag: `subtask-${item.SubtaskID}`,
                    requireInteraction: true,
                  });
                } catch (_) {}
              }
            }
          }
        }

        if (newItems.length > 0 && !cancelled) {
          setQueue(prev => [...prev, ...newItems]);
        }
      } catch {}
    };

    // عند تعديل التذكير على مهمة فرعية (موجودة) نمسح علامة "مُبلَّغ سابقاً" الخاصة بها
    // كي تظهر النافذة مجدداً عند حلول الموعد، بغض النظر هل أُظهرت من قبل أم لا.
    const handleReminderEdited = (e: Event) => {
      const subtaskId = (e as CustomEvent).detail?.subtaskId;
      if (subtaskId == null) return;
      const key = String(subtaskId);
      delete notifiedRef.current[key];
      try {
        const existing = loadNotifiedMap();
        delete existing[key];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
      } catch {}
      check();
    };
    window.addEventListener('subtask:reminder:edited', handleReminderEdited);

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('subtask:reminder:edited', handleReminderEdited);
    };
  }, [actorId]);

  const dismissCurrent = () => setQueue(prev => prev.slice(1));

  if (queue.length === 0) return null;

  const current = queue[0];
  const mins = minutesUntil(current.DueDate);
  const timeStr = formatTime(current.DueDate);

  return (
    // خلفية شفافة نصف معتمة + مودال مركزي كبير
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      dir="rtl"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
    >
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* شريط علوي برتقالي */}
        <div className="bg-orange-500 px-6 py-4 flex items-center gap-3">
          <Bell className="text-white w-7 h-7 flex-shrink-0" />
          <div className="flex-1">
            <div className="text-white font-bold text-lg leading-tight">تذكير بمهمة فرعية</div>
            <div className="text-orange-100 text-sm mt-0.5">
              {mins <= 0 ? 'حان موعد الاستحقاق الآن' : `الموعد بعد ${mins} دقيقة`}
            </div>
          </div>
          <button
            type="button"
            onClick={dismissCurrent}
            className="text-white/80 hover:text-white transition-colors"
            aria-label="إغلاق"
          >
            <X size={22} />
          </button>
        </div>

        {/* المحتوى */}
        <div className="px-6 py-5">
          <div className="flex items-start gap-3 mb-4">
            <Clock className="text-orange-500 w-6 h-6 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-snug">
                {current.SubtaskTitle}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                ضمن: {current.TaskTitle}
              </div>
            </div>
          </div>

          <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl px-4 py-3 flex items-center justify-between mb-5">
            <span className="text-sm text-gray-600 dark:text-gray-300">وقت الاستحقاق</span>
            <span className="text-2xl font-bold text-orange-600 dark:text-orange-400 font-mono tracking-wider">
              {timeStr}
            </span>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={dismissCurrent}
              className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors"
            >
              حسناً، شكراً
            </button>
            {queue.length > 1 && (
              <button
                type="button"
                onClick={dismissCurrent}
                className="flex-1 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                التالي ({queue.length - 1})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubtaskReminder;
