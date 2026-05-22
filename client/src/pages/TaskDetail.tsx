// src/pages/TaskDetail.tsx
import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import UnifiedTimeline from '../components/UnifiedTimeline';
import { useNotification } from '../contexts/NotificationContext';
import type { CurrentUser, Subtask, User, Category, Task, Comment } from '../types';
import { Trash2, ExternalLink, Copy, Check } from 'lucide-react';
import { getApiUrl } from '../config/api';
import { getActiveUserId, getActiveAccount } from '../utils/activeAccount';
import { resolveCurrentActorId } from '../utils/actorIdentity';

type TaskDetailProps = { currentUser: CurrentUser; };

const TaskDetail = ({ currentUser }: TaskDetailProps) => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { markTaskAsViewed, refreshTasks, refreshNotifications } = useNotification();
  const [task, setTask] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [usersInDepartment, setUsersInDepartment] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [isUpdatingCategory, setIsUpdatingCategory] = useState(false);
  const [isEditingURL, setIsEditingURL] = useState(false);
  const [urlInput, setUrlInput] = useState<string>('');
  const [isUpdatingURL, setIsUpdatingURL] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionInput, setDescriptionInput] = useState<string>('');
  const [isUpdatingDescription, setIsUpdatingDescription] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState<string>('');
  const [isUpdatingTitle, setIsUpdatingTitle] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const actorId = getActiveUserId(resolveCurrentActorId(currentUser) || currentUser.UserID);
  // في وضع التفويض: actorId = معرّف المفوِّض؛ ActedBy يجب أن يحمل معرّف المفوَّض له
  const _tdAccount = getActiveAccount();
  // نُرسل VacancyID المفوَّض له إن وُجد، وإلا UserID — الخادم يحتاج لمطابقة التفويض
  const _tdDelegateUserId = _tdAccount?.mode === 'delegation'
    ? (resolveCurrentActorId(currentUser) || String(currentUser.UserID || '').trim())
    : null;

  const taskCreatorId = (t: Task | null) => String((t as any)?.CreatedByVacancyID ?? t?.CreatedBy ?? '');

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const fetchAllDetails = useCallback(async () => {
    if (!taskId) return;
    try {
      const actingUserId = actorId;
      const taskRes = await fetch(getApiUrl(`tasks/${taskId}?userId=${actingUserId}&isAdmin=${currentUser.IsAdmin}`));
      if (!taskRes.ok) {
        if (taskRes.status === 403) {
          throw new Error('ليس لديك صلاحية للوصول إلى هذه المهمة.');
        }
        throw new Error('Failed to fetch task details.');
      }
      const taskData: Task = await taskRes.json();
      setTask(taskData);
      setUrlInput((taskData as any).URL || '');
      
      // تسجيل المهمة كمشاهدة
      markTaskAsViewed(parseInt(taskId));
      
      // تحديث إشعارات التعليقات كمقروءة
      try {
        await fetch(getApiUrl(`comment-notifications/task/${taskId}/user/${actingUserId}/mark-read`), {
          method: 'PUT'
        });
        // تحديث قائمة المهام لإخفاء الإشعارات
        refreshTasks();
      } catch (error) {
        console.error('خطأ في تحديث إشعارات التعليقات:', error);
      }

      if (taskData) {
        const [subtasksRes, commentsRes, usersRes, categoriesRes] = await Promise.all([
          fetch(getApiUrl(`tasks/${taskId}/subtasks?userId=${actingUserId}&isAdmin=${currentUser.IsAdmin}`)),
          fetch(getApiUrl(`tasks/${taskId}/comments?userId=${actingUserId}&isAdmin=${currentUser.IsAdmin}`)),
          fetch(getApiUrl(`vacancies/department/${currentUser.DepartmentID || taskData.DepartmentID}/scope`)),
          fetch(getApiUrl(`categories/department/${taskData.DepartmentID}`))
        ]);
        
        // التحقق من صلاحية الوصول للمهام الفرعية
        if (subtasksRes.status === 403) {
          setError('ليس لديك صلاحية لعرض المهام الفرعية لهذه المهمة.');
          return;
        }
        
        // التحقق من صلاحية الوصول للتعليقات
        if (commentsRes.status === 403) {
          setError('ليس لديك صلاحية لعرض التعليقات لهذه المهمة.');
          return;
        }

        const subtasksData = await subtasksRes.json().catch(() => []);
        const commentsData = await commentsRes.json().catch(() => []);
        const usersData = usersRes.ok
          ? await usersRes.json().catch(() => [])
          : [];
        const categoriesData = categoriesRes.ok
          ? await categoriesRes.json().catch(() => [])
          : [];
        setSubtasks(Array.isArray(subtasksData) ? subtasksData : []);
        setComments(Array.isArray(commentsData) ? commentsData : []);
        setUsersInDepartment(Array.isArray(usersData) ? usersData : []);
        setCategories(Array.isArray(categoriesData) ? categoriesData : []);
      }
    } catch (err: any) { setError(err.message); } 
    finally { setIsLoading(false); }
  }, [taskId, actorId, currentUser.IsAdmin]);

  const handleUpdateTaskCategory = async (categoryId: number | null) => {
    if (!task || isUpdatingCategory) return;
    setIsUpdatingCategory(true);
    try {
      const actingUserId = actorId;
      const response = await fetch(getApiUrl(`tasks/${task.TaskID}/category`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          CategoryID: categoryId,
          userId: actingUserId,
          isAdmin: currentUser.IsAdmin
        })
      });
      
      if (response.ok) {
        await fetchAllDetails();
        setIsEditingCategory(false);
        setSelectedCategoryId(null);
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'فشل في تحديث التصنيف');
      }
    } catch (error) {
      console.error('Failed to update task category:', error);
      setError('حدث خطأ أثناء تحديث التصنيف');
    } finally {
      setIsUpdatingCategory(false);
    }
  };

  const handleUpdateTaskURL = async (newUrl: string | null, newDescription?: string | null) => {
    if (!task || isUpdatingURL) return;
    setIsUpdatingURL(true);
    try {
      const actingUserId = actorId;
      const response = await fetch(getApiUrl(`tasks/${task.TaskID}/url`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: newUrl,
          Description: typeof newDescription !== 'undefined' ? newDescription : undefined,
          userId: actingUserId,
          isAdmin: currentUser.IsAdmin
        })
      });
      if (response.ok) {
        await fetchAllDetails();
        setIsEditingURL(false);
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'فشل في تحديث الرابط');
      }
    } catch (error) {
      console.error('Failed to update task URL:', error);
      setError('حدث خطأ أثناء تحديث الرابط');
    } finally {
      setIsUpdatingURL(false);
    }
  };

  const handleUpdateTaskDescription = async (newDescription: string) => {
    if (!task || isUpdatingDescription) return;
    setIsUpdatingDescription(true);
    try {
      const actingUserId = actorId;
      const response = await fetch(getApiUrl(`tasks/${task.TaskID}/url`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: (task as any)?.URL || null,
          Description: newDescription,
          userId: actingUserId,
          isAdmin: currentUser.IsAdmin
        })
      });
      if (response.ok) {
        await fetchAllDetails();
        setIsEditingDescription(false);
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'فشل في تحديث الوصف');
      }
    } catch (error) {
      console.error('Failed to update task description:', error);
      setError('حدث خطأ أثناء تحديث الوصف');
    } finally {
      setIsUpdatingDescription(false);
    }
  };

  const handleUpdateTaskTitle = async (newTitle: string) => {
    if (!task || isUpdatingTitle) return;
    const trimmed = newTitle.trim();
    if (!trimmed) {
      setError('عنوان المهمة لا يمكن أن يكون فارغاً');
      return;
    }
    setIsUpdatingTitle(true);
    try {
      const actingUserId = actorId;
      const response = await fetch(getApiUrl(`tasks/${task.TaskID}/title`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          Title: trimmed,
          userId: actingUserId,
          isAdmin: currentUser.IsAdmin
        })
      });
      if (response.ok) {
        await fetchAllDetails();
        setIsEditingTitle(false);
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'فشل في تحديث عنوان المهمة');
      }
    } catch (error) {
      console.error('Failed to update task title:', error);
      setError('حدث خطأ أثناء تحديث عنوان المهمة');
    } finally {
      setIsUpdatingTitle(false);
    }
  };

  useEffect(() => { 
    fetchAllDetails();
    updateTaskView();
  }, [fetchAllDetails]);

  const updateTaskView = async () => {
    if (!taskId) return;
    try {
      const actingUserId = actorId;
      await fetch(getApiUrl(`tasks/${taskId}/view`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: actingUserId }),
      });
    } catch (error) {
      console.error('Error updating task view:', error);
    }
  };

  const handleCommentSubmit = async (commentData: string | { content: string; customDateTime: string | null; showInCalendar?: boolean }) => {
    setIsSubmittingComment(true);
    try {
        // التعامل مع البيانات القديمة (string) والجديدة (object)
        let content: string;
        let createdAt: string | null = null;
        let showInCalendar = false;
        
        if (typeof commentData === 'string') {
            content = commentData;
        } else {
            content = commentData.content;
            createdAt = commentData.customDateTime;
            if (typeof commentData.showInCalendar === 'boolean') {
              showInCalendar = commentData.showInCalendar;
            }
        }
        
        const requestBody: any = {
            TaskID: taskId,
            UserID: actorId,
            ActedBy: _tdDelegateUserId ?? actorId,
            Content: content,
            ShowInCalendar: showInCalendar
        };
        
        // إضافة التاريخ المخصص إذا تم تمريره
        if (createdAt) {
            requestBody.CreatedAt = createdAt;
        }
        
        const res = await fetch(getApiUrl('comments'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        if (!res.ok) {
          throw new Error('فشل إرسال التعليق');
        }
        // تحديث تفاصيل المهمة
        await fetchAllDetails();
        // تحديث الإشعارات والقائمة فورًا
        refreshNotifications();
        refreshTasks();
    } catch (error) { 
        console.error("Failed to submit comment", error);
        throw error;
    } finally { 
        setIsSubmittingComment(false); 
    }
  };

  const handleUpdateTaskStatus = async (newStatus: string) => {
    if (!task) return;
    try {
        await fetch(getApiUrl(`tasks/${task.TaskID}/status`), {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Status: newStatus })
        });
        fetchAllDetails();
    } catch (error) { console.error("Failed to update task status:", error); }
  };

  const handleDeleteTask = async () => {
    if (!taskId || isDeleting) return;
    setIsDeleting(true);
    try {
      const response = await fetch(getApiUrl(`tasks/${taskId}`), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: actorId,
          isAdmin: currentUser.IsAdmin
        })
      });
      
      if (response.ok) {
        navigate('/tasks');
      } else {
        const errorData = await response.json();
        setError(errorData.message || 'فشل في حذف المهمة');
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
      setError('حدث خطأ أثناء حذف المهمة');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (isLoading) return <p className="text-center p-8">جاري تحميل تفاصيل المهمة...</p>;
  if (error) return <p className="text-center p-8 text-red-500">حدث خطأ: {error}</p>;
  if (!task) return <p className="text-center p-8">لم يتم العثور على المهمة.</p>;

  const actingUserId = actorId;
  
  // التحقق من صلاحية التعديل (المنشئ، المدير، أو المسند إليهم)
  const canEditTaskDetails = true;
  const canDeleteTask = actingUserId === taskCreatorId(task);

  return (
    <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md max-w-4xl mx-auto">
      <div className="flex justify-between items-start">
        <div>
          {isEditingTitle ? (
            <input
              type="text"
              autoFocus
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  await handleUpdateTaskTitle(titleInput);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setIsEditingTitle(false);
                  setTitleInput(task.Title || '');
                }
              }}
              onBlur={() => {
                if (isUpdatingTitle) return;
                const current = (task.Title || '').trim();
                const next = titleInput.trim();
                if (next && next !== current) {
                  void handleUpdateTaskTitle(titleInput);
                } else {
                  setIsEditingTitle(false);
                  setTitleInput(task.Title || '');
                }
              }}
              className="text-4xl font-bold text-content mb-2 bg-transparent border-b border-primary focus:outline-none focus:border-primary/80"
            />
          ) : (
            <h1
              className="text-4xl font-bold text-content mb-2 cursor-text"
              onClick={() => {
                setIsEditingTitle(true);
                setTitleInput(task.Title || '');
              }}
              title="انقر لتعديل عنوان المهمة (Enter للحفظ، Esc للإلغاء)"
            >
              {task.Title}
            </h1>
          )}
          <div className="flex flex-wrap items-center gap-4 text-content-secondary mb-6">
            <span>
              المنشيء: {task.CreatedByName || task.CreatedBy}
              {task.ActedBy ? ` بواسطة (${task.ActedByName || task.ActedBy})` : ''}
            </span>
            <span className="text-sm">•</span>
            <span><strong>الحالة:</strong> <span className="font-semibold">{task.Status}</span></span>
            <span className="text-sm">•</span>
            <span><strong>الأولوية:</strong> {task.Priority}</span>
            <span className="text-sm">•</span>
            <span><strong>تاريخ الاستحقاق:</strong> {task.DueDate ? new Date(task.DueDate).toLocaleDateString('ar-EG') : 'غير محدد'}</span>
          </div>
          
          {/* Category Section */}
          <div className="flex flex-wrap items-center gap-4 text-content-secondary mb-2">
            <span><strong>التصنيف:</strong></span>
            {isEditingCategory ? (
              <div className="flex items-center gap-2">
                <select
                  value={selectedCategoryId || ''}
                  onChange={(e) => setSelectedCategoryId(e.target.value ? parseInt(e.target.value) : null)}
                  className="p-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-content text-sm"
                >
                  <option value="">بدون تصنيف</option>
                  {categories.map((category) => (
                    <option key={category.CategoryID} value={category.CategoryID}>
                      {category.Name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => handleUpdateTaskCategory(selectedCategoryId)}
                  disabled={isUpdatingCategory}
                  className="px-2 py-1 bg-primary text-white rounded-md hover:bg-primary/90 disabled:bg-gray-400 text-sm"
                >
                  {isUpdatingCategory ? 'جاري الحفظ...' : 'حفظ'}
                </button>
                <button
                  onClick={() => {
                    setIsEditingCategory(false);
                    setSelectedCategoryId(task.CategoryID || null);
                  }}
                  className="px-2 py-1 bg-gray-500 text-white rounded-md hover:bg-gray-600 text-sm"
                >
                  إلغاء
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {task.CategoryName ? (
                  <>
                    <span className="text-content font-medium">{task.CategoryName}</span>
                    <Link
                      to={`/categories/${task.CategoryID}`}
                      className="text-primary hover:underline flex items-center gap-1 text-sm"
                    >
                      <ExternalLink size={14} />
                      عرض معلومات التصنيف
                    </Link>
                    {canEditTaskDetails && (
                      <button
                        onClick={() => {
                          setIsEditingCategory(true);
                          setSelectedCategoryId(task.CategoryID || null);
                        }}
                        className="text-sm text-primary hover:underline"
                      >
                        تعديل
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-content-secondary italic">بدون تصنيف</span>
                    {canEditTaskDetails && (
                      <button
                        onClick={() => {
                          setIsEditingCategory(true);
                          setSelectedCategoryId(null);
                        }}
                        className="text-sm text-primary hover:underline"
                      >
                        إضافة تصنيف
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Task External URL Section */}
          <div className="flex flex-wrap items-center gap-4 text-content-secondary mb-2">
            <span><strong>الرابط الخارجي:</strong></span>
            {isEditingURL ? (
              <div className="flex items-center gap-2 w-full max-w-xl">
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://example.com/path"
                  className="flex-1 p-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-content text-sm"
                />
                <button
                  onClick={() => handleUpdateTaskURL(urlInput.trim() ? urlInput.trim() : null)}
                  disabled={isUpdatingURL}
                  className="px-2 py-1 bg-primary text-white rounded-md hover:bg-primary/90 disabled:bg-gray-400 text-sm"
                >
                  {isUpdatingURL ? 'جاري الحفظ...' : 'حفظ'}
                </button>
                <button
                  onClick={() => { setIsEditingURL(false); setUrlInput((task as any)?.URL || ''); }}
                  className="px-2 py-1 bg-gray-500 text-white rounded-md hover:bg-gray-600 text-sm"
                >
                  إلغاء
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {(task as any)?.URL ? (
                  <div className="flex items-center gap-2">
                    <a
                      href={(task as any).URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline flex items-center gap-1 text-sm"
                    >
                      <ExternalLink size={14} />
                      فتح الرابط
                    </a>
                    <button
                      onClick={() => copyToClipboard((task as any).URL)}
                      className="text-primary hover:underline flex items-center gap-1 text-sm"
                      title={isCopied ? "تم النسخ" : "نسخ الرابط"}
                    >
                      {isCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                      <span>{isCopied ? "تم النسخ" : "نسخ الرابط"}</span>
                    </button>
                  </div>
                ) : (
                  <span className="text-content-secondary italic">لا يوجد رابط</span>
                )}
                {canEditTaskDetails && (
                  <button
                    onClick={() => { setIsEditingURL(true); setUrlInput((task as any)?.URL || ''); }}
                    className="text-sm text-primary hover:underline"
                  >
                    {(task as any)?.URL ? 'تعديل' : 'إضافة رابط'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-content mb-2">وصف المهمة</h3>
        {isEditingDescription ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              value={descriptionInput}
              onChange={(e) => setDescriptionInput(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  await handleUpdateTaskDescription(descriptionInput);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setIsEditingDescription(false);
                  setDescriptionInput(task.Description || '');
                }
              }}
              className="w-full min-h-[120px] p-3 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-content text-sm whitespace-pre-wrap"
            />
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => handleUpdateTaskDescription(descriptionInput)}
                disabled={isUpdatingDescription}
                className="px-3 py-1 bg-primary text-white rounded-md hover:bg-primary/90 disabled:bg-gray-400 text-sm"
              >
                {isUpdatingDescription ? 'جاري الحفظ...' : 'حفظ الوصف'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditingDescription(false);
                  setDescriptionInput(task.Description || '');
                }}
                className="px-3 py-1 bg-gray-500 text-white rounded-md hover:bg-gray-600 text-sm"
              >
                إلغاء
              </button>
            </div>
          </div>
        ) : (
          <div
            className="prose dark:prose-invert max-w-none bg-content/5 rounded-md p-3 cursor-text hover:bg-content/10"
            onClick={() => {
              setIsEditingDescription(true);
              setDescriptionInput(task.Description || '');
            }}
            title="انقر لتعديل الوصف"
          >
            <p className="whitespace-pre-wrap break-words">
              {task.Description && task.Description.trim().length > 0
                ? task.Description
                : 'لا يوجد وصف لهذه المهمة.'}
            </p>
          </div>
        )}
      </div>

      <div className="mt-6 p-4 bg-content/5 rounded-md flex items-center justify-between flex-wrap gap-2">
          <p className="font-semibold text-content">إجراءات المهمة الرئيسية:</p>
          <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => handleUpdateTaskStatus('completed')}
                disabled={task.Status === 'completed'}
                className="text-sm bg-green-500 text-white px-3 py-1 rounded disabled:bg-gray-400"
              >
                إغلاق كمكتملة
              </button>
              <button
                onClick={() => handleUpdateTaskStatus('cancelled')}
                disabled={task.Status === 'cancelled'}
                className="text-sm bg-red-500 text-white px-3 py-1 rounded disabled:bg-gray-400"
              >
                إلغاء المهمة
              </button>
              {(task.Status === 'completed' || task.Status === 'cancelled') && (
                <button
                  onClick={() => handleUpdateTaskStatus('open')}
                  className="text-sm bg-gray-500 text-white px-3 py-1 rounded"
                >
                  إعادة الفتح
                </button>
              )}
              {canDeleteTask && (
                <button 
                  onClick={() => setShowDeleteConfirm(true)} 
                  className="text-sm bg-red-700 text-white px-3 py-1 rounded hover:bg-red-800 transition-colors flex items-center gap-1"
                >
                  <Trash2 size={14} />
                  حذف نهائياً
                </button>
              )}
          </div>
      </div>
      

      <hr className="my-8 border-content/10" />

      <UnifiedTimeline 
        taskId={taskId!}
        subtasks={subtasks}
        comments={comments}
        users={usersInDepartment}
        currentUser={currentUser}
        task={task}
        onSubtaskUpdate={fetchAllDetails}
        onCommentSubmit={handleCommentSubmit}
        isSubmittingComment={isSubmittingComment}
        onCommentsUpdate={fetchAllDetails}
      />
      
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-red-600 dark:text-red-400 mb-4">تأكيد الحذف</h2>
            <p className="text-content mb-6">
              هل أنت متأكد من حذف المهمة "{task.Title}" نهائياً؟
              <br />
              <span className="text-red-600 dark:text-red-400 font-semibold">
                سيتم حذف جميع المهام الفرعية والتعليقات المرتبطة بها ولا يمكن التراجع عن هذا الإجراء.
              </span>
            </p>
            <div className="flex gap-3 justify-end">
              <button 
                onClick={() => setShowDeleteConfirm(false)} 
                className="px-4 py-2 text-content bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                إلغاء
              </button>
              <button 
                onClick={handleDeleteTask} 
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-red-400 transition-colors flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    جاري الحذف...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    حذف نهائياً
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default TaskDetail;

