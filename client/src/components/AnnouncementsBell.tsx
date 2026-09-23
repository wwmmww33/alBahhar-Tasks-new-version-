// src/components/AnnouncementsBell.tsx
// جرس تحديثات النظام: يعرض تحديثات ينشرها مدير النظام لجميع المستخدمين، ويمكن العودة إليها في أي وقت
import { useEffect, useState, useCallback } from 'react';
import { Megaphone, CheckCheck } from 'lucide-react';

type Announcement = {
  AnnouncementID: number;
  Title: string;
  Body: string;
  CreatedByName?: string | null;
  CreatedAt: string;
  UpdatedAt?: string | null;
  IsRead: boolean;
};

type Props = {
  userId: string;
};

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });

const AnnouncementsBell = ({ userId }: Props) => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const unreadCount = items.filter(a => !a.IsRead).length;

  const fetchAnnouncements = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/announcements?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? data : []);
      }
    } catch (_) {
      // تجاهل — ستُعرض القائمة فارغة
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchAnnouncements();
    const interval = setInterval(fetchAnnouncements, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAnnouncements]);

  const markAsRead = async (id: number) => {
    setItems(prev => prev.map(a => (a.AnnouncementID === id ? { ...a, IsRead: true } : a)));
    try {
      await fetch(`/api/announcements/${id}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
    } catch (_) {}
  };

  const markAllAsRead = async () => {
    setItems(prev => prev.map(a => ({ ...a, IsRead: true })));
    try {
      await fetch('/api/announcements/mark-all-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
    } catch (_) {}
  };

  const toggleExpand = (a: Announcement) => {
    setExpandedId(prev => (prev === a.AnnouncementID ? null : a.AnnouncementID));
    if (!a.IsRead) markAsRead(a.AnnouncementID);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
        title="تحديثات النظام"
      >
        <Megaphone size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-[10px] rounded-full h-4 min-w-[1.25rem] px-1 flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div dir="rtl" className="absolute left-0 mt-2 w-96 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-content/10 z-50 max-h-[28rem] overflow-hidden flex flex-col">
          <div className="p-3 border-b border-content/10 flex justify-between items-center">
            <h3 className="font-semibold text-content">تحديثات النظام</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <CheckCheck size={14} /> تحديد الكل كمقروء
              </button>
            )}
          </div>
          <div className="overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="p-4 text-center text-sm text-content-secondary">جاري التحميل...</div>
            ) : items.length === 0 ? (
              <div className="p-6 text-center text-content-secondary">
                <Megaphone size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">لا توجد تحديثات بعد</p>
              </div>
            ) : (
              items.map(a => (
                <button
                  key={a.AnnouncementID}
                  onClick={() => toggleExpand(a)}
                  className={`w-full text-right p-3 border-b border-content/5 last:border-b-0 transition-colors ${
                    !a.IsRead ? 'bg-primary/5' : 'hover:bg-content/5'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!a.IsRead && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!a.IsRead ? 'font-bold text-content' : 'font-medium text-content'}`}>{a.Title}</p>
                      <p className={`text-xs text-content-secondary mt-0.5 ${expandedId === a.AnnouncementID ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
                        {a.Body}
                      </p>
                      <p className="text-[11px] text-content-secondary/70 mt-1">
                        {formatDate(a.CreatedAt)}{a.CreatedByName ? ` — ${a.CreatedByName}` : ''}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {isOpen && <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />}
    </div>
  );
};

export default AnnouncementsBell;
