// src/components/SuggestProposalButton.tsx
// زر متاح لجميع المستخدمين لتقديم مقترح لتطوير النظام — يصل إلى تبويب "إدارة النظام" الخاص
// بالمدير العام للنظام فقط، حيث يمكنه مراجعته وتغيير حالته.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Lightbulb, X } from 'lucide-react';
import type { CurrentUser } from '../types';

type Props = {
  currentUser: CurrentUser;
};

const SuggestProposalButton = ({ currentUser }: Props) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const reset = () => {
    setTitle('');
    setDescription('');
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    setOpen(false);
    reset();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Title: title.trim(),
          Description: description.trim(),
          userId: currentUser.UserID,
          FullName: currentUser.FullName,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'تعذّر إرسال المقترح.');
        return;
      }
      setSuccess(true);
      setTitle('');
      setDescription('');
    } catch (_) {
      setError('تعذّر الاتصال بالخادم.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-2 rounded-full text-content-secondary hover:bg-primary/10 hover:text-primary transition-colors"
        title="تقديم مقترح لتطوير النظام"
      >
        <Lightbulb size={20} />
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && handleClose()}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md flex flex-col gap-4 p-5" dir="rtl">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-primary flex items-center gap-2">
                <Lightbulb size={18} /> مقترح لتطوير النظام
              </h3>
              <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X size={18} />
              </button>
            </div>

            {success ? (
              <div className="text-center py-4">
                <p className="text-green-600 dark:text-green-400 font-medium mb-3">✓ تم إرسال مقترحك بنجاح، شكراً لمساهمتك.</p>
                <div className="flex gap-2 justify-center">
                  <button onClick={reset} className="px-4 py-2 border border-content/20 rounded-md text-sm hover:bg-content/5">إرسال مقترح آخر</button>
                  <button onClick={handleClose} className="px-4 py-2 bg-primary text-white rounded-md text-sm hover:bg-primary-dark">إغلاق</button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <p className="text-xs text-content-secondary">
                  شاركنا أي فكرة لتحسين النظام أو ميزة جديدة تراها مفيدة. ستصل إلى المدير العام للنظام لمراجعتها.
                </p>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="عنوان المقترح..."
                  required
                  className="w-full p-2 border rounded-md bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm"
                />
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="اشرح مقترحك بالتفصيل..."
                  required
                  rows={5}
                  className="w-full p-2 border rounded-md bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm resize-none"
                />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={handleClose} className="px-4 py-2 text-content-secondary hover:bg-content/10 rounded-md text-sm">إلغاء</button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-60 text-sm font-semibold"
                  >
                    {submitting ? 'جارٍ الإرسال...' : 'إرسال المقترح'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default SuggestProposalButton;
