// src/pages/ProcedureEdit.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';

type ProcedureSubtask = { Title: string; DueDateOffset: number; };
type ProcedureDetails = { ProcedureID: number; Title: string; IsPublic: boolean; };

const ProcedureEdit = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [subtasks, setSubtasks] = useState<{ title: string; offset: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // --- دالة جلب البيانات المحسنة ---
  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      // جلب المهمة الرئيسية ومهامها الفرعية معاً باستخدام الـ APIs الجديدة
      const [procRes, subtasksRes] = await Promise.all([
        fetch(`/api/procedures/${id}`),
        fetch(`/api/procedures/${id}/subtasks`)
      ]);
      
      const procData: ProcedureDetails = await procRes.json();
      const subtasksData: ProcedureSubtask[] = await subtasksRes.json();
      
      // تعبئة النموذج بالبيانات التي تم جلبها
      setTitle(procData.Title);
      setIsPublic(procData.IsPublic);
      setSubtasks(subtasksData.map(s => ({ title: s.Title, offset: s.DueDateOffset })));

    } catch (error) {
      console.error("Failed to fetch procedure details", error);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddSubtaskField = () => setSubtasks([...subtasks, { title: '', offset: 0 }]);

  const handleSubtaskChange = (index: number, field: 'title' | 'offset', value: string) => {
    const updated = [...subtasks];
    if (field === 'title') updated[index].title = value;
    else updated[index].offset = parseInt(value) || 0;
    setSubtasks(updated);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { Title: title, IsPublic: isPublic, subtasks: subtasks };
    await fetch(`/api/procedures/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    navigate('/procedures');
  };

  const handleDelete = async () => {
    if (window.confirm('هل أنت متأكد من حذف هذه المهمة الافتراضية وكل مهامها الفرعية نهائياً؟')) {
        await fetch(`/api/procedures/${id}`, { method: 'DELETE' });
        navigate('/procedures');
    }
  };

  if (isLoading) return <p>جاري تحميل بيانات المهمة...</p>;

  return (
    <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">تعديل المهمة الافتراضية</h1>
        <button onClick={handleDelete} className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 flex items-center gap-2"><Trash2 size={16} /> <span>حذف</span></button>
      </div>

      <form onSubmit={handleUpdate} className="space-y-4">
        <div><label className="text-sm font-medium">عنوان المهمة الافتراضية</label><input type="text" value={title} onChange={e => setTitle(e.target.value)} required className="w-full p-2 border rounded mt-1 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"/></div>
        <div className="flex items-center gap-2"><input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} id="isPublic"/> <label htmlFor="isPublic">عامة لجميع أفراد القسم</label></div>
        <div className="border-t dark:border-gray-700 pt-4">
          <h3 className="text-lg font-semibold">المهام الفرعية</h3>
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mt-2"><div className="flex-grow">عنوان المهمة الفرعية</div><div className="w-48">تاريخ الاستحقاق (بعد X أيام)</div><div className="w-8"></div></div>
          {subtasks.map((sub, index) => (
            <div key={index} className="flex items-center gap-2 mt-2">
              <input type="text" placeholder="عنوان المهمة الفرعية" value={sub.title} onChange={e => handleSubtaskChange(index, 'title', e.target.value)} required className="flex-grow p-2 border rounded bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"/>
              <input type="number" placeholder="أيام" value={sub.offset} onChange={e => handleSubtaskChange(index, 'offset', e.target.value)} required className="w-48 p-2 border rounded text-center bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"/>
              <button type="button" onClick={() => setSubtasks(subtasks.filter((_, i) => i !== index))} className="text-red-500 p-2"><Trash2/></button>
            </div>
          ))}
          <button type="button" onClick={handleAddSubtaskField} className="text-sm text-blue-600 mt-2">+ إضافة مهمة فرعية</button>
        </div>
        <div className="border-t dark:border-gray-700 pt-4"><button type="submit" className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700">حفظ التغييرات</button></div>
      </form>
    </div>
  );
};

export default ProcedureEdit;