// src/pages/CreateTask.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CurrentUser } from '../types';
import { getActiveUserId, getActiveAccount } from '../utils/activeAccount';
import { resolveCurrentActorId } from '../utils/actorIdentity';
import { getApiUrl } from '../config/api';

// تعريف أنواع البيانات التي سنستخدمها
type Procedure = {
  ProcedureID: number;
  Title: string;
};
type ProcedureSubtask = {
  Title: string;
  DueDateOffset: number;
};
type Category = {
  CategoryID: number;
  Name: string;
  Description: string;
  DepartmentID: number;
};

// تعريف الـ Props بشكل صحيح
type CreateTaskProps = {
  currentUser: CurrentUser;
};

const CreateTask = ({ currentUser }: CreateTaskProps) => {
  const navigate = useNavigate();
  const actorId = getActiveUserId(resolveCurrentActorId(currentUser) || currentUser.UserID);
  // في وضع التفويض: actorId = معرّف المفوِّض (المالك الحقيقي للمهمة)
  // ActedBy يجب أن يحمل معرّف المفوَّض له (currentUser هو User B المسجَّل فعلياً)
  const _activeAccount = getActiveAccount();
  const _isDelegationMode = _activeAccount?.mode === 'delegation';
  // نُرسل VacancyID المفوَّض له إن وُجد، وإلا UserID — الخادم يحتاج لمطابقة التفويض
  const delegateUserId = _isDelegationMode
    ? (resolveCurrentActorId(currentUser) || String(currentUser.UserID || '').trim())
    : null;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const getTodayString = () => new Date().toISOString().split('T')[0];
  const [dueDate, setDueDate] = useState(getTodayString()); // القيمة الافتراضية هي اليوم
  
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [selectedProcedure, setSelectedProcedure] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // جلب قائمة المهام الافتراضية والتصنيفات عند تحميل الصفحة
  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser) return;
      try {
        // جلب المهام الافتراضية
        const proceduresResponse = await fetch(`/api/procedures?userId=${actorId}&departmentId=${currentUser.DepartmentID}`);
        if (proceduresResponse.ok) {
          const proceduresData = await proceduresResponse.json();
          setProcedures(proceduresData);
        }
        
        // جلب التصنيفات
        if (currentUser.DepartmentID) {
          const categoriesResponse = await fetch(getApiUrl(`categories/department/${currentUser.DepartmentID}`));
          if (categoriesResponse.ok) {
            const categoriesData = await categoriesResponse.json();
            setCategories(categoriesData.Categories || categoriesData);
          }
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };
    fetchData();
  }, [actorId, currentUser, currentUser.DepartmentID]);

  // دالة يتم استدعاؤها عند تغيير المهمة الافتراضية المختارة
  const handleProcedureChange = async (procedureId: string) => {
    setSelectedProcedure(procedureId);
    if (!procedureId) {
      setSubtasks([]);
      return;
    }
    try {
      const response = await fetch(`/api/procedures/${procedureId}/subtasks`);
      if (!response.ok) throw new Error('Failed to fetch subtasks for procedure');
      const data: ProcedureSubtask[] = await response.json();
      setSubtasks(data.map(st => st.Title));
    } catch (error) {
      console.error("Error fetching procedure subtasks:", error);
    }
  };


const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (isSubmitting) return;

  // --- تحقق مهم هنا ---
  if (!currentUser || currentUser.DepartmentID === null) {
      setMessage({ type: 'error', text: 'لا يمكن إنشاء مهمة بدون قسم. يرجى التأكد من أن حسابك مرتبط بقسم.' });
      return;
  }

  setIsSubmitting(true);
  setMessage(null);

  const actingUserId = actorId;
  const newTaskPayload = {
    Title: title,
    Description: description,
    DueDate: dueDate,
    DepartmentID: currentUser.DepartmentID,
    Priority: 'normal',
    Status: 'open', // الحالة الافتراضية: مفتوحة
    AssignedTo: actingUserId,
    subtasks: subtasks,
    CreatedBy: actingUserId,
    ActedBy: _isDelegationMode ? delegateUserId : actingUserId,
    CategoryID: selectedCategory ? parseInt(selectedCategory) : null,
  };

  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTaskPayload),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || 'فشل في إنشاء المهمة.');
    }
    navigate(`/task/${result.newTaskId}`);
  } catch (error: any) {
    setMessage({ type: 'error', text: error.message });
  } finally {
    setIsSubmitting(false);
  }
};

  return (
    <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 p-8 rounded-lg shadow">
      <h1 className="text-3xl font-bold text-content mb-6">إنشاء مهمة جديدة</h1>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-content-secondary">عنوان المهمة</label>
          <input type="text" id="title" value={title} onChange={(e) => setTitle(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-content/20 bg-bkg rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"/>
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-content-secondary">الوصف</label>
          <textarea id="description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-content/20 bg-bkg rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"/>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="procedure" className="block text-sm font-medium text-content-secondary">اختيار مهمة افتراضية (اختياري)</label>
            <select id="procedure" value={selectedProcedure} onChange={(e) => handleProcedureChange(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-content/20 bg-bkg rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">-- اختر مهمة افتراضية --</option>
              {procedures.map(proc => (
                <option key={proc.ProcedureID} value={proc.ProcedureID}>{proc.Title}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="category" className="block text-sm font-medium text-content-secondary">التصنيف (اختياري)</label>
            <select id="category" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-content/20 bg-bkg rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">بدون تصنيف</option>
              {categories.map(category => (
                <option key={category.CategoryID} value={category.CategoryID}>{category.Name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="dueDate" className="block text-sm font-medium text-content-secondary">تاريخ الاستحقاق</label>
          <input type="date" id="dueDate" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-content/20 bg-bkg rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"/>
        </div>
        
        {subtasks.length > 0 && (
          <div>
            <h3 className="text-lg font-medium text-content mb-2">المهام الفرعية المقترحة</h3>
            <div className="space-y-2">
              {subtasks.map((subtask, index) => (
                <div key={index} className="flex items-center gap-2 p-2 bg-content/5 rounded">
                  <input type="text" value={subtask} readOnly className="flex-grow bg-transparent focus:outline-none text-content-secondary" />
                </div>
              ))}
            </div>
          </div>
        )}

        <button type="submit" disabled={isSubmitting} className="w-full bg-primary text-white py-2 px-4 rounded-md hover:bg-primary-dark disabled:bg-gray-400 transition-colors">
          {isSubmitting ? 'جاري الإنشاء...' : 'إنشاء المهمة'}
        </button>
      </form>
      {message && <div className={`mt-4 p-4 rounded-md text-sm ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{message.text}</div>}
    </div>
  );
};

export default CreateTask;