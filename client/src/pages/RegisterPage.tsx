// src/pages/RegisterPage.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

type Department = {
  DepartmentID: number;
  Name: string;
  ParentID?: number | null;
  ParentDepartmentID?: number | null;
};

type VacancyOption = {
  VacancyID: number;
  Name: string;
  DepartmentID: number | null;
};

const getFullPath = (deptId: number | null, allDepts: Department[]): string => {
  if (!deptId) return '';
  const map = new Map(allDepts.map(d => [d.DepartmentID, d]));
  const parts: string[] = [];
  let current = map.get(deptId);
  const visited = new Set<number>();
  while (current && !visited.has(current.DepartmentID)) {
    visited.add(current.DepartmentID);
    parts.unshift(current.Name);
    const pid = current.ParentID ?? current.ParentDepartmentID ?? null;
    current = pid ? map.get(pid) : undefined;
  }
  return parts.join(' > ');
};

const RegisterPage = () => {
  const [userId, setUserId]       = useState('');
  const [password, setPassword]   = useState('');
  const [fullName, setFullName]   = useState('');
  const [vacancyId, setVacancyId] = useState<number | ''>('');
  const [search, setSearch]       = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const [departments, setDepartments]   = useState<Department[]>([]);
  const [vacancies, setVacancies]       = useState<VacancyOption[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [deptRes, vacRes] = await Promise.all([
          fetch('/api/departments'),
          fetch('/api/vacancies/all'),
        ]);
        if (deptRes.ok) setDepartments(await deptRes.json());
        if (vacRes.ok)  setVacancies(await vacRes.json());
      } catch (err) {
        console.error('Error loading register page data:', err);
      }
    };
    load();
  }, []);

  // بناء قائمة مناصب مع المسار الكامل
  const vacancyOptions = useMemo(() =>
    vacancies.map(v => ({
      ...v,
      fullLabel: `${v.Name}${v.DepartmentID ? '  —  ' + getFullPath(v.DepartmentID, departments) : ''}`,
    })),
    [vacancies, departments]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vacancyOptions;
    return vacancyOptions.filter(v => v.fullLabel.toLowerCase().includes(q));
  }, [vacancyOptions, search]);

  const selectedVacancy = vacancyOptions.find(v => v.VacancyID === vacancyId) ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const payload: Record<string, unknown> = { userId, password, fullName };
    if (vacancyId) payload.vacancyId = vacancyId;

    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (response.ok) {
      setMessage({ type: 'success', text: data.message });
      setUserId(''); setPassword(''); setFullName(''); setVacancyId(''); setSearch('');
    } else {
      setMessage({ type: 'error', text: data.message });
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="w-full max-w-lg p-8 space-y-6 bg-white rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-center">إنشاء حساب جديد</h1>
        <form onSubmit={handleSubmit} className="space-y-4">

          <input
            type="text"
            placeholder="اسم المستخدم للدخول (username)"
            value={userId}
            onChange={e => setUserId(e.target.value)}
            required
            className="w-full p-2 border rounded"
          />

          <input
            type="text"
            placeholder="الاسم الكامل"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            required
            className="w-full p-2 border rounded"
          />

          <input
            type="password"
            placeholder="كلمة المرور"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="w-full p-2 border rounded"
          />

          {/* اختيار المنصب مع بحث */}
          <div className="relative">
            <label className="block text-sm text-gray-600 mb-1">
              المنصب الوظيفي <span className="text-gray-400">(اختياري)</span>
            </label>

            {/* حقل العرض / البحث */}
            <input
              type="text"
              placeholder="ابحث عن منصبك..."
              value={showDropdown ? search : (selectedVacancy?.fullLabel ?? '')}
              onChange={e => { setSearch(e.target.value); setShowDropdown(true); setVacancyId(''); }}
              onFocus={() => { setShowDropdown(true); setSearch(''); }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              className="w-full p-2 border rounded"
              autoComplete="off"
            />

            {/* زر مسح الاختيار */}
            {vacancyId && (
              <button
                type="button"
                onClick={() => { setVacancyId(''); setSearch(''); }}
                className="absolute left-2 top-8 text-gray-400 hover:text-gray-600 text-lg"
              >×</button>
            )}

            {/* القائمة المنسدلة */}
            {showDropdown && (
              <div className="absolute z-50 w-full bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto mt-1">
                {filtered.length === 0 ? (
                  <div className="p-3 text-sm text-gray-400 text-center">لا توجد نتائج</div>
                ) : (
                  filtered.slice(0, 50).map(v => (
                    <div
                      key={v.VacancyID}
                      onMouseDown={() => { setVacancyId(v.VacancyID); setSearch(''); setShowDropdown(false); }}
                      className={`p-2 cursor-pointer hover:bg-blue-50 text-sm border-b last:border-0 ${vacancyId === v.VacancyID ? 'bg-blue-100' : ''}`}
                    >
                      <div className="font-medium text-gray-900">{v.Name}</div>
                      {v.DepartmentID && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {getFullPath(v.DepartmentID, departments)}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700"
          >
            إرسال طلب التسجيل
          </button>
        </form>

        {message && (
          <p className={`text-sm text-center p-2 rounded ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {message.text}
          </p>
        )}
        <div className="text-center">
          <Link to="/" className="text-sm text-blue-600 hover:underline">العودة لتسجيل الدخول</Link>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
