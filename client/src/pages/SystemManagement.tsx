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