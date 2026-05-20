import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiUrl } from '../config/api';
import { getActiveUserId } from '../utils/activeAccount';
import { resolveCurrentActorId } from '../utils/actorIdentity';

interface Category {
  CategoryID: number;
  Name: string;
  Description: string;
  DepartmentID: number;
  CreatedBy: string;
  CreatedByVacancyID?: number | string | null;
  CreatedAt: string;
  UpdatedAt: string;
  IsActive: boolean;
  CreatedByName?: string;
  DepartmentName?: string;
}

interface CategoryManagementProps {
  currentUser: {
    UserID: string;
    VacancyID?: number | string | null;
    CurrentVacancyID?: number | string | null;
    ActiveVacancyID?: number | string | null;
    FullName: string;
    DepartmentID: number | null;
    IsAdmin: boolean;
  };
}

const CategoryManagement: React.FC<CategoryManagementProps> = ({ currentUser }) => {
  const navigate = useNavigate();
  const actorId = getActiveUserId(resolveCurrentActorId(currentUser) || currentUser.UserID);
  const categoryCreatorId = (category: Category) => String(category.CreatedByVacancyID ?? category.CreatedBy ?? '');
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; categoryId: number | null; taskCount: number }>(
    { open: false, categoryId: null, taskCount: 0 }
  );
  const [deleteAction, setDeleteAction] = useState<'uncategorize' | 'reassign' | null>(null);
  const [replacementCategoryId, setReplacementCategoryId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    departmentId: currentUser.DepartmentID || 0
  });

  // جلب التصنيفات
  const fetchCategories = async () => {
    try {
      setLoading(true);
      const response = await fetch(getApiUrl(`categories/department/${currentUser.DepartmentID}`));
      if (!response.ok) {
        throw new Error('فشل في جلب التصنيفات');
      }
      const data = await response.json();
      setCategories(data.Categories || data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser.DepartmentID) {
      fetchCategories();
    }
  }, [currentUser.DepartmentID]);

  // إضافة تصنيف جديد
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(getApiUrl('categories'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          departmentId: formData.departmentId,
          createdBy: actorId
        }),
      });

      if (!response.ok) {
        throw new Error('فشل في إضافة التصنيف');
      }

      await fetchCategories();
      setShowAddForm(false);
      setFormData({ name: '', description: '', departmentId: currentUser.DepartmentID || 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ في إضافة التصنيف');
    }
  };

  // تعديل تصنيف
  const handleEditCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory) return;

    try {
      const response = await fetch(getApiUrl(`categories/${editingCategory.CategoryID}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          departmentId: formData.departmentId,
          createdBy: actorId
        }),
      });

      if (!response.ok) {
        throw new Error('فشل في تعديل التصنيف');
      }

      await fetchCategories();
      setEditingCategory(null);
      setFormData({ name: '', description: '', departmentId: currentUser.DepartmentID || 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ في تعديل التصنيف');
    }
  };

  // حذف تصنيف مع فحص المهام المرتبطة وخيارات إعادة التعيين
  const handleDeleteCategory = async (categoryId: number) => {
    try {
      // جلب عدد المهام المرتبطة بالتصنيف
      const countRes = await fetch(getApiUrl(`categories/${categoryId}/linked-tasks-count`));
      if (!countRes.ok) {
        throw new Error('تعذر جلب عدد المهام المرتبطة');
      }
      const countData = await countRes.json();
      const taskCount = countData.taskCount ?? 0;

      if (taskCount === 0) {
        if (!confirm('لا توجد مهام مرتبطة. هل تريد حذف التصنيف؟')) return;
        const response = await fetch(getApiUrl(`categories/${categoryId}`), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ createdBy: actorId })
        });
        if (!response.ok) {
          throw new Error('فشل في حذف التصنيف');
        }
        await fetchCategories();
      } else {
        // فتح مربع حوار لاختيار الإجراء قبل الحذف
        setDeleteModal({ open: true, categoryId, taskCount });
        setDeleteAction(null);
        setReplacementCategoryId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ في حذف التصنيف');
    }
  };

  const confirmDeleteCategory = async () => {
    if (!deleteModal.open || !deleteModal.categoryId) return;
    try {
      if (!deleteAction) {
        setError('يرجى اختيار إجراء الحذف');
        return;
      }
      if (deleteAction === 'reassign' && !replacementCategoryId) {
        setError('يرجى اختيار تصنيف بديل لإعادة التعيين');
        return;
      }

      const response = await fetch(getApiUrl(`categories/${deleteModal.categoryId}`), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          createdBy: actorId,
          action: deleteAction,
          newCategoryId: deleteAction === 'reassign' ? replacementCategoryId : undefined
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'فشل في حذف التصنيف');
      }

      setDeleteModal({ open: false, categoryId: null, taskCount: 0 });
      setDeleteAction(null);
      setReplacementCategoryId(null);
      await fetchCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ في عملية الحذف');
    }
  };

  // بدء تعديل تصنيف
  const startEdit = (category: Category) => {
    setEditingCategory(category);
    setFormData({
      name: category.Name,
      description: category.Description,
      departmentId: category.DepartmentID
    });
    setShowAddForm(false);
  };

  // إلغاء التعديل
  const cancelEdit = () => {
    setEditingCategory(null);
    setFormData({ name: '', description: '', departmentId: currentUser.DepartmentID || 0 });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">إدارة التصنيفات</h2>
        <button
          onClick={() => {
            setShowAddForm(true);
            setEditingCategory(null);
            setFormData({ name: '', description: '', departmentId: currentUser.DepartmentID || 0 });
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          إضافة تصنيف جديد
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* نموذج الإضافة فقط */}
      {showAddForm && (
        <div className="bg-gray-50 p-4 rounded-lg mb-6">
          <h3 className="text-lg font-semibold mb-4">إضافة تصنيف جديد</h3>
          <form onSubmit={handleAddCategory}>
            <div className="mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  اسم التصنيف
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                وصف التصنيف
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors"
              >
                إضافة التصنيف
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setFormData({ name: '', description: '', departmentId: currentUser.DepartmentID || 0 });
                }}
                className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* قائمة التصنيفات */}
      <div className="space-y-4">
        {categories.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            لا توجد تصنيفات متاحة
          </div>
        ) : (
          categories.map((category) => (
            <div key={category.CategoryID} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">{category.Name}</h3>
                  <p className="text-gray-600 mb-2">{category.Description}</p>
                  <div className="text-sm text-gray-500">
                    <span>القسم: {category.DepartmentName || category.DepartmentID}</span>
                    <span className="mx-2">•</span>
                    <span>أنشئ بواسطة: {category.CreatedByName || category.CreatedBy}</span>
                    <span className="mx-2">•</span>
                    <span className="font-semibold">تم الإنشاء في: {new Date(category.CreatedAt).toLocaleDateString('en-GB')}</span>
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => navigate(`/categories/${category.CategoryID}`)}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm transition-colors"
                  >
                    عرض المعلومات
                  </button>
                  {currentUser && (
                    <button
                      onClick={() => startEdit(category)}
                      className="bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded text-sm transition-colors"
                      title="تعديل التصنيف"
                    >
                      تعديل
                    </button>
                  )}
                  {currentUser && categoryCreatorId(category) === actorId && (
                    <button
                      onClick={() => handleDeleteCategory(category.CategoryID)}
                      className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm transition-colors"
                      title="حذف التصنيف"
                    >
                      حذف
                    </button>
                  )}
                </div>
              </div>

              {/* نموذج تعديل يظهر مباشرة أسفل التصنيف المحدد */}
              {editingCategory && editingCategory.CategoryID === category.CategoryID && (
                <div className="bg-gray-50 p-4 rounded-lg mt-4">
                  <h4 className="text-md font-semibold mb-3">تعديل التصنيف: {category.Name}</h4>
                  <form onSubmit={handleEditCategory}>
                    <div className="mb-3">
                      <label className="block text-sm font-medium text-gray-700 mb-2">اسم التصنيف</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>
                    <div className="mb-3">
                      <label className="block text-sm font-medium text-gray-700 mb-2">وصف التصنيف</label>
                      <textarea
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors">
                        حفظ التعديلات
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors"
                      >
                        إلغاء
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* مربع حوار تأكيد الحذف وإعادة التعيين */}
      {deleteModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-6">
            <h3 className="text-xl font-bold mb-4">تأكيد الحذف</h3>
            <p className="text-gray-700 mb-3">
              يوجد {deleteModal.taskCount} مهمة مرتبطة بهذا التصنيف. اختر طريقة التعامل قبل الحذف:
            </p>
            <div className="space-y-3 mb-4">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={deleteAction === 'uncategorize'}
                  onChange={() => setDeleteAction('uncategorize')}
                />
                <span>جعل المهام بلا تصنيف</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={deleteAction === 'reassign'}
                  onChange={() => setDeleteAction('reassign')}
                />
                <span>إعادة تعيين المهام إلى تصنيف آخر</span>
              </label>
            </div>
            {deleteAction === 'reassign' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">اختر التصنيف البديل</label>
                <select
                  value={replacementCategoryId ?? ''}
                  onChange={(e) => setReplacementCategoryId(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="" disabled>اختر تصنيفًا</option>
                  {categories
                    .filter(c => c.DepartmentID === currentUser.DepartmentID && c.CategoryID !== deleteModal.categoryId)
                    .map(c => (
                      <option key={c.CategoryID} value={c.CategoryID}>{c.Name}</option>
                    ))}
                </select>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setDeleteModal({ open: false, categoryId: null, taskCount: 0 });
                  setDeleteAction(null);
                  setReplacementCategoryId(null);
                }}
                className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg"
              >
                إلغاء
              </button>
              <button
                onClick={confirmDeleteCategory}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg"
                disabled={deleteAction === 'reassign' && !replacementCategoryId}
              >
                حذف التصنيف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CategoryManagement;