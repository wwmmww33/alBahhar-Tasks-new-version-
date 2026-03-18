// src/pages/ProceduresManagement.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CurrentUser } from '../types';
import { getActiveUserId } from '../utils/activeAccount';
import { resolveCurrentActorId } from '../utils/actorIdentity';

type Procedure = { ProcedureID: number; Title: string; CreatedBy: string; IsPublic: boolean; };
type ProceduresManagementProps = { currentUser: CurrentUser; };

const ProceduresManagement = ({ currentUser }: ProceduresManagementProps) => {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [subtasks, setSubtasks] = useState<{ title: string; offset: number }[]>([]);
  const actorId = getActiveUserId(resolveCurrentActorId(currentUser) || currentUser.UserID);

  const fetchProcedures = useCallback(async () => {
    setIsLoading(true);
    const response = await fetch(`/api/procedures?userId=${actorId}&departmentId=${currentUser.DepartmentID}`);
    const data = await response.json();
    setProcedures(data);
    setIsLoading(false);
  }, [actorId, currentUser.DepartmentID]);

  useEffect(() => {
    fetchProcedures();
  }, [fetchProcedures]);

  const handleAddSubtaskField = () => setSubtasks([...subtasks, { title: '', offset: 0 }]);
  const handleSubtaskChange = (index: number, field: 'title' | 'offset', value: string) => {
    const updated = [...subtasks];
    if (field === 'title') updated[index].title = value;
    else updated[index].offset = parseInt(value) || 0;
    setSubtasks(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      Title: newTitle, IsPublic: isPublic, CreatedBy: actorId,
      DepartmentID: currentUser.DepartmentID, subtasks: subtasks,
    };
    await fetch('/api/procedures', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    setShowForm(false);
    setNewTitle('');
    setSubtasks([]);
    fetchProcedures();
  };

  if (isLoading) return <p className="text-center p-8">جاري تحميل المهام الافتراضية...</p>;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-content">إدارة المهام الافتراضية</h1>
        <button onClick={() => setShowForm(!showForm)} className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-dark flex items-center gap-2">
          <Plus size={20} /><span>{showForm ? 'إلغاء' : 'إنشاء مهمة افتراضية'}</span>
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-content/5 p-6 rounded-lg shadow-md mb-6 space-y-4">
          <h2 className="text-2xl font-semibold">مهمة افتراضية جديدة</h2>
          <div><label className="text-sm font-medium">عنوان المهمة الافتراضية</label><input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)} required className="w-full p-2 border rounded mt-1 bg-bkg border-content/20"/></div>
          <div className="flex items-center gap-2"><input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} id="isPublic"/> <label htmlFor="isPublic">عامة لجميع أفراد القسم</label></div>
          <div className="border-t border-content/10 pt-4">
            <h3 className="text-lg font-semibold">المهام الفرعية الافتراضية</h3>
            <div className="flex items-center gap-2 text-sm text-content-secondary mt-2"><div className="flex-grow">عنوان المهمة الفرعية</div><div className="w-48">تاريخ الاستحقاق (بعد X أيام)</div><div className="w-8"></div></div>
            {subtasks.map((sub, index) => (
              <div key={index} className="flex items-center gap-2 mt-2">
                <input type="text" placeholder="مثال: مراجعة العقد" value={sub.title} onChange={e => handleSubtaskChange(index, 'title', e.target.value)} required className="flex-grow p-2 border rounded bg-bkg border-content/20"/>
                <input type="number" placeholder="مثال: 3" value={sub.offset} onChange={e => handleSubtaskChange(index, 'offset', e.target.value)} required className="w-48 p-2 border rounded text-center bg-bkg border-content/20"/>
                <button type="button" onClick={() => setSubtasks(subtasks.filter((_, i) => i !== index))} className="text-red-500 p-2"><Trash2/></button>
              </div>
            ))}
            <button type="button" onClick={handleAddSubtaskField} className="text-sm text-primary mt-2">+ إضافة مهمة فرعية</button>
          </div>
          <div className="border-t border-content/10 pt-4"><button type="submit" className="w-full bg-primary text-white py-2 rounded-md hover:bg-primary-dark">حفظ المهمة الافتراضية</button></div>
        </form>
      )}

      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
        <ul className="space-y-4">
          {procedures.length > 0 ? procedures.map(proc => (
            <Link key={proc.ProcedureID} to={`/procedures/edit/${proc.ProcedureID}`} className="block">
              <li className="flex items-center p-4 border rounded-md hover:bg-content/5 transition-colors border-content/10">
                <FileText className="text-primary mr-4" />
                <div className="flex-grow"><p className="font-semibold text-content">{proc.Title}</p><p className="text-sm text-content-secondary">بواسطة: {proc.CreatedBy} - {proc.IsPublic ? 'عام' : 'خاص'}</p></div>
                <span className="text-sm text-primary hover:underline">تعديل</span>
              </li>
            </Link>
          )) : <p className="text-center text-content-secondary py-4">لا توجد مهام افتراضية لعرضها.</p>}
        </ul>
      </div>
    </div>
  );
};
export default ProceduresManagement;