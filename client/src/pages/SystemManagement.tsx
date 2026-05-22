// src/pages/SystemManagement.tsx
import { useState } from 'react';
import { Building, Users, UserPlus, UserCheck } from 'lucide-react';
import DepartmentManagement from '../components/DepartmentManagement';
import UserManagement from '../components/UserManagement';
import RegistrationRequests from '../components/RegistrationRequests';
import DelegationManagement from '../components/DelegationManagement';
import type { CurrentUser } from '../types';

type AdminTab = 'departments' | 'users' | 'requests' | 'delegations';

const SystemManagement = ({ currentUser }: { currentUser?: CurrentUser }) => {
  const userRole = currentUser?.Role ?? (currentUser?.IsAdmin ? 1 : 0);
  const isSystemAdmin = userRole === 1;

  const [activeTab, setActiveTab] = useState<AdminTab>('departments');
  const [bootstrapMsg, setBootstrapMsg] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);

  const handleBootstrapAdmin = async () => {
    if (!currentUser?.UserID) return;
    setBootstrapping(true);
    setBootstrapMsg(null);
    try {
      const res = await fetch('/api/users/bootstrap-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.UserID }),
      });
      const data = await res.json();
      if (res.ok) {
        setBootstrapMsg('✅ ' + (data.message || 'تم التعيين.') + ' — يرجى تسجيل الخروج والدخول مجدداً لتفعيل الصلاحيات.');
      } else {
        setBootstrapMsg('❌ ' + (data.message || 'فشل التعيين.'));
      }
    } catch {
      setBootstrapMsg('❌ خطأ في الاتصال بالخادم.');
    } finally {
      setBootstrapping(false);
    }
  };

  const getTabClassName = (tabName: AdminTab) => {
    const isActive = activeTab === tabName;
    return `flex items-center gap-2 px-6 py-3 font-semibold border-b-2 transition-colors ${
      isActive
        ? 'border-primary text-primary'
        : 'border-transparent text-content-secondary hover:text-content'
    }`;
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <h1 className="text-4xl font-bold text-content">إدارة النظام</h1>
        {!isSystemAdmin && (
          <span className="text-sm bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-medium">
            مدير قسم — صلاحيات محدودة
          </span>
        )}
      </div>

      {/* تنبيه تهيئة أول مدير عام — يظهر فقط لغير المديرين */}
      {!isSystemAdmin && (
        <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg text-right">
          <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
            لم يتم تعيين مدير عام للنظام بعد.
          </p>
          <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-3">
            إذا كنت المسؤول عن هذا النظام، يمكنك تعيين نفسك مديراً عاماً. هذا الخيار يختفي تلقائياً بمجرد وجود مدير عام.
          </p>
          <button
            type="button"
            onClick={handleBootstrapAdmin}
            disabled={bootstrapping}
            className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded text-sm disabled:opacity-60"
          >
            {bootstrapping ? 'جارٍ التعيين...' : 'تعيين نفسي مديراً عاماً'}
          </button>
          {bootstrapMsg && (
            <p className="mt-2 text-sm text-yellow-900 dark:text-yellow-100">{bootstrapMsg}</p>
          )}
        </div>
      )}

      {/* شريط التبويبات — Role=2 يرى الأقسام فقط */}
      <div className="flex border-b border-content/10 mb-8">
        <button onClick={() => setActiveTab('departments')} className={getTabClassName('departments')}>
          <Building size={20} />
          <span>إدارة الأقسام</span>
        </button>
        {isSystemAdmin && (
          <>
            <button onClick={() => setActiveTab('users')} className={getTabClassName('users')}>
              <Users size={20} />
              <span>إدارة المستخدمين</span>
            </button>
            <button onClick={() => setActiveTab('requests')} className={getTabClassName('requests')}>
              <UserPlus size={20} />
              <span>طلبات التسجيل</span>
            </button>
            <button onClick={() => setActiveTab('delegations')} className={getTabClassName('delegations')}>
              <UserCheck size={20} />
              <span>إدارة التفويضات</span>
            </button>
          </>
        )}
      </div>

      {/* محتوى التبويب النشط */}
      <div className="animate-fade-in">
        {activeTab === 'departments' && <DepartmentManagement currentUser={currentUser} />}
        {activeTab === 'users'       && isSystemAdmin && <UserManagement currentUser={currentUser} />}
        {activeTab === 'requests'    && isSystemAdmin && <RegistrationRequests />}
        {activeTab === 'delegations' && isSystemAdmin && <DelegationManagement />}
      </div>
    </div>
  );
};

// لإضافة تأثير بسيط عند ظهور المحتوى
// أضف هذا الكود إلى ملف index.css
/*
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in {
  animation: fadeIn 0.3s ease-out forwards;
}
*/

export default SystemManagement;