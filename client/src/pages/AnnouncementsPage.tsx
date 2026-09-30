// src/pages/AnnouncementsPage.tsx
// صفحة كل تحديثات النظام، مرتبة من الأحدث إلى الأقدم
import { useEffect, useState } from 'react';
import { Megaphone, CheckCheck } from 'lucide-react';
import type { CurrentUser } from '../types';

type Announcement = {
  AnnouncementID: number;
  Title: string;
  Body: string;
  CreatedByName?: string | null;
  CreatedAt: string;
  UpdatedAt?: string | null;
  IsRead: boolean;
};

const formatDateTime = (dateStr: string) =>
  new Date(dateStr).toLocaleString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const AnnouncementsPage = ({ currentUser }: { currentUser: CurrentUser }) => {
  const userId = String(currentUser.UserID || '');
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAnnouncements = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/announcements?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const data = await res.json();
        // الأحدث أولاً (الخادم يُرتّبها كذلك أصلاً، نضمن ذلك هنا احتياطاً)
        const sorted = Array.isArray(data)
          ? [...data].sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime())
          : [];
        setItems(sorted);
      }
    } catch (_) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAnnouncements(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

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

  const unreadCount = items.filter(a => !a.IsRead).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="text-primary" size={24} />
          <h1 className="text-2xl font-bold text-content">تحديثات النظام</h1>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-primary hover:bg-primary/10 rounded-md"
          >
            <CheckCheck size={15} /> تحديد الكل كمقروء
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-content-secondary text-center py-12">جاري التحميل...</p>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-content-secondary">
          <Megaphone size={36} className="mx-auto mb-3 opacity-30" />
          <p>لا توجد تحديثات بعد</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(a => (
            <div
              key={a.AnnouncementID}
              onClick={() => !a.IsRead && markAsRead(a.AnnouncementID)}
              className={`p-4 rounded-lg border transition-colors ${
                !a.IsRead
                  ? 'bg-primary/5 border-primary/30 cursor-pointer'
                  : 'bg-white dark:bg-gray-800 border-content/10'
              }`}
            >
              <div className="flex items-start gap-2">
                {!a.IsRead && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />}
                <div className="flex-1 min-w-0">
                  <h3 className={`text-content ${!a.IsRead ? 'font-bold' : 'font-semibold'}`}>{a.Title}</h3>
                  <p className="text-sm text-content-secondary whitespace-pre-wrap mt-1">{a.Body}</p>
                  <p className="text-xs text-content-secondary/70 mt-2">
                    {formatDateTime(a.CreatedAt)}{a.CreatedByName ? ` — ${a.CreatedByName}` : ''}
                    {a.UpdatedAt ? ' (مُعدَّل)' : ''}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AnnouncementsPage;
