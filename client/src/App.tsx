// src/App.tsx
import { useState, useEffect } from 'react';
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
import { NotificationProvider } from './contexts/NotificationContext';
import { clearActiveAccount } from './utils/activeAccount';
import type { CurrentUser } from './types';

function App() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const storedUser = localStorage.getItem('albahar-user');
    if (storedUser) {
      setCurrentUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);
  
  const handleLoginSuccess = (userData: CurrentUser) => {
    setCurrentUser(userData);
    localStorage.setItem('albahar-user', JSON.stringify(userData));
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
    // مسح حالة العمل نيابةً عن عند تسجيل الخروج
    try { clearActiveAccount(); } catch {}
    navigate('/login');
  };

  if (loading) {
    return <div>Loading...</div>;
  }
  
  return (
    <NotificationProvider>
      <Routes>
        <Route path="/login" element={<LoginPage onLoginSuccess={handleLoginSuccess} />} />
        <Route path="/register" element={<RegisterPage />} />
        
        {currentUser && (
            <Route path="/*" element={
                <MainLayout currentUser={currentUser} onLogout={handleLogout}>
                    <Routes>
                        {/* 2. تم حذف مسار /dashboard بالكامل */}
                        <Route path="/tasks" element={<TaskList currentUser={currentUser} />} />
                        <Route path="/create-task" element={<CreateTask currentUser={currentUser} />} />
                        <Route path="/task/:taskId" element={<TaskDetail currentUser={currentUser} />} />
                        <Route path="/procedures" element={<ProceduresManagement currentUser={currentUser}/>} />
                        <Route path="/procedures/edit/:id" element={<ProcedureEdit />} />
                        <Route path="/categories" element={<CategoryManagementPage currentUser={currentUser} />} />
                        <Route path="/categories/:categoryId" element={<CategoryInfo currentUser={currentUser} />} />
                        <Route path="/profile" element={<UserProfile currentUser={currentUser} onUserUpdate={handleUserUpdate} />} />
                        <Route path="/delegations" element={<DelegationsPage />} />
                        <Route path="/calendar" element={<CalendarPage currentUser={currentUser} />} />
                        {currentUser.IsAdmin && <Route path="/system-management" element={<SystemManagement />} />}
                        
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
