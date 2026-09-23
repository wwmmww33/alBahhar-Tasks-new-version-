// src/components/AnnouncementsManagement.tsx
// لوحة المدير لنشر تحديثات النظام (تظهر للجميع عبر جرس التحديثات)
import { useEffect, useState } from 'react';
import { Megaphone, Trash2, Pencil, X } from 'lucide-react';
import type { CurrentUser } from '../types';

type Announcement = {
  AnnouncementID: number;
  Title: string;
  Body: string;
  CreatedByName?: string | null;
  CreatedAt: string;
  UpdatedAt?: string | null;
};

const formatDateTime = (dateStr: string) =>
  new Date(dateStr).toLocaleString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const AnnouncementsManagement = ({ currentUser }: { currentUser?: CurrentUser }) => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = String(currentUser?.UserID || '');

  const fetchAnnouncements = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/announcements?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (_) {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAnnouncements(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const resetForm = () => {
    setTitle('');
    setBody('');
    setEditingId(null);
    setError(null);
  };

  const startEdit = (a: Announcement) => {
    setEditingId(a.AnnouncementID);
    setTitle(a.Title);
    setBody(a.Body);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const isEdit = editingId != null;
      const res = await fetch(isEdit ? `/api/announcements/${editingId}` : '/api/announcements', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Title: title.trim(),
          Body: body.trim(),
          userId,
          isAdmin: true,
          FullName: currentUser?.FullName,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'فشل حفظ التحديث.');
        return;
      }
      resetForm();
      await fetchAnnouncements();
    } catch (_) {
      setError('تعذر الاتصال بالخادم.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('هل تريد حذف هذا التحديث نهائياً؟ سيختفي من جرس التحديثات لدى جميع المستخدمين.')) return;
    try {
      const res = await fetch(`/api/announcements/${id}?userId=${encodeURIComponent(userId)}&isAdmin=true`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setItems(prev => prev.filter(a => a.AnnouncementID !== id));
        if (editingId === id) resetForm();
      }
    } catch (_) {}
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-6">
        <Megaphone className="text-primary" size={24} />
        <h2 className="text-2xl font-bold text-content">تحديثات النظام</h2>
      </div>
      <p className="text-sm text-content-secondary mb-6">
        انشر تحديثاً ليظهر فوراً لجميع مستخدمي النظام عبر جرس التحديثات، ويبقى بإمكانهم العودة إليه لاحقاً.
      </p>

      <form onSubmit={handleSubmit} className="mb-8 p-4 bg-white dark:bg-gray-800 border border-content/10 rounded-lg space-y-3">
        {editingId != null && (
          <div className="flex items-center justify-between text-sm text-primary">
            <span>جارٍ تعديل تحديث منشور</span>
            <button type="button" onClick={resetForm} className="flex items-center gap-1 text-content-secondary hover:text-content">
              <X size={14} /> إلغاء التعديل
            </button>
          </div>
        )}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="عنوان التحديث..."
          required
          className="w-full p-2 border rounded-md bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="تفاصيل التحديث..."
          required
          rows={4}
          className="w-full p-2 border rounded-md bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 resize-none"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-60 text-sm font-semibold"
          >
            {submitting ? 'جارٍ الحفظ...' : editingId != null ? 'حفظ التعديل' : 'نشر التحديث'}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="text-content-secondary text-center py-8">جاري التحميل...</p>
      ) : items.length === 0 ? (
        <p className="text-content-secondary text-center py-8">لا توجد تحديثات منشورة بعد.</p>
      ) : (
        <div className="space-y-3">
          {items.map(a => (
            <div key={a.AnnouncementID} className="p-4 bg-white dark:bg-gray-800 border border-content/10 rounded-lg">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-content">{a.Title}</h3>
                  <p className="text-sm text-content-secondary whitespace-pre-wrap mt-1">{a.Body}</p>
                  <p className="text-xs text-content-secondary/70 mt-2">
                    {formatDateTime(a.CreatedAt)}{a.CreatedByName ? ` — ${a.CreatedByName}` : ''}
                    {a.UpdatedAt ? ' (مُعدَّل)' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => startEdit(a)}
                    className="p-1.5 text-content-secondary hover:text-primary hover:bg-primary/10 rounded"
                    title="تعديل"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(a.AnnouncementID)}
                    className="p-1.5 text-content-secondary hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    title="حذف"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AnnouncementsManagement;
