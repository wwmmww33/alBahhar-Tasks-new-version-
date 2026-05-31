// src/pages/UserProfile.tsx
import React, { useState, useEffect, useRef } from 'react';
import { User, Lock, Building, Save, Eye, EyeOff, ArrowRightLeft, RotateCcw, AlertTriangle } from 'lucide-react';
import type { CurrentUser } from '../types';
import { resolveCurrentActorId } from '../utils/actorIdentity';

type Vacancy = {
  VacancyID: number;
  Name: string;
  CurrentUserID?: string | null;
  CurrentUserFullName?: string | null;
};

type TransferResult = {
  transferId: string;
  totalAffected: number;
  affectedCounts: Record<string, number>;
};

type UserProfileProps = {
  currentUser: CurrentUser;
  onUserUpdate: (updatedUser: CurrentUser) => void;
};

const UNDO_TIMEOUT_MS = 5 * 60 * 1000; // 5 دقائق

const UserProfile: React.FC<UserProfileProps> = ({ currentUser, onUserUpdate }) => {
  const [fullName, setFullName] = useState(currentUser.FullName);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // حالة النقل
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [targetVacancyId, setTargetVacancyId] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferMessage, setTransferMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [lastTransfer, setLastTransfer] = useState<TransferResult | null>(null);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (currentUser.UserID) {
      fetchVacancies(currentUser.UserID);
    }
  }, [currentUser.UserID]);

  // تنظيف المؤقت عند إلغاء تحميل المكوّن
  useEffect(() => {
    return () => { if (undoTimerRef.current) clearInterval(undoTimerRef.current); };
  }, []);

  const fetchVacancies = async (userId: string) => {
    try {
      const res = await fetch(`/api/vacancies/user-scope/${encodeURIComponent(userId)}`);
      if (res.ok) {
        const data: Vacancy[] = await res.json();
        // الخادم يُستثني منصب المستخدم الحالي تلقائياً
        setVacancies(data);
      }
    } catch (err) {
      console.error('Error fetching vacancies:', err);
    }
  };

  const startUndoCountdown = (transferId: string, result: TransferResult) => {
    if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    setLastTransfer(result);
    setUndoSecondsLeft(UNDO_TIMEOUT_MS / 1000);

    undoTimerRef.current = setInterval(() => {
      setUndoSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(undoTimerRef.current!);
          setLastTransfer(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setIsLoading(true);

    if (newPassword && newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'كلمات المرور الجديدة غير متطابقة' });
      setIsLoading(false);
      return;
    }

    if (newPassword && newPassword.length < 4) {
      setMessage({ type: 'error', text: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' });
      setIsLoading(false);
      return;
    }

    try {
      const updateData: Record<string, any> = { FullName: fullName };

      if (newPassword) {
        updateData.PasswordHash = newPassword;
        updateData.CurrentPassword = currentPassword;
      }

      const response = await fetch('/api/profile/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updateData, UserID: currentUser.UserID }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'تم تحديث الملف الشخصي بنجاح' });
        onUserUpdate({ ...currentUser, FullName: fullName });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setMessage({ type: 'error', text: data.message || 'حدث خطأ أثناء التحديث' });
      }
    } catch {
      setMessage({ type: 'error', text: 'حدث خطأ في الاتصال بالخادم' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!targetVacancyId) return;

    const targetVacancy = vacancies.find(v => String(v.VacancyID) === targetVacancyId);
    const targetName = targetVacancy
      ? `${targetVacancy.Name}${targetVacancy.CurrentUserFullName ? ` (${targetVacancy.CurrentUserFullName})` : ' (شاغر)'}`
      : targetVacancyId;

    const confirmed = window.confirm(
      `سيتم نقل جميع المهام والمهام الفرعية والتعليقات الخاصة بمنصبك إلى:\n${targetName}\n\nهل تريد المتابعة؟`
    );
    if (!confirmed) return;

    setIsTransferring(true);
    setTransferMessage(null);
    setLastTransfer(null);
    if (undoTimerRef.current) clearInterval(undoTimerRef.current);

    try {
      const res = await fetch('/api/profile/transfer-vacancy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ UserID: currentUser.UserID, ToVacancyID: parseInt(targetVacancyId) }),
      });
      const data = await res.json();

      if (res.ok) {
        const result: TransferResult = {
          transferId: data.transferId,
          totalAffected: data.totalAffected,
          affectedCounts: data.affectedCounts,
        };
        setTransferMessage({
          type: 'success',
          text: `تم نقل ${data.totalAffected} سجل بنجاح إلى ${targetName}.`,
        });
        setTargetVacancyId('');
        startUndoCountdown(data.transferId, result);
      } else {
        setTransferMessage({ type: 'error', text: data.message || 'حدث خطأ أثناء النقل.' });
      }
    } catch {
      setTransferMessage({ type: 'error', text: 'حدث خطأ في الاتصال بالخادم.' });
    } finally {
      setIsTransferring(false);
    }
  };

  const handleUndo = async () => {
    if (!lastTransfer) return;

    const confirmed = window.confirm('هل تريد التراجع عن آخر عملية نقل واستعادة البيانات للمنصب الأصلي؟');
    if (!confirmed) return;

    try {
      const res = await fetch('/api/profile/undo-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId: lastTransfer.transferId, UserID: currentUser.UserID }),
      });
      const data = await res.json();

      if (res.ok) {
        setTransferMessage({ type: 'success', text: `تم التراجع بنجاح. استُعيد ${data.totalRestored} سجل.` });
        setLastTransfer(null);
        setUndoSecondsLeft(0);
        if (undoTimerRef.current) clearInterval(undoTimerRef.current);
      } else {
        setTransferMessage({ type: 'error', text: data.message || 'فشل التراجع.' });
      }
    } catch {
      setTransferMessage({ type: 'error', text: 'حدث خطأ في الاتصال بالخادم.' });
    }
  };

  const currentVacancyId = resolveCurrentActorId(currentUser) || currentUser.VacancyID || currentUser.CurrentVacancyID;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-bkg border border-content/10 rounded-lg shadow-sm">
        <div className="p-6 border-b border-content/10">
          <h1 className="text-2xl font-bold text-content flex items-center gap-2">
            <User className="h-6 w-6" />
            الملف الشخصي
          </h1>
          <p className="text-content-secondary mt-1">إدارة معلوماتك الشخصية وكلمة المرور</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* المعلومات الأساسية */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-content flex items-center gap-2">
              <User className="h-5 w-5" />
              المعلومات الأساسية
            </h2>

            <div>
              <label className="block text-sm font-medium text-content mb-1">معرف المستخدم</label>
              <input
                type="text"
                value={currentUser.UserID}
                disabled
                className="w-full p-3 border border-content/20 rounded-md bg-content/5 text-content-secondary cursor-not-allowed"
              />
              <p className="text-xs text-content-secondary mt-1">لا يمكن تغيير معرف المستخدم</p>
            </div>

            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-content mb-1">الاسم الكامل</label>
              <input
                type="text"
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full p-3 border border-content/20 rounded-md bg-bkg focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>

            {/* القسم — للعرض فقط */}
            <div>
              <label className="block text-sm font-medium text-content mb-1">القسم</label>
              <div className="flex items-center gap-2 p-3 border border-content/20 rounded-md bg-content/5">
                <Building className="h-5 w-5 text-content-secondary flex-shrink-0" />
                <span className="text-content-secondary">
                  {currentUser.DepartmentName || (currentUser.DepartmentID ? `قسم #${currentUser.DepartmentID}` : 'غير محدد')}
                </span>
              </div>
              <p className="text-xs text-content-secondary mt-1">يُحدَّد القسم من خلال المنصب الوظيفي ولا يمكن تغييره هنا</p>
            </div>

            {currentVacancyId && (
              <div>
                <label className="block text-sm font-medium text-content mb-1">المنصب الحالي</label>
                <div className="flex items-center gap-2 p-3 border border-content/20 rounded-md bg-content/5">
                  <span className="text-content-secondary">
                    {currentUser.VacancyName || `منصب #${currentVacancyId}`}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* تغيير كلمة المرور */}
          <div className="space-y-4 border-t border-content/10 pt-6">
            <h2 className="text-lg font-semibold text-content flex items-center gap-2">
              <Lock className="h-5 w-5" />
              تغيير كلمة المرور
            </h2>
            <p className="text-sm text-content-secondary">اتركه فارغاً إذا كنت لا تريد تغيير كلمة المرور</p>

            <div>
              <label htmlFor="currentPassword" className="block text-sm font-medium text-content mb-1">كلمة المرور الحالية</label>
              <div className="relative">
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  id="currentPassword"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full p-3 pr-10 border border-content/20 rounded-md bg-bkg focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder="أدخل كلمة المرور الحالية لتغييرها"
                />
                <button type="button" onClick={() => setShowCurrentPassword(!showCurrentPassword)} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-secondary hover:text-content">
                  {showCurrentPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-content mb-1">كلمة المرور الجديدة</label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  id="newPassword"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full p-3 pr-10 border border-content/20 rounded-md bg-bkg focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder="أدخل كلمة المرور الجديدة"
                />
                <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-secondary hover:text-content">
                  {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-content mb-1">تأكيد كلمة المرور الجديدة</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full p-3 pr-10 border border-content/20 rounded-md bg-bkg focus:ring-2 focus:ring-primary focus:border-primary"
                  placeholder="أعد إدخال كلمة المرور الجديدة"
                />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-secondary hover:text-content">
                  {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
          </div>

          {message && (
            <div className={`p-4 rounded-md ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              {message.text}
            </div>
          )}

          <div className="border-t border-content/10 pt-6">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-primary text-white py-3 px-4 rounded-md hover:bg-primary-dark disabled:bg-content/20 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
            >
              {isLoading ? (
                <><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />جاري الحفظ...</>
              ) : (
                <><Save className="h-5 w-5" />حفظ التغييرات</>
              )}
            </button>
          </div>
        </form>

        {/* ---- نقل بيانات المنصب ---- */}
        {currentVacancyId && (
          <div className="p-6 border-t border-content/10 space-y-4">
            <h2 className="text-lg font-semibold text-content flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              نقل بيانات المنصب
            </h2>

            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-md flex gap-2 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <span>
                تنقل هذه الميزة جميع المهام والمهام الفرعية والتعليقات المنسوبة لمنصبك الحالي إلى منصب آخر داخل نفس القسم.
                مفيدة عند إلغاء المنصب. يمكن التراجع خلال 5 دقائق من تنفيذها.
              </span>
            </div>

            {/* رسالة نتيجة النقل */}
            {transferMessage && (
              <div className={`p-3 rounded-md text-sm flex items-start justify-between gap-2 ${transferMessage.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                <span>{transferMessage.text}</span>
                {lastTransfer && transferMessage.type === 'success' && (
                  <button
                    type="button"
                    onClick={handleUndo}
                    className="flex items-center gap-1 px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-md text-xs font-medium flex-shrink-0 border border-amber-300 transition-colors"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    تراجع ({Math.floor(undoSecondsLeft / 60)}:{String(undoSecondsLeft % 60).padStart(2, '0')})
                  </button>
                )}
              </div>
            )}

            {vacancies.length > 0 ? (
              <div className="flex gap-2">
                <select
                  value={targetVacancyId}
                  onChange={(e) => setTargetVacancyId(e.target.value)}
                  className="flex-1 p-3 border border-content/20 rounded-md bg-bkg focus:ring-2 focus:ring-primary focus:border-primary"
                >
                  <option value="">-- اختر المنصب المستهدف --</option>
                  {vacancies.map((v) => (
                    <option key={v.VacancyID} value={v.VacancyID}>
                      {v.Name}
                      {v.CurrentUserFullName ? ` — ${v.CurrentUserFullName}` : ' — (شاغر)'}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleTransfer}
                  disabled={!targetVacancyId || isTransferring}
                  className="px-4 py-3 bg-amber-600 hover:bg-amber-700 disabled:bg-content/20 disabled:cursor-not-allowed text-white rounded-md font-medium flex items-center gap-2 transition-colors"
                >
                  {isTransferring ? (
                    <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />جاري النقل...</>
                  ) : (
                    <><ArrowRightLeft className="h-4 w-4" />نقل البيانات</>
                  )}
                </button>
              </div>
            ) : (
              <p className="text-sm text-content-secondary">
                {currentUser.DepartmentID
                  ? 'لا توجد مناصب أخرى في نفس القسم.'
                  : 'يجب أن يكون لديك قسم محدد لاستخدام هذه الميزة.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default UserProfile;
