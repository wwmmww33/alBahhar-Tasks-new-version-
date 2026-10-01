// src/components/UserManagement.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Edit, Power, PowerOff, Eye, X } from 'lucide-react';
import type { CurrentUser } from '../types';

type User = {
  UserID: string;
  ServiceID?: string | null;
  FullName: string;
  DepartmentID: number | null;
  DepartmentName: string | null;
  IsActive: boolean;
  Role?: number;
};
type Department = { DepartmentID: number; Name: string; };

const ROLE_LABELS: Record<number, { label: string; className: string }> = {
  0: { label: 'مستخدم',    className: 'bg-gray-100 text-gray-600' },
  1: { label: 'مدير عام',  className: 'bg-red-100 text-red-700' },
  2: { label: 'مدير قسم', className: 'bg-blue-100 text-blue-700' },
};

const UserManagement = ({ currentUser }: { currentUser?: CurrentUser }) => {
  const currentUserRole = currentUser?.Role ?? 0;
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [editingServiceId, setEditingServiceId] = useState('');
  const [encryptingPasswords, setEncryptingPasswords] = useState(false);
  const [encryptResult, setEncryptResult] = useState<string | null>(null);
  const [revealingUserId, setRevealingUserId] = useState<string | null>(null);
  const [revealedPassword, setRevealedPassword] = useState<{ user: User; password: string } | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, deptsRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/departments')
      ]);
      const usersData = await usersRes.json();
      const deptsData = await deptsRes.json();
      setUsers(usersData);
      setDepartments(deptsData);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    
    const payload = {
        FullName: editingUser.FullName,
        DepartmentID: editingUser.DepartmentID,
        IsActive: editingUser.IsActive,
        PasswordHash: newPassword,
        ServiceID: editingServiceId.trim() || undefined,
    };

    await fetch(`/api/users/${editingUser.UserID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setEditingUser(null);
    setNewPassword('');
    setEditingServiceId('');
    fetchData();
  };
  
  const handleToggleActive = async (user: User) => {
    const payload = { ...user, IsActive: !user.IsActive, PasswordHash: '' }; // نرسل كلمة مرور فارغة لعدم تغييرها
    await fetch(`/api/users/${user.UserID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    fetchData();
  };

  const handleSetRole = async (user: User, role: number) => {
    await fetch(`/api/users/${user.UserID}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    fetchData();
  };

  const handleRevealPassword = async (user: User) => {
    setRevealError(null);
    setRevealingUserId(user.UserID);
    try {
      const res = await fetch(`/api/users/${user.UserID}/password?userId=${encodeURIComponent(currentUser?.UserID || '')}`);
      const data = await res.json();
      if (res.ok) {
        setRevealedPassword({ user, password: data.Password });
      } else {
        setRevealError(data.message || 'تعذر عرض كلمة المرور.');
      }
    } catch {
      setRevealError('خطأ في الاتصال بالخادم.');
    } finally {
      setRevealingUserId(null);
    }
  };

  const handleEncryptPasswords = async () => {
    if (!window.confirm('سيتم تشفير جميع كلمات المرور غير المشفرة في قاعدة البيانات. هل تريد المتابعة؟')) return;
    setEncryptingPasswords(true);
    setEncryptResult(null);
    try {
      const res = await fetch('/api/users/encrypt-passwords', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setEncryptResult(`تم بنجاح: تم تشفير ${data.encrypted} كلمة مرور، تم تخطي ${data.skipped} مشفرة مسبقاً.`);
      } else {
        setEncryptResult(`فشل: ${data.message}`);
      }
    } catch {
      setEncryptResult('خطأ في الاتصال بالخادم.');
    } finally {
      setEncryptingPasswords(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
      {/* جدول المستخدمين */}
      <div className="md:col-span-3 bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-2xl font-semibold text-content">المستخدمون الحاليون</h2>
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={handleEncryptPasswords}
              disabled={encryptingPasswords}
              className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded disabled:opacity-60"
            >
              {encryptingPasswords ? 'جارٍ التشفير...' : 'تشفير كلمات المرور الحالية'}
            </button>
            {encryptResult && (
              <span className="text-xs text-content-secondary">{encryptResult}</span>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right">
            <thead className="border-b border-content/10">
              <tr>
                <th className="p-2 font-semibold">الحالة</th>
                <th className="p-2 font-semibold">اسم المستخدم</th>
                <th className="p-2 font-semibold">الاسم الكامل</th>
                <th className="p-2 font-semibold">القسم</th>
                <th className="p-2 font-semibold">الدور</th>
                <th className="p-2 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const role = user.Role ?? 0;
                const roleInfo = ROLE_LABELS[role] ?? ROLE_LABELS[0];
                const isCurrentUser = user.UserID === currentUser?.UserID;
                return (
                  <tr key={user.UserID} className="border-b border-content/10 hover:bg-content/5">
                    <td className="p-2">
                      <button onClick={() => handleToggleActive(user)} title={user.IsActive ? 'إيقاف المستخدم' : 'تفعيل المستخدم'}>
                        {user.IsActive ? <Power size={18} className="text-green-500"/> : <PowerOff size={18} className="text-red-500"/>}
                      </button>
                    </td>
                    <td className="p-2 font-mono text-sm text-content-secondary">{user.ServiceID || <span className="text-gray-300 text-xs">—</span>}</td>
                    <td className="p-2">{user.FullName}</td>
                    <td className="p-2">{user.DepartmentName || <span className="text-xs text-gray-400">غير محدد</span>}</td>
                    <td className="p-2">
                      {currentUserRole === 1 && !isCurrentUser ? (
                        <select
                          value={role}
                          onChange={e => handleSetRole(user, parseInt(e.target.value))}
                          className={`text-xs px-2 py-0.5 rounded border-0 font-semibold cursor-pointer ${roleInfo.className}`}
                        >
                          <option value={0}>مستخدم</option>
                          <option value={1}>مدير عام</option>
                          <option value={2}>مدير قسم</option>
                        </select>
                      ) : (
                        <span className={`text-xs px-2 py-0.5 rounded font-semibold ${roleInfo.className}`}>
                          {roleInfo.label}
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-3">
                        <button onClick={() => { setEditingUser(user); setNewPassword(''); setEditingServiceId(user.ServiceID || ''); }} className="text-primary hover:text-primary-dark" title="تعديل">
                          <Edit size={16}/>
                        </button>
                        {currentUserRole === 1 && (
                          <button
                            onClick={() => handleRevealPassword(user)}
                            disabled={revealingUserId === user.UserID}
                            className="text-amber-600 hover:text-amber-700 disabled:opacity-50"
                            title="عرض كلمة المرور (بدون تشفير)"
                          >
                            <Eye size={16}/>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* نموذج التعديل */}
      <div className="md:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
        <h2 className="text-2xl font-semibold mb-4 text-content">{editingUser ? `تعديل: ${editingUser.FullName}` : 'اختر مستخدماً لتعديله'}</h2>
        {editingUser && (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <label className="text-sm font-medium">اسم المستخدم (ServiceID)</label>
              <input
                type="text"
                value={editingServiceId}
                onChange={e => setEditingServiceId(e.target.value)}
                placeholder="اتركه فارغاً لعدم التغيير"
                className="w-full p-2 border rounded mt-1 bg-bkg border-content/20 font-mono text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">الاسم الكامل</label>
              <input type="text" value={editingUser.FullName} onChange={(e) => setEditingUser({...editingUser, FullName: e.target.value})} required className="w-full p-2 border rounded mt-1 bg-bkg border-content/20"/>
            </div>
            <div>
              <label className="text-sm font-medium">القسم</label>
              <select value={editingUser.DepartmentID || ''} onChange={(e) => setEditingUser({...editingUser, DepartmentID: parseInt(e.target.value) || null})} required className="w-full p-2 border rounded mt-1 bg-bkg border-content/20">
                <option value="">-- اختر قسماً --</option>
                {departments.map(dep => <option key={dep.DepartmentID} value={dep.DepartmentID}>{dep.Name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">إعادة تعيين كلمة المرور</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="اتركه فارغاً لعدم التغيير" className="w-full p-2 border rounded mt-1 bg-bkg border-content/20"/>
            </div>
            <div className="flex items-center gap-2 pt-2">
                <input type="checkbox" id="isActive" checked={editingUser.IsActive} onChange={(e) => setEditingUser({...editingUser, IsActive: e.target.checked})} className="h-4 w-4 rounded text-primary focus:ring-primary"/>
                <label htmlFor="isActive" className="text-sm font-medium">الحساب نشط</label>
            </div>
            <div className="border-t border-content/10 pt-4 flex flex-col gap-2">
                <button type="submit" className="w-full bg-primary text-white py-2 rounded-md hover:bg-primary-dark">حفظ التغييرات</button>
                <button type="button" onClick={() => setEditingUser(null)} className="w-full text-center text-sm text-content-secondary hover:underline">إلغاء</button>
            </div>
          </form>
        )}
      </div>

      {revealError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-red-600 text-white text-sm px-4 py-2 rounded-md shadow-lg z-50">
          {revealError}
          <button onClick={() => setRevealError(null)} className="mr-3 underline">إغلاق</button>
        </div>
      )}

      {revealedPassword && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setRevealedPassword(null)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-content">كلمة مرور المستخدم</h3>
              <button onClick={() => setRevealedPassword(null)} className="text-content-secondary hover:text-content">
                <X size={18}/>
              </button>
            </div>
            <p className="text-sm text-content-secondary mb-1">{revealedPassword.user.FullName}</p>
            <p className="text-xs font-mono text-content-secondary mb-4">{revealedPassword.user.ServiceID}</p>
            <div className="bg-content/5 border border-content/10 rounded-md px-3 py-2 font-mono text-sm break-all select-all">
              {revealedPassword.password}
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-3">
              هذه الميزة متاحة للمدير العام فقط. تجنّب مشاركة كلمات المرور خارج هذه الصفحة.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;