// src/components/ProposalsManagement.tsx
// لوحة المدير العام لمراجعة مقترحات تطوير النظام المقدَّمة من أي مستخدم (عبر زر "مقترح" في الشريط العلوي)
import { useEffect, useState } from 'react';
import { Lightbulb, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import type { CurrentUser } from '../types';

type Proposal = {
  ProposalID: number;
  Title: string;
  Description: string;
  CreatedByUserID: string;
  CreatedByName?: string | null;
  Status: 'pending' | 'under_review' | 'accepted' | 'rejected' | 'implemented';
  AdminNotes?: string | null;
  CreatedAt: string;
  UpdatedAt?: string | null;
};

const STATUS_LABELS: Record<Proposal['Status'], string> = {
  pending: 'قيد الانتظار',
  under_review: 'قيد الدراسة',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  implemented: 'تم التنفيذ',
};

const STATUS_STYLES: Record<Proposal['Status'], string> = {
  pending: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  under_review: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  accepted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  implemented: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
};

const formatDateTime = (dateStr: string) =>
  new Date(dateStr).toLocaleString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const ProposalsManagement = ({ currentUser }: { currentUser?: CurrentUser }) => {
  const userId = String(currentUser?.UserID || '');
  const [items, setItems] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | Proposal['Status']>('all');

  const fetchProposals = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals?userId=${encodeURIComponent(userId)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'تعذّر جلب المقترحات.');
        setItems([]);
        return;
      }
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (_) {
      setError('تعذّر الاتصال بالخادم.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProposals(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const handleStatusChange = async (p: Proposal, status: Proposal['Status']) => {
    setItems(prev => prev.map(x => x.ProposalID === p.ProposalID ? { ...x, Status: status } : x));
    try {
      const res = await fetch(`/api/proposals/${p.ProposalID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Status: status, userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.message || 'تعذّر تحديث الحالة.');
        fetchProposals();
      }
    } catch (_) {
      alert('تعذّر الاتصال بالخادم.');
      fetchProposals();
    }
  };

  const handleSaveNotes = async (p: Proposal) => {
    const notes = notesDraft[p.ProposalID] ?? p.AdminNotes ?? '';
    setSavingId(p.ProposalID);
    try {
      const res = await fetch(`/api/proposals/${p.ProposalID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ AdminNotes: notes, userId }),
      });
      if (res.ok) {
        const updated = await res.json();
        setItems(prev => prev.map(x => x.ProposalID === p.ProposalID ? updated : x));
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || 'تعذّر حفظ الملاحظات.');
      }
    } catch (_) {
      alert('تعذّر الاتصال بالخادم.');
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('هل تريد حذف هذا المقترح نهائياً؟')) return;
    try {
      const res = await fetch(`/api/proposals/${id}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      if (res.ok) {
        setItems(prev => prev.filter(p => p.ProposalID !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || 'تعذّر حذف المقترح.');
      }
    } catch (_) {
      alert('تعذّر الاتصال بالخادم.');
    }
  };

  const filteredItems = statusFilter === 'all' ? items : items.filter(p => p.Status === statusFilter);
  const countsByStatus = items.reduce((acc, p) => { acc[p.Status] = (acc[p.Status] || 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-2">
        <Lightbulb className="text-primary" size={24} />
        <h2 className="text-2xl font-bold text-content">مقترحات تطوير النظام</h2>
      </div>
      <p className="text-sm text-content-secondary mb-6">
        المقترحات التي يقدّمها المستخدمون عبر زر "مقترح" في الشريط العلوي. يمكنك تغيير حالة أي مقترح وإضافة ملاحظة عليه.
      </p>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border ${statusFilter === 'all' ? 'bg-primary text-white border-primary' : 'border-content/20 text-content-secondary hover:bg-content/5'}`}
        >
          الكل ({items.length})
        </button>
        {(Object.keys(STATUS_LABELS) as Proposal['Status'][]).map(st => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${statusFilter === st ? 'bg-primary text-white border-primary' : 'border-content/20 text-content-secondary hover:bg-content/5'}`}
          >
            {STATUS_LABELS[st]} ({countsByStatus[st] || 0})
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {loading ? (
        <p className="text-content-secondary text-center py-8">جاري التحميل...</p>
      ) : filteredItems.length === 0 ? (
        <p className="text-content-secondary text-center py-8">لا توجد مقترحات {statusFilter !== 'all' ? 'بهذه الحالة' : 'بعد'}.</p>
      ) : (
        <div className="space-y-3">
          {filteredItems.map(p => {
            const isExpanded = expandedId === p.ProposalID;
            return (
              <div key={p.ProposalID} className="p-4 bg-white dark:bg-gray-800 border border-content/10 rounded-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-content">{p.Title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[p.Status]}`}>
                        {STATUS_LABELS[p.Status]}
                      </span>
                    </div>
                    <p className={`text-sm text-content-secondary whitespace-pre-wrap mt-1 ${isExpanded ? '' : 'line-clamp-2'}`}>
                      {p.Description}
                    </p>
                    <p className="text-xs text-content-secondary/70 mt-2">
                      {formatDateTime(p.CreatedAt)} — {p.CreatedByName || p.CreatedByUserID}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : p.ProposalID)}
                      className="p-1.5 text-content-secondary hover:text-primary hover:bg-primary/10 rounded"
                      title={isExpanded ? 'طي' : 'تفاصيل'}
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <button
                      onClick={() => handleDelete(p.ProposalID)}
                      className="p-1.5 text-content-secondary hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                      title="حذف"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-content/10 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-content-secondary mb-1">تغيير الحالة</label>
                      <select
                        value={p.Status}
                        onChange={(e) => handleStatusChange(p, e.target.value as Proposal['Status'])}
                        className="p-2 border rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm"
                      >
                        {(Object.keys(STATUS_LABELS) as Proposal['Status'][]).map(st => (
                          <option key={st} value={st}>{STATUS_LABELS[st]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-content-secondary mb-1">ملاحظة المدير (اختياري)</label>
                      <textarea
                        value={notesDraft[p.ProposalID] ?? p.AdminNotes ?? ''}
                        onChange={(e) => setNotesDraft(prev => ({ ...prev, [p.ProposalID]: e.target.value }))}
                        rows={3}
                        placeholder="ملاحظة أو رد على المقترح..."
                        className="w-full p-2 border rounded-md bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm resize-none"
                      />
                      <div className="flex justify-end mt-1.5">
                        <button
                          onClick={() => handleSaveNotes(p)}
                          disabled={savingId === p.ProposalID}
                          className="px-3 py-1.5 bg-primary text-white rounded-md text-xs hover:bg-primary-dark disabled:opacity-60"
                        >
                          {savingId === p.ProposalID ? 'جارٍ الحفظ...' : 'حفظ الملاحظة'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProposalsManagement;
