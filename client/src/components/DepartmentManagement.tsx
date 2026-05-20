// src/components/DepartmentManagement.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, Edit, Plus, ChevronDown, ChevronRight, Briefcase, UserPlus, UserMinus, X, Check } from 'lucide-react';
import type { CurrentUser } from '../types';

type Department = {
  DepartmentID: number;
  Name: string;
  ParentID?: number | null;
  ParentDepartmentID?: number | null;
  IsActive?: boolean | number;
  Active?: boolean | number;
  Type?: number | string | null;
};

type TreeNode = Department & { children: TreeNode[] };

type Vacancy = {
  VacancyID: number;
  Name: string;
  IsActive?: boolean | number | null;
  DepartmentID: number | null;
  CurrentAssignmentID?: number | null;
  CurrentUserID?: string | null;
  CurrentUserFullName?: string | null;
  CurrentUserIsActive?: boolean | number | null;
};

type RankRow = {
  VacancyRankID?: number;
  RankID?: number;
  VacancyID?: number;
  Rank?: string;
  Name?: string;
};

type UserOption = {
  UserID: string;
  FullName: string;
  CurrentVacancyName?: string | null;
  CurrentDepartmentID?: number | null;
  CurrentDepartmentName?: string | null;
};

// يصعد في تسلسل الأقسام من startId حتى يجد قسماً مستقلاً (Type=1)
// إن لم يجد يعود إلى startId نفسه
function findIndependentRoot(startId: number, allDepts: Department[]): number {
  const map = new Map(allDepts.map(d => [d.DepartmentID, d]));
  let cur = map.get(startId);
  const visited = new Set<number>();
  while (cur && !visited.has(cur.DepartmentID)) {
    visited.add(cur.DepartmentID);
    if (String(cur.Type ?? '').trim() === '1') return cur.DepartmentID;
    const pid = cur.ParentID ?? cur.ParentDepartmentID ?? null;
    if (!pid) break;
    cur = map.get(pid);
  }
  return startId;
}

// يُرجع مجموعة IDs لكل الأقسام التابعة لـ rootId (شاملاً rootId نفسه)
function getSubtreeIds(rootId: number, allDepts: Department[]): Set<number> {
  const result = new Set<number>();
  const queue = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    result.add(cur);
    allDepts
      .filter(d => (d.ParentID ?? d.ParentDepartmentID) === cur)
      .forEach(d => queue.push(d.DepartmentID));
  }
  return result;
}

