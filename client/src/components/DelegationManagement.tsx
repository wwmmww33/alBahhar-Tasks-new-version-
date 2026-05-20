// src/components/DelegationManagement.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Edit, Trash2, Plus, CheckCircle, XCircle } from 'lucide-react';
import { resolveCurrentActorId } from '../utils/actorIdentity';

type VacancyOption = {
  UserID: string;               // VacancyID as string — used as DelegateID
  FullName: string;             // "VacancyName (PersonName)"
  VacancyID: number;
  CurrentUserID: string | null;
  CurrentUserFullName: string | null;
};

type Delegation = {
  DelegationID: number;
  DelegatorID: string;
  DelegatorName: string;
  DelegateID: string;
  DelegateName: string;
  StartDate: string;
  EndDate: string | null;
  IsActive: boolean;
  CreatedAt: string;
};

type NewDelegation = {
  DelegateID: string;
  StartDate: string;
  EndDate: string;
  DelegationPassword?: string;
};

const DelegationManagement = () => {
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [users, setUsers] = useState<VacancyOption[]>([]);
  const [editingDelegation, setEditingDelegation] = useState<Delegation | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newDelegation, setNewDelegation] = useState<NewDelegation>({
    DelegateID: '',
    StartDate: '',
    EndDate: '',
    DelegationPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const storedUser = localStorage.getItem('albahar-user');
    const parsedUser = storedUser ? JSON.parse(storedUser) : null;
    const userId = resolveCurrentActorId(parsedUser) || parsedUser?.UserID || '';

    const deptId = parsedUser?.DepartmentID;
    try {
      if (deptId) {
        const scopeRes = await fetch(`/api/vacancies/department/${deptId}/scope`);
        if (scopeRes.ok) {
          const scopeData: VacancyOption[] = await scopeRes.json();
          setUsers(scopeData);
        } else {
          setUsers([]);
        }
      } else {
        setUsers([]);
      }
    } catch (e) {
      setUsers([]);
    }

    try {
      if (userId) {
        const headers = { 'user-id': userId, 'Content-Type': 'application/json' };
        const delegationsRes = await fetch('/api/delegations', { headers });
        if (delegationsRes.ok) {
          const delegationsData = await delegationsRes.json();
          setDelegations(delegationsData);
          setError(null);
        } else {
          setDelegations([]);
          setError('فشل في جلب التفويضات، قائمة الأسماء متاحة');
        }
      } else {
        setDelegations([]);
        setError(null);
      }
    } catch (error) {
      console.error('Failed to fetch delegations:', error);
      setError('فشل في جلب التفويضات، قائمة الأسماء متاحة');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDelegation.DelegateID || !newDelegation.StartDate) return;
    
    try {
      setLoading(true);
      const storedUser = localStorage.getItem('albahar-user');
      const parsedUser = storedUser ? JSON.parse(storedUser) : null;
      const userId = resolveCurrentActorId(parsedUser) || parsedUser?.UserID || '';
      const response = await fetch('/api/delegations', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'user-id': userId
        },
        body: JSON.stringify(newDelegation),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'فشل في إنشاء التفويض');
      }
      const created = await response.json();
      const createdDelegationId: number | null = created?.DelegationID ?? null;

      // حفظ سر التفويض الخاص بهذه العملية إن وُجد
      if (createdDelegationId && newDelegation.DelegationPassword) {
        const storedUser2 = localStorage.getItem('albahar-user');
        const parsedUser2 = storedUser2 ? JSON.parse(storedUser2) : null;
        const userId2 = resolveCurrentActorId(parsedUser2) || parsedUser2?.UserID || '';
        try {
          await fetch(`/api/delegations/${createdDelegationId}/secret`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'user-id': userId2
            },
            body: JSON.stringify({ DelegationPassword: newDelegation.DelegationPassword })
          });
        } catch (e) {
          // تجاهل الخطأ هنا؛ سيتمكن المستخدم من تحديث السر لاحقاً
        }
      }

      setNewDelegation({ DelegateID: '', StartDate: '', EndDate: '', DelegationPassword: '' });
      setShowCreateForm(false);
      fetchData();
      setError(null);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDelegation) return;
    
    try {
      setLoading(true);
      const storedUser = localStorage.getItem('albahar-user');
      const parsedUser = storedUser ? JSON.parse(storedUser) : null;
      const userId = resolveCurrentActorId(parsedUser) || parsedUser?.UserID || '';
      const response = await fetch(`/api/delegations/${editingDelegation.DelegationID}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'user-id': userId
        },
        body: JSON.stringify({
          StartDate: editingDelegation.StartDate,
          EndDate: editingDelegation.EndDate,
          IsActive: editingDelegation.IsActive
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'فشل في تحديث التفويض');
      }
      
      setEditingDelegation(null);
      fetchData();
      setError(null);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (delegationId: number) => {
    if (!confirm('هل أنت متأكد من حذف هذا التفويض؟')) return;
    
    try {
      setLoading(true);
      const storedUser = localStorage.getItem('albahar-user');
      const parsedUser = storedUser ? JSON.parse(storedUser) : null;
      const userId = resolveCurrentActorId(parsedUser) || parsedUser?.UserID || '';
      const response = await fetch(`/api/delegations/${delegationId}`, {
        method: 'DELETE',
        headers: {
          'user-id': userId
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'فشل في حذف التفويض');
      }
      
      fetchData();
      setError(null);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    // فرض التقويم الميلادي حتى مع اللغة العربية السعودية
    return d.toLocaleDateString('ar-SA-u-ca-gregory', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  };

  const isExpired = (endDate: string | null) => {
    if (!endDate) return false;
    return new Date(endDate) < new Date();
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}
      
      {/* زر إنشاء تفويض جديد */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold text-content">إدارة التفويضات</h2>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-md hover:bg-primary-dark"
          disabled={loading}
        >
          <Plus size={16} />
          تفويض جديد
        </button>
      </div>

      {/* نموذج إنشاء تفويض جديد */}
      {showCreateForm && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border">
          <h3 className="text-lg font-semibold mb-4 text-content">إنشاء تفويض جديد</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-content mb-1">
                المفوض إليه
              </label>
              <select
                value={newDelegation.DelegateID}
                onChange={(e) => setNewDelegation({...newDelegation, DelegateID: e.target.value})}
                required
                className="w-full p-2 border rounded bg-bkg border-content/20 text-content"
              >
                <option value="">-- اختر المفوض إليه --</option>
                {users.map(user => (
                  <option key={user.UserID} value={user.UserID}>
                    {user.FullName}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-content mb-1">
                تاريخ البداية
              </label>
              <input
                type="date"
                value={newDelegation.StartDate}
                onChange={(e) => setNewDelegation({...newDelegation, StartDate: e.target.value})}
                required
                className="w-full p-2 border rounded bg-bkg border-content/20 text-content"
              />
          </div>

            <div>
              <label className="block text-sm font-medium text-content mb-1">
                تاريخ النهاية (اختياري)
              </label>
              <input
                type="date"
                value={newDelegation.EndDate}
                onChange={(e) => setNewDelegation({...newDelegation, EndDate: e.target.value})}
                className="w-full p-2 border rounded bg-bkg border-content/20 text-content"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-content mb-1">
                الرمز السري لهذا التفويض (اختياري)
              </label>
              <input
                type="text"
                value={newDelegation.DelegationPassword || ''}
                onChange={(e) => setNewDelegation({...newDelegation, DelegationPassword: e.target.value})}
                className="w-full p-2 border rounded bg-bkg border-content/20 text-content"
                placeholder="أدخل السر الخاص بهذا التفويض"
              />
            </div>
            
            <div className="flex gap-2 pt-4">
              <button
                type="submit"
                disabled={loading}
                className="bg-primary text-white px-4 py-2 rounded hover:bg-primary-dark disabled:opacity-50"
              >
                {loading ? 'جاري الإنشاء...' : 'إنشاء التفويض'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setNewDelegation({ DelegateID: '', StartDate: '', EndDate: '', DelegationPassword: '' });
                }}
                className="border border-content/20 text-content px-4 py-2 rounded hover:bg-content/5"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* جدول التفويضات */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-content/10">
              <tr>
                <th className="p-4 font-semibold text-content">الحالة</th>
                <th className="p-4 font-semibold text-content">المفوض</th>
                <th className="p-4 font-semibold text-content">المفوض إليه</th>
                <th className="p-4 font-semibold text-content">تاريخ البداية</th>
                <th className="p-4 font-semibold text-content">تاريخ النهاية</th>
                <th className="p-4 font-semibold text-content">تاريخ الإنشاء</th>
                <th className="p-4 font-semibold text-content">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading && delegations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-content-secondary">
                    جاري التحميل...
                  </td>
                </tr>
              ) : delegations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-content-secondary">
                    لا توجد تفويضات
                  </td>
                </tr>
              ) : (
                delegations.map(delegation => (
                  <tr key={delegation.DelegationID} className="border-b border-content/10 hover:bg-content/5">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {delegation.IsActive && !isExpired(delegation.EndDate) ? (
                          <CheckCircle size={18} className="text-green-500" aria-label="نشط" />
                        ) : (
                          <XCircle size={18} className="text-red-500" aria-label="غير نشط" />
                        )}
                        <span className={`text-xs px-2 py-1 rounded ${
                          delegation.IsActive && !isExpired(delegation.EndDate)
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {delegation.IsActive && !isExpired(delegation.EndDate) ? 'نشط' : 'غير نشط'}
                        </span>
                      </div>
                    </td>
                    <td className="p-4 text-content">{delegation.DelegatorName}</td>
                    <td className="p-4 text-content">{delegation.DelegateName}</td>
                    <td className="p-4 text-content">{formatDate(delegation.StartDate)}</td>
                    <td className="p-4 text-content">
                      {delegation.EndDate ? formatDate(delegation.EndDate) : 'غير محدد'}
                    </td>
                    <td className="p-4 text-content">{formatDate(delegation.CreatedAt)}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setEditingDelegation(delegation)}
                          className="text-primary hover:text-primary-dark"
                          title="تعديل"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(delegation.DelegationID)}
                          className="text-red-500 hover:text-red-700"
                          title="حذف"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* نموذج التعديل */}
      {editingDelegation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4 text-content">تعديل التفويض</h3>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-content mb-1">
                  المفوض: {editingDelegation.DelegatorName}
                </label>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-content mb-1">
                  المفوض إليه: {editingDelegation.DelegateName}
                </label>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-content mb-1">
                  تاريخ البداية
                </label>
                <input
                  type="date"
                  value={editingDelegation.StartDate.split('T')[0]}
                  onChange={(e) => setEditingDelegation({...editingDelegation, StartDate: e.target.value})}
                  required
                  className="w-full p-2 border rounded bg-bkg border-content/20 text-content"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-content mb-1">
                  تاريخ النهاية
                </label>
                <input
                  type="date"
                  value={editingDelegation.EndDate ? editingDelegation.EndDate.split('T')[0] : ''}
                  onChange={(e) => setEditingDelegation({...editingDelegation, EndDate: e.target.value || null})}
                  className="w-full p-2 border rounded bg-bkg border-content/20 text-content"
                />
              </div>
              
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={editingDelegation.IsActive}
                  onChange={(e) => setEditingDelegation({...editingDelegation, IsActive: e.target.checked})}
                  className="h-4 w-4 rounded text-primary focus:ring-primary"
                />
                <label htmlFor="isActive" className="text-sm font-medium text-content">
                  التفويض نشط
                </label>
              </div>
              
              <div className="flex gap-2 pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-primary text-white px-4 py-2 rounded hover:bg-primary-dark disabled:opacity-50"
                >
                  {loading ? 'جاري الحفظ...' : 'حفظ التغييرات'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingDelegation(null)}
                  className="border border-content/20 text-content px-4 py-2 rounded hover:bg-content/5"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DelegationManagement;
