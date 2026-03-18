// src/pages/LoginPage.tsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CurrentUser } from '../types';
import { setActiveAccount, clearActiveAccount } from '../utils/activeAccount';
import { resolveCurrentActorId, resolveDelegateActorId, resolveDelegatorActorId } from '../utils/actorIdentity';
import DelegationChoiceModal from '../components/DelegationChoiceModal';

type LoginPageProps = {
  onLoginSuccess: (userData: CurrentUser) => void; 
};

const LoginPage = ({ onLoginSuccess }: LoginPageProps) => {
  // --- 1. تم تفريغ القيم الافتراضية ---
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showChoice, setShowChoice] = useState(false);
  const [pendingUser, setPendingUser] = useState<CurrentUser | null>(null);
  const [activeDelegators, setActiveDelegators] = useState<any[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }
      const loggedInUser: CurrentUser = data.user;

      // بعد تسجيل الدخول: معاينة التفويضات واقتراح اختيار الحساب النشط
      try {
        const currentActorId = resolveCurrentActorId(loggedInUser);
        const delegationsRes = await fetch('/api/delegations/as-delegate', {
          headers: {
            'Content-Type': 'application/json',
            'user-id': currentActorId || loggedInUser.UserID
          }
        });
        let delegations: any[] = [];
        if (delegationsRes.ok) {
          try { delegations = await delegationsRes.json(); } catch { delegations = []; }
        }

        // نبحث عن تفويضات فعّالة حيث المستخدم الحالي هو المفوَّض إليه
        const now = new Date();
        const activeDelegators = (Array.isArray(delegations) ? delegations : []).filter((d: any) => {
          const isDelegate = resolveDelegateActorId(d) === (currentActorId || loggedInUser.UserID);
          const isActive = !!d?.IsActive;
          const notExpired = !d?.EndDate || new Date(d.EndDate) >= now;
          const started = !d?.StartDate || new Date(d.StartDate) <= now;
          return isDelegate && isActive && notExpired && started;
        });

        if (activeDelegators.length === 0) {
          // لا يوجد تفويض فعّال: العمل كنفسي
          clearActiveAccount();
          onLoginSuccess(loggedInUser);
          setIsLoading(false);
          return;
        } else {
          // إظهار مودال اختيار احترافي قبل إكمال الدخول
          setActiveDelegators(activeDelegators);
          setPendingUser(loggedInUser);
          setShowChoice(true);
          setIsLoading(false);
          return; // لا تُكمل الآن، انتظر اختيار المستخدم
        }
      } catch {
        // في حال فشل جلب التفويضات، نستمر بالدخول كنفسي
        clearActiveAccount();
        onLoginSuccess(loggedInUser);
        setIsLoading(false);
        return;
      }
      // لن نصل هنا بعد إعادة التنظيم أعلاه

    } catch (err: any) {
      setError(err.message);
    } finally {
      // يتم ضبط isLoading حسب التدفق أعلاه
    }
  };

  const handleChooseSelf = () => {
    clearActiveAccount();
    if (pendingUser) onLoginSuccess(pendingUser);
    setShowChoice(false);
    setPendingUser(null);
  };

  const handleChooseDelegator = (delegator: any) => {
    setActiveAccount({
      actorId: resolveDelegatorActorId(delegator),
      userId: delegator?.DelegatorID,
      actorName: delegator?.DelegatorName,
      userName: delegator?.DelegatorName,
      mode: 'delegation'
    });
    if (pendingUser) onLoginSuccess(pendingUser);
    setShowChoice(false);
    setPendingUser(null);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
      <div className="w-full max-w-md p-8 space-y-6 bg-white dark:bg-gray-800 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-center text-blue-600 dark:text-blue-400">بحار</h1>
        <h2 className="text-xl font-semibold text-center text-gray-700 dark:text-gray-200">تسجيل الدخول</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="userId" className="block text-sm font-medium text-gray-600 dark:text-gray-300">اسم المستخدم</label>
            <input 
              type="text" 
              id="userId" 
              value={userId} 
              onChange={e => setUserId(e.target.value)} 
              required 
              className="w-full p-2 border rounded mt-1 bg-gray-50 dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <div>
            <label htmlFor="password"  className="block text-sm font-medium text-gray-600 dark:text-gray-300">كلمة المرور</label>
            <input 
              type="password" 
              id="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              required 
              className="w-full p-2 border rounded mt-1 bg-gray-50 dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          <button type="submit" disabled={isLoading} className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 dark:bg-blue-500 dark:hover:bg-blue-600">
            {isLoading ? 'جاري التحقق...' : 'دخول'}
          </button>
        </form>
        <div className="text-center mt-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">ليس لديك حساب؟ <Link to="/register" className="font-semibold text-blue-600 hover:underline dark:text-blue-400">أنشئ حساباً جديداً</Link></p>
        </div>
      </div>
      <DelegationChoiceModal 
        isOpen={showChoice}
        userName={pendingUser?.FullName}
        options={activeDelegators}
        onChooseSelf={handleChooseSelf}
        onChooseDelegator={handleChooseDelegator}
      />
    </div>
  );
};

export default LoginPage;