const DepartmentManagement = ({ currentUser }: { currentUser?: CurrentUser }) => {
  const userRole = currentUser?.Role ?? (currentUser?.IsAdmin ? 1 : 0);
  const isSystemAdmin = userRole === 1;
  const isManager     = userRole === 2;
  const [departments, setDepartments] = useState<Department[]>([]);
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [newDepartmentParentId, setNewDepartmentParentId] = useState<number | null>(null);
  const [newDepartmentActive, setNewDepartmentActive] = useState<boolean>(true);
  const [newDepartmentIndependent, setNewDepartmentIndependent] = useState<boolean>(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const nameInputRef = React.useRef<HTMLInputElement>(null);

  // ---- إدارة المناصب/الوظائف ----
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [vacanciesLoading, setVacanciesLoading] = useState<boolean>(false);
  const [newVacancyName, setNewVacancyName] = useState('');
  const [newVacancyRank, setNewVacancyRank] = useState('');
  const [editingVacancy, setEditingVacancy] = useState<Vacancy | null>(null);
  const [editingVacancyRank, setEditingVacancyRank] = useState<string>('');
  const [ranksMap, setRanksMap] = useState<Map<number, string>>(new Map());
  const [distinctRanks, setDistinctRanks] = useState<string[]>([]);
  const [assignOpenFor, setAssignOpenFor] = useState<number | null>(null);
  const [candidateUsers, setCandidateUsers] = useState<UserOption[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState<boolean>(false);
  const [candidateSearch, setCandidateSearch] = useState<string>('');
  const [selectedUserIdToAssign, setSelectedUserIdToAssign] = useState<string>('');

  // حساب نطاق مدير القسم (Role=2):
  // يصعد من قسم المستخدم حتى يجد القسم المستقل (Type=1) ثم يأخذ كامل شجرته
  const userDeptId = currentUser?.DepartmentID ?? null;
  const scopeDeptIds: Set<number> | null = React.useMemo(() => {
    if (!isManager || !userDeptId || departments.length === 0) return null;
    const rootId = findIndependentRoot(userDeptId, departments);
    return getSubtreeIds(rootId, departments);
  }, [isManager, userDeptId, departments]);

  // الأقسام المرئية لمدير القسم (مقيّدة بنطاقه)، والمدير العام يرى الجميع
  const visibleDepts: Department[] = React.useMemo(
    () => scopeDeptIds ? departments.filter(d => scopeDeptIds.has(d.DepartmentID)) : departments,
    [departments, scopeDeptIds]
  );

  const fetchDepartments = useCallback(async () => {
    try {
      const response = await fetch('/api/departments');
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setDepartments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching departments:", error);
    }
  }, []);

  const fetchVacancies = useCallback(async (departmentId: number) => {
    setVacanciesLoading(true);
    try {
      const [vacRes, vacRankRes, rankRes] = await Promise.all([
        fetch(`/api/vacancies/department/${departmentId}`),
        fetch('/api/vacancies/ranks'),
        fetch('/api/ranks'),
      ]);
      const vacData = vacRes.ok ? await vacRes.json() : [];
      const vacRankData: RankRow[] = vacRankRes.ok ? await vacRankRes.json() : [];
      const rankData: { RankID?: number; Name?: string; RankName?: string }[] = rankRes.ok ? await rankRes.json() : [];
      setVacancies(Array.isArray(vacData) ? vacData : []);

      const map = new Map<number, string>();
      for (const row of vacRankData) {
        const val = (row.Rank || row.Name || '').trim();
        if (row.VacancyID && val) map.set(row.VacancyID, val);
      }
      setRanksMap(map);

      const distinct: string[] = rankData
        .map(r => (r.Name || r.RankName || '').trim())
        .filter(Boolean);
      setDistinctRanks(distinct);
    } catch (err) {
      console.error('Error fetching vacancies:', err);
      setVacancies([]);
    } finally {
      setVacanciesLoading(false);
    }
  }, []);

  const fetchCandidateUsers = useCallback(async () => {
    setCandidatesLoading(true);
    try {
      // نقطة واحدة تُعيد كل المستخدمين النشطين مع سياقهم (القسم/المنصب الحالي).
      // للمدير الحق في اختيار أي مستخدم بغض النظر عن قسمه.
      let res = await fetch('/api/vacancies/candidates');
      let data: UserOption[] = [];
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json)) data = json;
      } else {
        // Fallback إلى /api/users في حالة نادرة لو لم تكن نقطة candidates منشورة بعد
        const fallbackRes = await fetch('/api/users');
        if (fallbackRes.ok) {
          const all = await fallbackRes.json();
          if (Array.isArray(all)) {
            data = all.map((u: any) => ({
              UserID: u.UserID,
              FullName: u.FullName || u.UserID,
              CurrentDepartmentID: u.DepartmentID ?? null,
              CurrentDepartmentName: u.DepartmentName ?? null,
              CurrentVacancyName: null,
            }));
          }
        }
      }
      setCandidateUsers(data);
    } catch (err) {
      console.error('Error fetching candidate users:', err);
      setCandidateUsers([]);
    } finally {
      setCandidatesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  useEffect(() => {
    if (selectedDepartmentId != null) {
      fetchVacancies(selectedDepartmentId);
    } else {
      setVacancies([]);
    }
  }, [selectedDepartmentId, fetchVacancies]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch('/api/departments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Name: newDepartmentName,
        ParentID: newDepartmentParentId ?? null,
        ParentDepartmentID: newDepartmentParentId ?? null,
        IsActive: newDepartmentActive,
        Active: newDepartmentActive,
        Type: newDepartmentIndependent ? 1 : null,
      }),
    });
    setNewDepartmentName('');
    setNewDepartmentParentId(null);
    setNewDepartmentActive(true);
    setNewDepartmentIndependent(false);
    fetchDepartments();
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDepartment) return;
    const parentId = normalizeParentId(editingDepartment);
    const isActive = normalizeActive(editingDepartment);
    await fetch(`/api/departments/${editingDepartment.DepartmentID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Name: editingDepartment.Name,
        ParentID: parentId ?? null,
        ParentDepartmentID: parentId ?? null,
        IsActive: isActive,
        Active: isActive,
        Type: normalizeIndependent(editingDepartment) ? 1 : null,
      }),
    });
    setEditingDepartment(null);
    fetchDepartments();
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('هل أنت متأكد؟ قد لا تتمكن من حذف قسم مرتبط بمستخدمين.')) {
      try {
        const response = await fetch(`/api/departments/${id}`, { method: 'DELETE' });
        if (!response.ok) {
            const errorData = await response.json();
            alert(errorData.message);
        }
        if (selectedDepartmentId === id) setSelectedDepartmentId(null);
        fetchDepartments();
      } catch (error) {
        alert("An unexpected error occurred.");
      }
    }
  };

  const normalizeIndependent = (dep: Department): boolean => {
    const v = dep.Type;
    if (v === null || v === undefined) return false;
    return String(v).trim() === '1';
  };

  const normalizeParentId = (dep: Department): number | null => {
    const pid = dep.ParentID ?? dep.ParentDepartmentID;
    if (pid === undefined || pid === null) return null;
    const n = Number(pid);
    return Number.isFinite(n) ? n : null;
  };

  const normalizeActive = (dep: Department): boolean => {
    const v = dep.IsActive ?? dep.Active;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return true;
  };

  const normalizeVacancyActive = (v: Vacancy): boolean => {
    const val = v.IsActive;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    return true;
  };

  const buildTree = (items: Department[]): TreeNode[] => {
    const map = new Map<number, TreeNode>();
    const roots: TreeNode[] = [];
    items.forEach((d) => {
      map.set(d.DepartmentID, { ...d, children: [] });
    });
    map.forEach((node) => {
      const pid = normalizeParentId(node);
      if (pid && map.has(pid)) {
        map.get(pid)!.children.push(node);
      } else {
        roots.push(node);
      }
    });
    const sortNodes = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => a.Name.localeCompare(b.Name));
      nodes.forEach((n) => sortNodes(n.children));
    };
    sortNodes(roots);
    return roots;
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleQuickAddChild = (parentId: number) => {
    setEditingDepartment(null);
    setNewDepartmentName('');
    setNewDepartmentParentId(parentId);
    setNewDepartmentActive(true);
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);
  };

  // ---- عمليات المناصب ----
  const handleCreateVacancy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDepartmentId == null) return;
    const nm = newVacancyName.trim();
    if (!nm) return;
    try {
      const res = await fetch('/api/vacancies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ DepartmentID: selectedDepartmentId, Name: nm, IsActive: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail ? `\n\nالتفاصيل: ${err.detail}` : '';
        alert(`${err.message || 'تعذّر إضافة المنصب'}${detail}`);
      } else {
        const created = await res.json().catch(() => null);
        const rankVal = newVacancyRank.trim();
        if (rankVal && created?.VacancyID) {
          await fetch(`/api/vacancies/${created.VacancyID}/rank`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Rank: rankVal }),
          }).catch(() => {});
        }
        setNewVacancyName('');
        setNewVacancyRank('');
        fetchVacancies(selectedDepartmentId);
      }
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء إضافة المنصب');
    }
  };

  const handleSaveVacancyEdit = async () => {
    if (!editingVacancy) return;
    try {
      const res = await fetch(`/api/vacancies/${editingVacancy.VacancyID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Name: editingVacancy.Name,
          IsActive: normalizeVacancyActive(editingVacancy),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail ? `\n\nالتفاصيل: ${err.detail}` : '';
        alert(`${err.message || 'تعذّر حفظ التعديل'}${detail}`);
        return;
      }
      const rankVal = editingVacancyRank.trim();
      if (rankVal) {
        await fetch(`/api/vacancies/${editingVacancy.VacancyID}/rank`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ Rank: rankVal }),
        }).catch(() => {});
      } else {
        await fetch(`/api/vacancies/${editingVacancy.VacancyID}/rank`, { method: 'DELETE' }).catch(() => {});
      }
      setEditingVacancy(null);
      setEditingVacancyRank('');
      if (selectedDepartmentId != null) fetchVacancies(selectedDepartmentId);
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء حفظ المنصب');
    }
  };

  const handleDeleteVacancy = async (vacancyId: number) => {
    if (!window.confirm('سيتم حذف المنصب نهائياً. هل تريد المتابعة؟')) return;
    try {
      const res = await fetch(`/api/vacancies/${vacancyId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail ? `\n\nالتفاصيل: ${err.detail}` : '';
        alert(`${err.message || 'تعذّر حذف المنصب'}${detail}`);
        return;
      }
      if (selectedDepartmentId != null) fetchVacancies(selectedDepartmentId);
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء حذف المنصب');
    }
  };

  const openAssignPanel = async (vacancyId: number) => {
    setAssignOpenFor(vacancyId);
    setSelectedUserIdToAssign('');
    setCandidateSearch('');
    await fetchCandidateUsers();
  };

  const filteredCandidates = React.useMemo(() => {
    // مدير القسم يرى فقط من يعمل ضمن نطاقه
    let base = candidateUsers;
    if (scopeDeptIds) {
      base = base.filter(u =>
        u.CurrentDepartmentID != null && scopeDeptIds.has(u.CurrentDepartmentID)
      );
    }
    const q = candidateSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(u => {
      const hay = [
        u.FullName || '',
        u.UserID || '',
        u.CurrentDepartmentName || '',
        u.CurrentVacancyName || '',
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [candidateUsers, candidateSearch, scopeDeptIds]);

  const handleAssignUser = async () => {
    if (assignOpenFor == null || !selectedUserIdToAssign) return;
    try {
      const res = await fetch(`/api/vacancies/${assignOpenFor}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ UserID: selectedUserIdToAssign }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail ? `\n\nالتفاصيل: ${err.detail}` : '';
        alert(`${err.message || 'تعذّر الإسناد'}${detail}`);
        return;
      }
      setAssignOpenFor(null);
      setSelectedUserIdToAssign('');
      if (selectedDepartmentId != null) fetchVacancies(selectedDepartmentId);
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء إسناد المستخدم');
    }
  };

  const handleUnassign = async (vacancyId: number) => {
    if (!window.confirm('سيُترَك المنصب شاغراً. متابعة؟')) return;
    try {
      const res = await fetch(`/api/vacancies/${vacancyId}/assign`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail ? `\n\nالتفاصيل: ${err.detail}` : '';
        alert(`${err.message || 'تعذّر إلغاء الإسناد'}${detail}`);
        return;
      }
      if (selectedDepartmentId != null) fetchVacancies(selectedDepartmentId);
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء إلغاء الإسناد');
    }
  };

  const renderNode = (node: TreeNode, depth: number = 0) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.DepartmentID);
    const isActive = normalizeActive(node);
    const isIndependent = normalizeIndependent(node);
    const isSelected = selectedDepartmentId === node.DepartmentID;
    return (
      <li key={node.DepartmentID} className={`border rounded-md mb-1 ${isSelected ? 'ring-2 ring-primary bg-primary/5' : ''}`}>
        <div className="flex items-center justify-between p-2" style={{ paddingInlineStart: `${depth * 16 + 8}px` }}>
          <div className="flex items-center gap-2 flex-wrap">
            {hasChildren ? (
              <button onClick={() => toggleExpand(node.DepartmentID)} className="text-gray-600 hover:text-gray-800">
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
            ) : (
              <span className="w-4 inline-block" />
            )}
            <button
              onClick={() => setSelectedDepartmentId(node.DepartmentID)}
              className={`${isActive ? 'text-gray-900' : 'text-gray-400 line-through'} hover:underline text-right`}
              title="عرض/إدارة مناصب هذا القسم"
            >
              {node.Name}
            </button>
            <span className={`text-xs px-2 py-0.5 rounded ${isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {isActive ? 'مفعّل' : 'موقّف'}
            </span>
            {isIndependent && (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">
                مستقل
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setSelectedDepartmentId(node.DepartmentID)}
              className="text-purple-600 hover:text-purple-800"
              title="إدارة المناصب"
            >
              <Briefcase size={16}/>
            </button>
            <button onClick={() => setEditingDepartment(node)} className="text-blue-500 hover:text-blue-700" title="تعديل القسم"><Edit size={16}/></button>
            {isSystemAdmin && <button onClick={() => handleDelete(node.DepartmentID)} className="text-red-500 hover:text-red-700" title="حذف القسم"><Trash2 size={16}/></button>}
            <button onClick={() => handleQuickAddChild(node.DepartmentID)} className="text-green-600 hover:text-green-800" title="إضافة قسم فرعي"><Plus size={16}/></button>
          </div>
        </div>
        {hasChildren && isExpanded && (
          <ul className="ml-2">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const selectedDepartment = selectedDepartmentId != null
    ? visibleDepts.find(d => d.DepartmentID === selectedDepartmentId) || null
    : null;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* قائمة الأقسام الحالية على شكل شجرة */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-2xl font-semibold mb-4">الأقسام الحالية (شجرة)</h2>
          <p className="text-xs text-gray-500 mb-3">انقر اسم القسم أو أيقونة الحقيبة لإدارة مناصبه.</p>
          {isManager && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
              تعرض الأقسام التابعة لقسمك فقط
            </p>
          )}
          <ul className="space-y-1">
            {buildTree(visibleDepts).map((root) => renderNode(root))}
          </ul>
        </div>

        {/* نموذج الإضافة أو التعديل */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-2xl font-semibold mb-4">{editingDepartment ? `تعديل قسم: ${editingDepartment.Name}` : 'إضافة قسم جديد'}</h2>
          <form onSubmit={editingDepartment ? handleUpdate : handleCreate} className="space-y-4">
            <input
              type="text"
              placeholder="اسم القسم"
              value={editingDepartment ? editingDepartment.Name : newDepartmentName}
              onChange={(e) => editingDepartment ? setEditingDepartment({...editingDepartment, Name: e.target.value}) : setNewDepartmentName(e.target.value)}
              required
              className="w-full p-2 border rounded"
              ref={nameInputRef}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">القسم الأب</label>
                <select
                  className="w-full p-2 border rounded"
                  value={editingDepartment ? (normalizeParentId(editingDepartment) ?? '') : (newDepartmentParentId ?? '')}
                  onChange={(e) => {
                    const val = e.target.value === '' ? null : Number(e.target.value);
                    if (editingDepartment) {
                      setEditingDepartment({ ...editingDepartment, ParentID: val, ParentDepartmentID: val });
                    } else {
                      setNewDepartmentParentId(val);
                    }
                  }}
                >
                  <option value="">بدون أب</option>
                  {visibleDepts.map((dep) => (
                    <option key={dep.DepartmentID} value={dep.DepartmentID}>{dep.Name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editingDepartment ? normalizeActive(editingDepartment) : newDepartmentActive}
                    onChange={(e) => {
                      const val = e.target.checked;
                      if (editingDepartment) {
                        setEditingDepartment({ ...editingDepartment, IsActive: val, Active: val });
                      } else {
                        setNewDepartmentActive(val);
                      }
                    }}
                  />
                  <span>مفعّل</span>
                </label>
                {isSystemAdmin && (
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editingDepartment ? normalizeIndependent(editingDepartment) : newDepartmentIndependent}
                      onChange={(e) => {
                        const val = e.target.checked;
                        if (editingDepartment) {
                          setEditingDepartment({ ...editingDepartment, Type: val ? 1 : null });
                        } else {
                          setNewDepartmentIndependent(val);
                        }
                      }}
                    />
                    <span className="text-sm">قسم مستقل</span>
                  </label>
                )}
              </div>
            </div>
            <button type="submit" className="w-full bg-green-500 text-white py-2 rounded-md hover:bg-green-600 flex items-center justify-center gap-2">
              {editingDepartment ? 'حفظ التغييرات' : <><Plus size={18}/> إضافة</>}
            </button>
            {editingDepartment && <button type="button" onClick={() => setEditingDepartment(null)} className="w-full text-center text-sm mt-2 text-gray-500 hover:underline">إلغاء التعديل</button>}
          </form>
        </div>
      </div>

      {/* لوحة إدارة المناصب للقسم المحدد */}
      {selectedDepartment && (
        <div className="bg-white p-6 rounded-lg shadow border-2 border-primary/30">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold flex items-center gap-2">
              <Briefcase size={22} /> مناصب قسم: <span className="text-primary">{selectedDepartment.Name}</span>
            </h2>
            <button
              onClick={() => setSelectedDepartmentId(null)}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <X size={16}/> إغلاق
            </button>
          </div>

          {/* نموذج إضافة منصب جديد */}
          <form onSubmit={handleCreateVacancy} className="mb-4 space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="اسم المنصب الجديد (مثال: رئيس قسم الأرشفة)"
                value={newVacancyName}
                onChange={(e) => setNewVacancyName(e.target.value)}
                className="flex-1 p-2 border rounded"
              />
              {distinctRanks.length > 0 ? (
                <select
                  value={newVacancyRank}
                  onChange={(e) => setNewVacancyRank(e.target.value)}
                  className="p-2 border rounded bg-white min-w-[130px]"
                >
                  <option value="">-- الرتبة --</option>
                  {distinctRanks.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="الرتبة (اختياري)"
                  value={newVacancyRank}
                  onChange={(e) => setNewVacancyRank(e.target.value)}
                  className="p-2 border rounded w-36"
                />
              )}
              <button type="submit" className="bg-primary text-white px-4 py-2 rounded-md hover:bg-primary-dark flex items-center gap-2">
                <Plus size={16}/> إضافة منصب
              </button>
            </div>
          </form>

          {/* قائمة المناصب */}
          {vacanciesLoading ? (
            <p className="text-gray-500 text-center py-4">جارٍ تحميل المناصب...</p>
          ) : vacancies.length === 0 ? (
            <p className="text-gray-500 text-center py-4">لا توجد مناصب مضافة في هذا القسم بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right">
                <thead className="border-b border-content/10">
                  <tr>
                    <th className="p-2 font-semibold">المنصب</th>
                    <th className="p-2 font-semibold">الرتبة</th>
                    <th className="p-2 font-semibold">الحالة</th>
                    <th className="p-2 font-semibold">الموظف الحالي</th>
                    <th className="p-2 font-semibold">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {vacancies.map(v => {
                    const isActive = normalizeVacancyActive(v);
                    const isEditingThis = editingVacancy?.VacancyID === v.VacancyID;
                    const hasHolder = !!v.CurrentUserID;
                    return (
                      <React.Fragment key={v.VacancyID}>
                        <tr className="border-b border-content/10 hover:bg-content/5">
                          <td className="p-2">
                            {isEditingThis ? (
                              <input
                                type="text"
                                value={editingVacancy!.Name}
                                onChange={(e) => setEditingVacancy({ ...editingVacancy!, Name: e.target.value })}
                                className="w-full p-1 border rounded"
                              />
                            ) : (
                              <span className={isActive ? '' : 'line-through text-gray-400'}>{v.Name}</span>
                            )}
                          </td>
                          <td className="p-2">
                            {isEditingThis ? (
                              distinctRanks.length > 0 ? (
                                <select
                                  value={editingVacancyRank}
                                  onChange={(e) => setEditingVacancyRank(e.target.value)}
                                  className="p-1 border rounded bg-white text-sm w-28"
                                >
                                  <option value="">-- بدون --</option>
                                  {distinctRanks.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  value={editingVacancyRank}
                                  onChange={(e) => setEditingVacancyRank(e.target.value)}
                                  placeholder="الرتبة"
                                  className="p-1 border rounded text-sm w-24"
                                />
                              )
                            ) : (
                              <span className="text-sm text-content-secondary">
                                {ranksMap.get(v.VacancyID) || <span className="text-gray-300">—</span>}
                              </span>
                            )}
                          </td>
                          <td className="p-2">
                            {isEditingThis ? (
                              <label className="inline-flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={normalizeVacancyActive(editingVacancy!)}
                                  onChange={(e) => setEditingVacancy({ ...editingVacancy!, IsActive: e.target.checked })}
                                />
                                <span className="text-sm">مفعّل</span>
                              </label>
                            ) : (
                              <span className={`text-xs px-2 py-0.5 rounded ${isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {isActive ? 'مفعّل' : 'موقّف'}
                              </span>
                            )}
                          </td>
                          <td className="p-2">
                            {hasHolder ? (
                              <span>{v.CurrentUserFullName || v.CurrentUserID}</span>
                            ) : (
                              <span className="text-xs text-gray-400">شاغر</span>
                            )}
                          </td>
                          <td className="p-2 flex gap-2">
                            {isEditingThis ? (
                              <>
                                <button onClick={handleSaveVacancyEdit} className="text-green-600 hover:text-green-800" title="حفظ"><Check size={16}/></button>
                                <button onClick={() => { setEditingVacancy(null); setEditingVacancyRank(''); }} className="text-gray-500 hover:text-gray-700" title="إلغاء"><X size={16}/></button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => openAssignPanel(v.VacancyID)} className="text-blue-600 hover:text-blue-800" title="إسناد موظف"><UserPlus size={16}/></button>
                                {hasHolder && (
                                  <button onClick={() => handleUnassign(v.VacancyID)} className="text-orange-600 hover:text-orange-800" title="تفريغ المنصب"><UserMinus size={16}/></button>
                                )}
                                <button onClick={() => { setEditingVacancy(v); setEditingVacancyRank(ranksMap.get(v.VacancyID) || ''); }} className="text-blue-500 hover:text-blue-700" title="تعديل"><Edit size={16}/></button>
                                {isSystemAdmin && <button onClick={() => handleDeleteVacancy(v.VacancyID)} className="text-red-500 hover:text-red-700" title="حذف"><Trash2 size={16}/></button>}
                              </>
                            )}
                          </td>
                        </tr>
                        {/* صف الإسناد (يظهر أسفل المنصب المحدد للإسناد) */}
                        {assignOpenFor === v.VacancyID && (
                          <tr className="bg-primary/5">
                            <td colSpan={4} className="p-3">
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm text-gray-700 font-semibold">
                                    إسناد موظف إلى: «{v.Name}»
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    (يمكنك اختيار أي موظف بغض النظر عن قسمه الحالي)
                                  </span>
                                </div>

                                <input
                                  type="text"
                                  placeholder="ابحث بالاسم أو المعرّف أو القسم..."
                                  value={candidateSearch}
                                  onChange={(e) => setCandidateSearch(e.target.value)}
                                  className="w-full p-2 border rounded"
                                />

                                <div className="max-h-64 overflow-y-auto border rounded bg-white">
                                  {candidatesLoading ? (
                                    <p className="text-center text-gray-500 py-4 text-sm">جارٍ تحميل الموظفين...</p>
                                  ) : filteredCandidates.length === 0 ? (
                                    <p className="text-center text-gray-500 py-4 text-sm">
                                      {candidateUsers.length === 0
                                        ? 'لا توجد بيانات موظفين لعرضها.'
                                        : 'لا توجد نتائج مطابقة لبحثك.'}
                                    </p>
                                  ) : (
                                    <ul className="divide-y">
                                      {filteredCandidates.map(u => {
                                        const isSelected = selectedUserIdToAssign === u.UserID;
                                        return (
                                          <li
                                            key={u.UserID}
                                            onClick={() => setSelectedUserIdToAssign(u.UserID)}
                                            className={`cursor-pointer p-2 hover:bg-primary/10 ${isSelected ? 'bg-primary/15 border-r-4 border-primary' : ''}`}
                                          >
                                            <div className="flex items-center justify-between gap-2">
                                              <div className="flex-1 min-w-0">
                                                <div className="font-medium text-gray-900 truncate">
                                                  {u.FullName || u.UserID}
                                                </div>
                                                <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                                                  <span>المعرّف: {u.UserID}</span>
                                                  {u.CurrentVacancyName ? (
                                                    <span className="text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                                                      يحمل حالياً: {u.CurrentVacancyName}
                                                      {u.CurrentDepartmentName ? ` — ${u.CurrentDepartmentName}` : ''}
                                                    </span>
                                                  ) : u.CurrentDepartmentName ? (
                                                    <span>القسم: {u.CurrentDepartmentName}</span>
                                                  ) : (
                                                    <span className="text-green-700 bg-green-100 px-2 py-0.5 rounded">بدون منصب حالي</span>
                                                  )}
                                                </div>
                                              </div>
                                              {isSelected && <Check size={18} className="text-primary shrink-0" />}
                                            </div>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs text-gray-600">
                                    {selectedUserIdToAssign
                                      ? `المحدَّد: ${candidateUsers.find(c => c.UserID === selectedUserIdToAssign)?.FullName || selectedUserIdToAssign}`
                                      : 'لم يتم اختيار أي موظف بعد.'}
                                  </span>
                                  <span className="flex-1" />
                                  <button
                                    onClick={handleAssignUser}
                                    disabled={!selectedUserIdToAssign}
                                    className="bg-primary text-white px-3 py-2 rounded hover:bg-primary-dark disabled:opacity-50 flex items-center gap-1"
                                  >
                                    <Check size={16}/> إسناد
                                  </button>
                                  <button
                                    onClick={() => { setAssignOpenFor(null); setSelectedUserIdToAssign(''); setCandidateSearch(''); }}
                                    className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
                                  >
                                    <X size={16}/> إلغاء
                                  </button>
                                </div>

                                <p className="text-xs text-gray-500">
                                  ملاحظة: إسناد موظف يحمل منصباً آخر سيُغلِق إسناده السابق تلقائياً.
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DepartmentManagement;
