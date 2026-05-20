// src/components/RegistrationRequests.tsx
import { useState, useEffect, useCallback } from 'react';
import { Check, Trash2 } from 'lucide-react';

type Request = {
  RequestID: number;
  UserID: string;
  FullName: string;
  DepartmentName: string;
  VacancyName?: string | null;
  Rank?: string | number | null;
};

const RegistrationRequests = () => {
  const [requests, setRequests] = useState<Request[]>([]);

  const fetchRequests = useCallback(async () => {
    const res = await fetch('/api/users/requests');
    const data = await res.json();
    setRequests(data);
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleApprove = async (requestId: number) => {
    await fetch(`/api/users/requests/${requestId}/approve`, { method: 'POST' });
    fetchRequests();
  };

  const handleDelete = async (requestId: number) => {
    if (!window.confirm('هل تريد حذف هذا الطلب نهائياً؟')) return;
    await fetch(`/api/users/requests/${requestId}`, { method: 'DELETE' });
    fetchRequests();
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
      <h2 className="text-2xl font-semibold mb-4 text-content">طلبات التسجيل المعلقة</h2>
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
