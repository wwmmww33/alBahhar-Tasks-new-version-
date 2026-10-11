// src/components/PublicCalendarDrawer.tsx
// يتيح الوصول للتقويم العام (نفس المعروض في صفحة الدخول) بعد تسجيل الدخول — عبر زر ثابت في
// الجهة اليسرى من الشاشة، ينسدل عند الضغط عليه التقويم (حركةً من اليسار نحو اليمين) ليرسو
// مستقراً من الحد الأيسر للشاشة وحتى منتصفها (نصف الشاشة الأيسر)، مع إمكانية طيّه (إغلاقه) مرة
// أخرى. حدّه الأعلى يلامس الحد الأدنى للنافبار تماماً. لا يظهر الزر إطلاقاً إن كان التقويم العام
// معطَّلاً أو فارغاً (نفس شرط الظهور في صفحة الدخول، عبر onAvailabilityChange).
import { useState } from 'react';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import PublicCalendarPreview from './PublicCalendarPreview';
import type { CurrentUser } from '../types';
import { resolveCurrentActorId } from '../utils/actorIdentity';

type PublicCalendarDrawerProps = {
  currentUser: CurrentUser;
};

const PublicCalendarDrawer = ({ currentUser }: PublicCalendarDrawerProps) => {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(false);
  const actorId = resolveCurrentActorId(currentUser) || currentUser.UserID;

  return (
    <>
      {/* زر التبديل — ثابت في الجهة اليسرى من الشاشة، فوق اللوحة دوماً ليبقى قابلاً للنقر */}
      {available && (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="fixed left-0 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1.5 bg-primary text-white rounded-r-lg shadow-lg px-2 py-4 hover:bg-primary-dark transition-colors"
          title={open ? 'طيّ التقويم العام' : 'عرض التقويم العام'}
        >
          <CalendarIcon size={18} />
        </button>
      )}

      {/* ستارة خلفية شفافة — تُغلق التقويم عند الضغط عليها خارجه */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 z-30"
          onClick={() => setOpen(false)}
        />
      )}

      {/* لوحة التقويم المنسدلة — ترسو من الحد الأيسر للشاشة حتى منتصفها (نصف الشاشة الأيسر)،
          والحركة نفسها من اليسار نحو اليمين: تنطلق مطويّة بالكامل خارج يسار الشاشة
          (-translate-x-full) وتتحرك يميناً حتى تستقر في موضعها (translate-x-0).
          الحد الأعلى يلامس الحد الأدنى للنافبار تماماً (top-16 = ارتفاع النافبار h-16 نفسه). */}
      <div
        dir="rtl"
        className={`fixed top-16 bottom-0 left-0 z-40 w-full sm:w-1/2 bg-bkg shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-full overflow-y-auto p-4">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mb-2 flex items-center gap-1.5 text-sm text-content-secondary hover:text-content px-2 py-1 rounded-md border border-content/20 hover:bg-content/5 transition-colors"
          >
            <X size={15} />
            طيّ التقويم
          </button>
          <PublicCalendarPreview
            onAvailabilityChange={setAvailable}
            className="w-full"
            currentUserId={String(actorId)}
            isAdmin={!!currentUser.IsAdmin}
          />
        </div>
      </div>
    </>
  );
};

export default PublicCalendarDrawer;
