// src/pages/RegisterPage.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';

type Department = {
  DepartmentID: number;
  Name: string;
  ParentID?: number | null;
  ParentDepartmentID?: number | null;
};

type RankRow = {
  RankID?: number;
  Name?: string;
  RankName?: string;
  Level?: number;
};

const getFullPath = (dep: Department, allDeps: Department[]): string => {
  const map = new Map(allDeps.map(d => [d.DepartmentID, d]));
  const parts: string[] = [];
  let current: Department | undefined = dep;
  const visited = new Set<number>();
  while (current && !visited.has(current.DepartmentID)) {
    visited.add(current.DepartmentID);
    parts.push(current.Name);
    const pid: number | null = current.ParentID ?? current.ParentDepartmentID ?? null;
    current = pid ? map.get(pid) : undefined;
  }
  return parts.join(' < ');
};

const RegisterPage = () => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [deptSearch, setDeptSearch] = useState('');
  const [vacancyName, setVacancyName] = useState('');
  const [rank, setRank] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [rankRows, setRankRows] = useState<RankRow[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [deptRes, rankRes] = await Promise.all([
          fetch('/api/departments'),
          fetch('/api/ranks'),
        ]);
        if (deptRes.ok) setDepartments(await deptRes.json());
        if (rankRes.ok) setRankRows(await rankRes.json());
      } catch (err) {
        console.error('Error loading register page data:', err);
      }
    };
    load();
  }, []);

  const distinctRanks = useMemo(() => {
    return rankRows.map(row => ({
      id: row.RankID ?? 0,
      label: (row.Name || row.RankName || '').trim(),
    })).filter(r => r.label);
  }, [rankRows]);

  const filteredDepts = useMemo(() => {
    const q = deptSearch.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter(d =>
      getFullPath(d, departments).toLowerCase().includes(q)
    );
  }, [departments, deptSearch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const payload = {
      userId,
      password,
      fullName,
      departmentId: parseInt(departmentId),
      vacancyName: vacancyName.trim() || undefined,
      rank: rank.trim() || undefined,
    };
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (response.ok) {
      setMessage({ type: 'success', text: data.message });
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
            placeholder="اسم المعرف (باللغة الإنجليزية)"
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

          {/* حقل اسم المنصب */}
          <input
            type="text"
            placeholder="اسم المنصب الوظيفي (اختياري)"
            value={vacancyName}
            onChange={e => setVacancyName(e.target.value)}
            className="w-full p-2 border rounded"
          />

          {/* اختيار الرتبة */}
          <select
            value={rank}
            onChange={e => setRank(e.target.value)}
            className="w-full p-2 border rounded bg-white"
          >
            <option value="">-- اختر الرتبة (اختياري) --</option>
            {distinctRanks.map(r => (
              <option key={r.id} value={r.label}>{r.label}</option>
            ))}
          </select>

          {/* بحث القسم */}
          <div className="space-y-1">
            <input
              type="text"
              placeholder="بحث عن قسم..."
              value={deptSearch}
              onChange={e => setDeptSearch(e.target.value)}
              className="w-full p-2 border rounded"
            />
            <select
              value={departmentId}
              onChange={e => setDepartmentId(e.target.value)}
              required
              className="w-full p-2 border rounded bg-white"
              size={filteredDepts.length > 0 && deptSearch ? Math.min(filteredDepts.length + 1, 8) : 1}
            >
              <option value="">-- اختر القسم --</option>
              {filteredDepts.map(dep => (
                <option key={dep.DepartmentID} value={dep.DepartmentID}>
                  {getFullPath(dep, departments)}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700">
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
