// src/components/RegistrationRequests.tsx
import { useState, useEffect, useCallback } from 'react';
import { Check, Trash2 } from 'lucide-react';
import type { CurrentUser } from '../types';

type Request = {
  RequestID: number;
  UserID: string;
  FullName: string;
  DepartmentName: string;
  VacancyName?: string | null;
  Rank?: string | number | null;
};

type ConflictInfo = {
  requestId: number;
  vacancyName: string;
  currentUserName: string;
};

type Vacancy = {
  VacancyID: number;
  Name: string;
};

const RegistrationRequests = ({ currentUser }: { currentUser?: CurrentUser }) => {
  const [requests, setRequests] = useState<Request[]>([]);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [selectedVacancyId, setSelectedVacancyId] = useState<number | ''>('');
  const [showVacancyPicker, setShowVacancyPicker] = useState(false);

  const isDeptManager = (currentUser?.Role ?? 0) === 2;
  const managerDeptId = isDeptManager ? currentUser?.DepartmentID : null;

  const fetchRequests = useCallback(async () => {
    const url = managerDeptId
      ? `/api/users/requests?departmentId=${managerDeptId}`
      : '/api/users/requests';
    const res = await fetch(url);
    if (!res.ok) return;
    setRequests(await res.json());
  }, [managerDeptId]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const doApprove = async (requestId: number, action?: string, overrideVacancyId?: number) => {
    const body: Record<string, unknown> = {};
    if (action) body.action = action;
    if (overrideVacancyId) body.overrideVacancyId = overrideVacancyId;

    const res = await fetch(`/api/users/requests/${requestId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 409) {
      const data = await res.json();
      if (data.occupied) {
        setConflict({
          requestId,
          vacancyName: data.vacancyName || '—',
          currentUserName: data.currentUserName || data.currentUserId || '—',
        });
        return;
      }
    }

    closeConflict();
    fetchRequests();
  };

  const closeConflict = () => {
    setConflict(null);
    setShowVacancyPicker(false);
    setSelectedVacancyId('');
    setVacancies([]);
  };

  const handleApprove = (requestId: number) => doApprove(requestId);

  const handleConflictReplace = () => conflict && doApprove(conflict.requestId, 'replace');
  const handleConflictNoVacancy = () => conflict && doApprove(conflict.requestId, 'no_vacancy');

  const handleShowVacancyPicker = async () => {
    if (!vacancies.length) {
      const res = await fetch('/api/vacancies/all');
      if (res.ok) setVacancies(await res.json());
    }
    setShowVacancyPicker(true);
  };

  const handleConflictNewVacancy = () => {
    if (!conflict || !selectedVacancyId) return;
    doApprove(conflict.requestId, 'new_vacancy', Number(selectedVacancyId));
  };

  const handleDelete = async (requestId: number) => {
    if (!window.confirm('هل تريد حذف هذا الطلب نهائياً؟')) return;
    await fetch(`/api/users/requests/${requestId}`, { method: 'DELETE' });
    fetchRequests();
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
      <h2 className="text-2xl font-semibold mb-4 text-content">طلبات التسجيل المعلقة</h2>

      {conflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-content mb-2">المنصب مشغول</h3>
            <p className="text-sm text-content-secondary mb-4">
              المنصب <strong>"{conflict.vacancyName}"</strong> مشغول حالياً بـ{' '}
              <strong>{conflict.currentUserName}</strong>. كيف تريد المتابعة؟
            </p>

            {showVacancyPicker && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-content mb-1">اختر منصباً آخر:</label>
                <select
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg p-2 text-sm bg-white dark:bg-gray-700 text-content"
                  value={selectedVacancyId}
                  onChange={e => setSelectedVacancyId(Number(e.target.value) || '')}
                >
                  <option value="">— اختر منصباً —</option>
                  {vacancies.map(v => (
                    <option key={v.VacancyID} value={v.VacancyID}>{v.Name}</option>
                  ))}
                </select>
                {selectedVacancyId && (
                  <button
                    onClick={handleConflictNewVacancy}
                    className="mt-2 w-full py-2 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium"
                  >
                    تأكيد المنصب الجديد
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={handleConflictReplace}
                className="w-full py-2 px-4 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium"
              >
                استبدال {conflict.currentUserName} بالمستخدم الجديد
              </button>
              {!showVacancyPicker && (
                <button
                  onClick={handleShowVacancyPicker}
                  className="w-full py-2 px-4 rounded-lg bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-200 text-sm font-medium"
                >
                  اختيار منصب آخر...
                </button>
              )}
              <button
                onClick={handleConflictNoVacancy}
                className="w-full py-2 px-4 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-content text-sm font-medium"
              >
                اعتماد بدون تعيين منصب
              </button>
              <button
                onClick={closeConflict}
                className="w-full py-2 px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-content-secondary text-sm"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {requests.length === 0 ? (
        <p className="text-content-secondary">لا توجد طلبات تسجيل معلقة حالياً.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="border-b border-content/10">
              <tr>
                <th className="p-2 font-semibold">المعرف</th>
                <th className="p-2 font-semibold">الاسم الكامل</th>
                <th className="p-2 font-semibold">القسم</th>
                <th className="p-2 font-semibold">المنصب</th>
                <th className="p-2 font-semibold">الرتبة</th>
                <th className="p-2 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(req => (
                <tr key={req.RequestID} className="border-b border-content/10 hover:bg-content/5">
                  <td className="p-2 font-mono text-sm">{req.UserID}</td>
                  <td className="p-2">{req.FullName}</td>
                  <td className="p-2">{req.DepartmentName}</td>
                  <td className="p-2">
                    {req.VacancyName
                      ? <span className="text-sm">{req.VacancyName}</span>
                      : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="p-2">
                    {req.Rank
                      ? <span className="text-sm">{req.Rank}</span>
                      : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="p-2 flex gap-3">
                    <button
                      onClick={() => handleApprove(req.RequestID)}
                      className="text-green-500 hover:text-green-700"
                      title="اعتماد الطلب"
                    >
                      <Check size={18}/>
                    </button>
                    <button
                      onClick={() => handleDelete(req.RequestID)}
                      className="text-red-500 hover:text-red-700"
                      title="حذف الطلب"
                    >
                      <Trash2 size={18}/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default RegistrationRequests;
