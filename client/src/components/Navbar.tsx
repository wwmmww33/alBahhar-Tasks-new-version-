// src/components/Navbar.tsx
import { Sun, Moon, LogOut, ListTodo, PlusCircle, FileText, Shield, User, FolderOpen, Share2, LayoutGrid, List } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeProvider';
import UnifiedNotifications from './UnifiedNotifications';
import type { CurrentUser } from '../types';
import { getActiveAccount, getActiveUserId, clearActiveAccount } from '../utils/activeAccount';
import { resolveCurrentActorId } from '../utils/actorIdentity';

type NavbarProps = {
  currentUser: CurrentUser;
  onLogout: () => void;
};

const Navbar = ({ currentUser, onLogout }: NavbarProps) => {
  // استخدام الطريقة الجديدة مع dispatch
  const { theme, mode, dispatch } = useTheme();
  const [taskLayout, setTaskLayout] = useState<'grid' | 'list'>((localStorage.getItem('task-layout') as 'grid' | 'list') || 'grid');
  const navigate = useNavigate();

  const handleThemeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    dispatch({ type: 'SET_THEME', payload: e.target.value as any });
  };

  const handleToggleMode = () => {
    dispatch({ type: 'TOGGLE_MODE' });
  };

  const handleToggleTaskLayout = () => {
    const next = taskLayout === 'grid' ? 'list' : 'grid';
    setTaskLayout(next);
    try {
      localStorage.setItem('task-layout', next);
    } catch (_) {}
    // إعلام الصفحات بالاستماع للتغيير
    window.dispatchEvent(new Event('tasks:layout-changed'));
  };

  const handleNotificationClick = (taskId: number) => {
    navigate(`/task/${taskId}`);
  };

  const navLinkStyle = ({ isActive }: { isActive: boolean }) => 
    `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive 
        ? 'bg-primary-light/20 text-primary-dark dark:bg-primary-dark/20 dark:text-primary-light' 
        : 'text-content-secondary hover:bg-content/5 hover:text-content'
    }`;

  return (
    <header className="bg-white/80 dark:bg-gray-900/80 text-content h-16 flex items-center justify-between px-6 sticky top-0 z-50 backdrop-blur-sm border-b border-black/10 dark:border-white/10">
      {/* --- القسم الأيمن: التبويبات (تمت إعادته) --- */}
      <div className="flex items-center gap-8">
        <Link to="/dashboard">
<h1 className="text-2xl font-bold text-primary">بحار</h1>
        </Link>
        <nav className="flex items-center gap-2">
          {/*<NavLink to="/dashboard" className={navLinkStyle}><LayoutDashboard size={18} /><span>الرئيسية</span></NavLink> */}
          <NavLink to="/tasks" className={navLinkStyle}><ListTodo size={18} /><span>المهام</span></NavLink>
          <NavLink to="/procedures" className={navLinkStyle}><FileText size={18} /><span>المهام الافتراضية</span></NavLink>
          <NavLink to="/categories" className={navLinkStyle}><FolderOpen size={18} /><span>التصنيفات</span></NavLink>
          <NavLink to="/delegations" className={navLinkStyle}><Share2 size={18} /><span>التفويضات</span></NavLink>
          <NavLink to="/profile" className={navLinkStyle}><User size={18} /><span>الملف الشخصي</span></NavLink>
          {currentUser.IsAdmin && <NavLink to="/system-management" className={navLinkStyle}><Shield size={18} /><span>إدارة النظام</span></NavLink>}
        </nav>
      </div>

      {/* --- القسم الأيسر: الأزرار والمعلومات (تمت إعادته) --- */}
      <div className="flex items-center gap-4">
        <Link to="/create-task" className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-dark flex items-center gap-2 shadow hover:shadow-md transition-all text-sm font-semibold">
          <PlusCircle size={18} /><span>مهمة جديدة</span>
        </Link>
        <div className="h-8 border-l border-content/10"></div>
        
        <select value={theme} onChange={handleThemeChange} className="bg-bkg border border-content/10 rounded-md p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary appearance-none text-center">
          <option value="theme-blue">أزرق</option>
          <option value="theme-green">أخضر</option>
          <option value="theme-purple">بنفسجي</option>
          <option value="theme-orange">برتقالي</option>
        </select>
        
        <UnifiedNotifications 
          userId={getActiveUserId(resolveCurrentActorId(currentUser) || currentUser.UserID)} 
          onNotificationClick={handleNotificationClick}
        />
        
        <button onClick={handleToggleMode} title="Toggle Dark/Light Mode" className="p-2 rounded-full text-content-secondary hover:bg-content/10 hover:text-content transition-colors">
          {mode === 'light' ? <Moon size={20} /> : <Sun size={20} />}
        </button>

        {/* زر تبديل عرض المهام: شبكة / قائمة */}
        <button onClick={handleToggleTaskLayout} title="تبديل عرض المهام: شبكة/قائمة" className="p-2 rounded-full text-content-secondary hover:bg-content/10 hover:text-content transition-colors">
          {taskLayout === 'grid' ? <List size={20} /> : <LayoutGrid size={20} />}
        </button>
        
        <div className="h-8 border-l border-content/10"></div>
        <div className="flex items-center gap-6">
            {/* مؤشر الحساب النشط */}
            {(() => {
                const acc = getActiveAccount();
                if (acc && acc.mode === 'delegation') {
                  return (
                    <div className="px-3 py-1 rounded-md bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-xs flex items-center gap-2">
                      <span>تعمل الآن نيابةً عن:</span>
                      <span className="font-semibold">{acc.actorName || acc.userName || acc.actorId || acc.userId}</span>
                      <button
                        onClick={() => { clearActiveAccount(); window.location.reload(); }}
                        className="ml-2 underline hover:no-underline"
                      >رجوع لحسابك</button>
                    </div>
                  );
                }
                return null;
            })()}
            
            <div className="flex items-center gap-3">
            <div className="text-right">
                <p className="font-semibold text-sm text-content">{currentUser.FullName}</p>
                <p className="text-xs text-content-secondary">{currentUser.DepartmentName || 'الإدارة'}</p>
            </div>
            <button onClick={onLogout} title="تسجيل الخروج" className="p-2 rounded-full text-content-secondary hover:bg-red-500/10 hover:text-red-500 transition-colors">
                <LogOut size={20} />
            </button>
            </div>
        </div>
      </div>
    </header>
  );
};
export default Navbar;