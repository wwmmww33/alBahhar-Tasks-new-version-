// src/App.tsx
import { useState, useEffect, useMemo } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
// import Dashboard from './pages/Dashboard'; // لم نعد بحاجة إليه
import TaskList from './pages/TaskList';
import CreateTask from './pages/CreateTask';
import TaskDetail from './pages/TaskDetail';
import ProceduresManagement from './pages/ProceduresManagement';
import ProcedureEdit from './pages/ProcedureEdit';
import SystemManagement from './pages/SystemManagement';
import UserProfile from './pages/UserProfile';
import DelegationsPage from './pages/DelegationsPage';
import CategoryManagementPage from './pages/CategoryManagementPage';
import CategoryInfo from './pages/CategoryInfo';
import CalendarPage from './pages/CalendarPage';
import AnnouncementsPage from './pages/AnnouncementsPage';
import { NotificationProvider } from './contexts/NotificationContext';
import { clearActiveAccount } from './utils/activeAccount';
import { getAdminViewMode, setAdminViewMode, toggleAdminViewMode, onAdminViewModeChanged, hasSystemAdminRole, withEffectiveAdminView, type AdminViewMode } from './utils/roleAccess';
import type { CurrentUser } from './types';

function App() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminViewMode, setAdminViewModeState] = useState<AdminViewMode>(getAdminViewMode());
  const navigate = useNavigate();

  useEffect(() => {
    const storedUser = localStorage.getItem('albahar-user');
    if (storedUser) {
      setCurrentUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  useEffect(() => onAdminViewModeChanged(() => setAdminViewModeState(getAdminViewMode())), []);

  const handleLoginSuccess = (userData: CurrentUser) => {
    setCurrentUser(userData);
    localStorage.setItem('albahar-user', JSON.stringify(userData));
    // عند كل تسجيل دخول جديد: ابدأ دوماً كمستخدم عادي، حتى لمدراء النظام — يختارون التبديل بأنفسهم
    setAdminViewMode('normal');
    // --- 1. التغيير هنا: نوجه إلى /tasks ---
    navigate('/tasks');
  };

  const handleUserUpdate = (updatedUser: CurrentUser) => {
    setCurrentUser(updatedUser);
    localStorage.setItem('albahar-user', JSON.stringify(updatedUser));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('albahar-user');
    setAdminViewMode('normal');
    // مسح حالة العمل نيابةً عن عند تسجيل الخروج
    try { clearActiveAccount(); } catch {}
    navigate('/login');
  };

  // currentUser "الفعّال" المُمرَّر لبقية الشجرة: IsAdmin فيه يراعي وضع العرض الحالي (عادي/مدير
  // نظام)، بينما Role يبقى خاماً كما هو (صلاحية مدير القسم تبقى ظاهرة دوماً بلا تأثر بالزر).
  const effectiveUser = useMemo<CurrentUser | null>(
    () => (currentUser ? withEffectiveAdminView(currentUser, adminViewMode) : null),
    [currentUser, adminViewMode]
  );
  const isRawSystemAdmin = hasSystemAdminRole(currentUser);

  if (loading) {
    return <div>Loading...</div>;
  }
  
  return (
    <NotificationProvider>
      <Routes>
        <Route path="/login" element={<LoginPage onLoginSuccess={handleLoginSuccess} />} />
        <Route path="/register" element={<RegisterPage />} />
        
        {currentUser && effectiveUser && (
            <Route path="/*" element={
                <MainLayout
                    currentUser={effectiveUser}
                    onLogout={handleLogout}
                    isRawSystemAdmin={isRawSystemAdmin}
                    adminViewMode={adminViewMode}
                    onToggleAdminView={toggleAdminViewMode}
                >
                    <Routes>
                        {/* 2. تم حذف مسار /dashboard بالكامل */}
                        <Route path="/tasks" element={<TaskList currentUser={effectiveUser} />} />
                        <Route path="/create-task" element={<CreateTask currentUser={effectiveUser} />} />
                        <Route path="/task/:taskId" element={<TaskDetail currentUser={effectiveUser} />} />
                        <Route path="/procedures" element={<ProceduresManagement currentUser={effectiveUser}/>} />
                        <Route path="/procedures/edit/:id" element={<ProcedureEdit />} />
                        <Route path="/categories" element={<CategoryManagementPage currentUser={effectiveUser} />} />
                        <Route path="/categories/:categoryId" element={<CategoryInfo currentUser={effectiveUser} />} />
                        <Route path="/profile" element={<UserProfile currentUser={effectiveUser} onUserUpdate={handleUserUpdate} />} />
                        <Route path="/delegations" element={<DelegationsPage />} />
                        <Route path="/calendar" element={<CalendarPage currentUser={effectiveUser} />} />
                        <Route path="/announcements" element={<AnnouncementsPage currentUser={effectiveUser} />} />
                        {(effectiveUser.IsAdmin || ((effectiveUser.Role ?? 0) & 2) !== 0) && <Route path="/system-management" element={<SystemManagement currentUser={effectiveUser} />} />}

                        {/* 3. التوجيه الافتراضي أصبح إلى /tasks */}
                        <Route path="/" element={<Navigate to="/tasks" replace />} />

                        {/* 4. المسار الاحتياطي الآن يوجه أيضاً إلى /tasks */}
                        <Route path="*" element={<Navigate to="/tasks" replace />} />
                    </Routes>
                </MainLayout>
            } />
        )}
        
        {!currentUser && (
            <Route path="*" element={<Navigate to="/login" replace />} />
        )}
      </Routes>
    </NotificationProvider>
  );
}

export default App;
