import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import type { Category, CategoryInformation, CurrentUser } from '../types';
import { getApiUrl } from '../config/api';
import { getActiveUserId } from '../utils/activeAccount';
import { resolveCurrentActorId } from '../utils/actorIdentity';
import './CategoryInfo.css';

// CSS styles for the component
const styles = `
  .info-section {
    background: white;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 20px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }

  .info-header-with-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
  }

  .info-section h3 {
    color: #2563eb;
    margin: 0;
    font-size: 1.2rem;
  }

  .info-actions {
    display: flex;
    gap: 8px;
  }

  .edit-button, .delete-button {
    padding: 6px 12px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.2s;
  }

  .edit-button {
    background-color: #f59e0b;
    color: white;
  }

  .edit-button:hover {
    background-color: #d97706;
  }

  .delete-button {
    background-color: #ef4444;
    color: white;
  }

  .delete-button:hover {
    background-color: #dc2626;
  }

  .unified-info-content {
    padding: 0;
  }

  .info-item {
    margin-bottom: 20px;
  }

  .info-item:last-child {
    margin-bottom: 0;
  }

  .info-item-header {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 10px;
  }

  .info-separator {
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 20px 0;
  }

  .info-content {
    line-height: 1.6;
    color: #374151;
    margin-bottom: 10px;
  }

  .info-meta {
    color: #6b7280;
    border-top: 1px solid #f3f4f6;
    padding-top: 8px;
    margin-top: 12px;
  }

  .info-meta-hover {
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  .info-item:hover .info-meta-hover {
    opacity: 1;
  }
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleElement = document.createElement('style');
  styleElement.textContent = styles;
  document.head.appendChild(styleElement);
}

type CategoryInfoProps = {
  currentUser: CurrentUser;
};

const CategoryInfo: React.FC<CategoryInfoProps> = ({ currentUser }) => {
  const { categoryId } = useParams<{ categoryId: string }>();
  const [category, setCategory] = useState<Category | null>(null);
  const actorId = getActiveUserId(resolveCurrentActorId(currentUser) || currentUser.UserID);
  const infoCreatorId = (info: CategoryInformation) => String((info as any).CreatedByVacancyID ?? info.CreatedBy ?? '');
  
  // السماح لأي مستخدم مسجل دخول بإضافة المعلومات
  const canAddInfo = !!currentUser;
  const [categoryInfo, setCategoryInfo] = useState<CategoryInformation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newInfo, setNewInfo] = useState({ content: '', orderIndex: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingInfo, setEditingInfo] = useState<CategoryInformation | null>(null);
  const [editFormData, setEditFormData] = useState({ content: '', orderIndex: 0 });
  
  useEffect(() => {
    if (categoryId) {
      fetchCategoryDetails();
    }
  }, [categoryId]);

  const fetchCategoryDetails = async () => {
    try {
      setLoading(true);
      
      // جلب تفاصيل التصنيف
      const categoryResponse = await fetch(getApiUrl(`categories/${categoryId}`));
      if (!categoryResponse.ok) {
        throw new Error('فشل في جلب تفاصيل التصنيف');
      }
      const categoryData = await categoryResponse.json();
      setCategory(categoryData);

      // جلب معلومات التصنيف
      const infoResponse = await fetch(getApiUrl(`categories/${categoryId}/information`));
      if (!infoResponse.ok) {
        throw new Error('فشل في جلب معلومات التصنيف');
      }
      const infoData = await infoResponse.json();
      setCategoryInfo(infoData.map(normalizeInfo).sort((a: CategoryInformation, b: CategoryInformation) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime()));
      
    } catch (error) {
      console.error('خطأ في جلب تفاصيل التصنيف:', error);
      setError('حدث خطأ في جلب تفاصيل التصنيف');
    } finally {
      setLoading(false);
    }
  };

  const handleAddInformation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInfo.content.trim()) {
      alert('يرجى إدخال المحتوى');
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await fetch(getApiUrl(`categories/${categoryId}/information`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: '', // عنوان فارغ
          content: newInfo.content,
          orderIndex: newInfo.orderIndex,
          createdBy: actorId
        }),
      });

      if (!response.ok) {
        throw new Error('فشل في إضافة المعلومة');
      }

      const addedInfo = await response.json();
      const normalizedAdded = normalizeInfo(addedInfo);
      const finalAdded = { ...normalizedAdded, CreatedBy: normalizedAdded.CreatedBy ?? actorId };
      setCategoryInfo(prev => [...prev, finalAdded].sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime()));
      setNewInfo({ content: '', orderIndex: 0 });
      setShowAddForm(false);
      alert('تم إضافة المعلومة بنجاح!');
    } catch (error) {
      console.error('خطأ في إضافة المعلومة:', error);
      alert('حدث خطأ في إضافة المعلومة');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditInformation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInfo || !editFormData.content.trim()) {
      alert('يرجى إدخال المحتوى');
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await fetch(getApiUrl(`categories/information/${editingInfo.InformationID}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: '', // عنوان فارغ
          content: editFormData.content,
          orderIndex: editFormData.orderIndex
        }),
      });

      if (!response.ok) {
        throw new Error('فشل في تحديث المعلومة');
      }

      const updatedInfo = await response.json();
      setCategoryInfo(prev => prev.map(info => 
        info.InformationID === editingInfo.InformationID ? normalizeInfo(updatedInfo) : info
      ).sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime()));
      
      setEditingInfo(null);
      setEditFormData({ content: '', orderIndex: 0 });
      alert('تم تحديث المعلومة بنجاح!');
    } catch (error) {
      console.error('خطأ في تحديث المعلومة:', error);
      alert('حدث خطأ في تحديث المعلومة');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteInformation = async (infoId: number) => {
    if (!window.confirm('هل أنت متأكد من حذف هذه المعلومة؟ لا يمكن التراجع عن هذا الإجراء.')) {
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await fetch(getApiUrl(`categories/information/${infoId}`), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createdBy: actorId }),
      });

      if (response.ok) {
        // إعادة تحميل معلومات التصنيف
        fetchCategoryDetails();
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'فشل في حذف المعلومة');
      }
    } catch (error) {
      console.error('Error deleting information:', error);
      setError('حدث خطأ أثناء حذف المعلومة');
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEditInfo = (info: CategoryInformation) => {
    setEditingInfo(info);
    setEditFormData({
      content: info.Content,
      orderIndex: info.OrderIndex
    });
  };

  const cancelEdit = () => {
    setEditingInfo(null);
    setEditFormData({ content: '', orderIndex: 0 });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="category-info-container">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>جاري تحميل معلومات التصنيف...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="category-info-container">
        <div className="error-message">
          <h3>خطأ</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!category) {
    return (
      <div className="category-info-container">
        <div className="error-message">
          <h3>التصنيف غير موجود</h3>
          <p>لم يتم العثور على التصنيف المطلوب</p>
        </div>
      </div>
    );
  }

  return (
    <div className="category-info-container">
      <div className="category-info-header">
        <h1>{category.Name}</h1>
        <p className="category-description">{category.Description}</p>
        <div className="category-meta">
          <span className="meta-item font-semibold">
            تم الإنشاء في: {formatDate(category.CreatedAt)}
            {category.UpdatedAt !== category.CreatedAt && (
              <span> • آخر تحديث: {formatDate(category.UpdatedAt)}</span>
            )}
          </span>
        </div>
      </div>

      <div className="category-info-content">
        <div className="info-header">
          <h2>معلومات التصنيف</h2>
          {canAddInfo && (
            <button 
              onClick={() => setShowAddForm(!showAddForm)}
              className="add-info-button"
            >
              {showAddForm ? 'إلغاء' : '+ إضافة معلومة'}
            </button>
          )}
        </div>

        {showAddForm && canAddInfo && (
          <div className="add-info-form">
            <form onSubmit={handleAddInformation}>
              <div className="form-group">
                <label htmlFor="content">المحتوى *</label>
                <textarea
                  id="content"
                  value={newInfo.content}
                  onChange={(e) => setNewInfo(prev => ({ ...prev, content: e.target.value }))}
                  placeholder="أدخل محتوى المعلومة"
                  rows={5}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="orderIndex">ترتيب العرض</label>
                <input
                  type="number"
                  id="orderIndex"
                  value={newInfo.orderIndex}
                  onChange={(e) => setNewInfo(prev => ({ ...prev, orderIndex: parseInt(e.target.value) || 0 }))}
                  placeholder="0"
                  min="0"
                />
              </div>
              <div className="form-actions">
                <button type="submit" disabled={isSubmitting} className="submit-button">
                  {isSubmitting ? 'جاري الإضافة...' : 'إضافة المعلومة'}
                </button>
                <button type="button" onClick={() => setShowAddForm(false)} className="cancel-button">
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        )}

        {editingInfo && (
          <div className="add-info-form">
            <h3>تعديل المعلومة</h3>
            <form onSubmit={handleEditInformation}>
              <div className="form-group">
                <label htmlFor="edit-content">المحتوى *</label>
                <textarea
                  id="edit-content"
                  value={editFormData.content}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, content: e.target.value }))}
                  placeholder="أدخل محتوى المعلومة"
                  rows={5}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="edit-orderIndex">ترتيب العرض</label>
                <input
                  type="number"
                  id="edit-orderIndex"
                  value={editFormData.orderIndex}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, orderIndex: parseInt(e.target.value) || 0 }))}
                  placeholder="0"
                  min="0"
                />
              </div>
              <div className="form-actions">
                <button type="submit" disabled={isSubmitting} className="submit-button">
                  {isSubmitting ? 'جاري التحديث...' : 'تحديث المعلومة'}
                </button>
                <button type="button" onClick={cancelEdit} className="cancel-button">
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        )}

        {categoryInfo.length > 0 ? (
          <div className="info-sections">
            <div className="info-section">
              <div className="info-header-with-actions">
                <h3>معلومات التصنيف</h3>
              </div>
              <div className="unified-info-content">
                {categoryInfo.map((info, index) => (
                  <div key={info.InformationID} className="info-item">
                    <div className="info-item-header">
                      <div className="info-actions">
                        {currentUser && (
                          <button
                            onClick={() => startEditInfo(info)}
                            className="edit-button"
                            title="تعديل المعلومة"
                          >
                            ✏️ تعديل
                          </button>
                        )}
                        {currentUser && infoCreatorId(info) === actorId && (
                          <button
                            onClick={() => handleDeleteInformation(info.InformationID)}
                            className="delete-button"
                            title="حذف المعلومة"
                          >
                            🗑️ حذف
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="info-content" dangerouslySetInnerHTML={{ __html: info.Content.replace(/\n/g, '<br>') }} />
                    <div className="info-meta info-meta-hover">
                      <small className="font-semibold">
                        {(info as any).CreatedByName && (
                          <span>أضافه: {(info as any).CreatedByName} • </span>
                        )}
                        تم الإنشاء في: {formatDate(info.CreatedAt)}
                        {info.UpdatedAt !== info.CreatedAt && (
                          <span> • آخر تحديث: {formatDate(info.UpdatedAt)}</span>
                        )}
                      </small>
                    </div>
                    {index < categoryInfo.length - 1 && <hr className="info-separator" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="no-info">
            <h3>لا توجد معلومات إضافية</h3>
            <p>لم يتم إضافة معلومات تفصيلية لهذا التصنيف بعد.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CategoryInfo;

// إضافة دالة لتوحيد هيكلة بيانات المعلومة القادمة من الخادم
const normalizeInfo = (serverInfo: any): CategoryInformation => ({
InformationID: serverInfo.InfoID ?? serverInfo.InformationID,
CategoryID: serverInfo.CategoryID,
Title: serverInfo.Title,
Content: serverInfo.Content,
OrderIndex: serverInfo.OrderIndex,
CreatedBy: serverInfo.CreatedBy,
CreatedAt: serverInfo.CreatedAt,
UpdatedAt: serverInfo.UpdatedAt,
IsActive: serverInfo.IsActive,
CreatedByName: serverInfo.CreatedByName,
});