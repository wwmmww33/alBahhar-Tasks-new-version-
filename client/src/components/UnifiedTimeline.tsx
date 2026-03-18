// src/components/UnifiedTimeline.tsx
import { Check, Square, Trash2, UserPlus, Calendar, Clock, MessageCircle, CheckSquare, Users } from 'lucide-react';
import React, { useState, useMemo } from 'react';
import type { Subtask, User, CurrentUser } from '../types';
import { useNotification } from '../contexts/NotificationContext';
import { getActiveUserId } from '../utils/activeAccount';
import { resolveCurrentActorId, resolveUserActorId } from '../utils/actorIdentity';

type Comment = {
  CommentID: number;
  Content: string;
  UserID: string;
  CommentedByVacancyID?: number | string | null;
  UserName?: string;
  CreatedAt: string;
  ActedBy?: string;
  ActedByName?: string;
  ShowInCalendar?: boolean;
};

type TimelineItem = {
  id: string;
  type: 'subtask' | 'comment';
  createdAt: string;
  data: Subtask | Comment;
};

type UnifiedTimelineProps = {
  taskId: string;
  subtasks: Subtask[];
  comments: Comment[];
  users: User[];
  currentUser: CurrentUser;
  task: any;
  onSubtaskUpdate: () => void;
  onCommentSubmit: (commentData: string | { content: string; customDateTime: string | null; showInCalendar?: boolean }) => Promise<void>;
  isSubmittingComment: boolean;
  onCommentsUpdate: () => void;
};

const UnifiedTimeline = ({
  taskId,
  subtasks,
  comments,
  users,
  currentUser,
  task,
  onSubtaskUpdate,
  onCommentSubmit,
  isSubmittingComment,
  onCommentsUpdate
}: UnifiedTimelineProps) => {
  const { refreshTasks, refreshNotifications } = useNotification();
  const safeUsers = Array.isArray(users) ? users : [];
  const renderWithLinks = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
    const elements: (string | JSX.Element)[] = [];
    let lastIndex = 0;
    text.replace(urlRegex, (match, _p1, offset) => {
      if (offset > lastIndex) {
        elements.push(text.slice(lastIndex, offset));
      }
      const href = match.startsWith('http') ? match : `http://${match}`;
      elements.push(
        <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">
          {match}
        </a>
      );
      lastIndex = offset + match.length;
      return match;
    });
    if (lastIndex < text.length) {
      elements.push(text.slice(lastIndex));
    }
    return elements;
  };
  const getUserNameById = (id?: string) => {
    if (!id) return '';
    return safeUsers.find(u => resolveUserActorId(u) === id || u.UserID === id)?.FullName || id;
  };
  const getTodayString = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const getCurrentDateTime = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };
  
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [newSubtaskDueDate, setNewSubtaskDueDate] = useState(getTodayString());
  const [assignTo, setAssignTo] = useState('');
  const [showInCalendar, setShowInCalendar] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [useCustomDateTime, setUseCustomDateTime] = useState(false);
  const [customDateTime, setCustomDateTime] = useState(getCurrentDateTime());
  const [showCommentInCalendar, setShowCommentInCalendar] = useState(false);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [showCommentForm, setShowCommentForm] = useState(false);

  // حالات التحرير داخل عناصر الجدول الزمني
  const [editingTitleSubtaskId, setEditingTitleSubtaskId] = useState<number | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const [editingDueSubtaskId, setEditingDueSubtaskId] = useState<number | null>(null);
  const [editingDueValue, setEditingDueValue] = useState<string>('');
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentValue, setEditingCommentValue] = useState('');

  // Bulk Assign State
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [selectedSubtaskForBulk, setSelectedSubtaskForBulk] = useState<Subtask | null>(null);
  const [bulkSelectedUsers, setBulkSelectedUsers] = useState<string[]>([]);

  // New Task Bulk State
  const [isNewTaskBulkModalOpen, setIsNewTaskBulkModalOpen] = useState(false);
  const [newSubtaskBulkUsers, setNewSubtaskBulkUsers] = useState<string[]>([]);

  const actingUserId = getActiveUserId(resolveCurrentActorId(currentUser) || currentUser.UserID);
  const taskCreatorId = String(task?.CreatedByVacancyID ?? task?.CreatedBy ?? '');
  const userActorId = (user: User) => String(resolveUserActorId(user) || user.UserID);
  const subtaskAssignedId = (subtask: Subtask) => String(subtask.AssignedToVacancyID ?? subtask.AssignedTo ?? '');

  const actorIdCandidates = useMemo(() => {
    const ids = new Set<string>();
    const add = (value: unknown) => {
      const normalized = String(value ?? '').trim();
      if (normalized) ids.add(normalized);
    };
    add(actingUserId);
    add(currentUser.UserID);
    add(resolveCurrentActorId(currentUser));
    add((currentUser as any).CurrentVacancyID);
    add((currentUser as any).ActiveVacancyID);
    add((currentUser as any).VacancyID);

    const currentUserFromDepartment = safeUsers.find(
      user => String(user.UserID ?? '').trim() === String(currentUser.UserID ?? '').trim()
    );
    if (currentUserFromDepartment) {
      add(currentUserFromDepartment.UserID);
      add(resolveUserActorId(currentUserFromDepartment));
      add((currentUserFromDepartment as any).CurrentVacancyID);
      add((currentUserFromDepartment as any).ActiveVacancyID);
      add((currentUserFromDepartment as any).VacancyID);
    }

    return ids;
  }, [actingUserId, currentUser, safeUsers]);

  const isActorMatch = (value: unknown) => {
    const normalized = String(value ?? '').trim();
    return !!normalized && actorIdCandidates.has(normalized);
  };

  const isSubtaskAssignedToActor = (subtask: Subtask) => {
    return isActorMatch(subtask.AssignedToVacancyID) || isActorMatch(subtask.AssignedTo);
  };

  const isSubtaskCreatorActor = (subtask: Subtask) => {
    return isActorMatch(subtask.CreatedByVacancyID) || isActorMatch(subtask.CreatedBy);
  };

  const canAddSubtasks = Boolean(task);

  // دمج المهام الفرعية والتعليقات وترتيبها حسب التاريخ
  const timelineItems: TimelineItem[] = useMemo(() => {
    const items: TimelineItem[] = [];

    // إضافة المهام الفرعية
    subtasks.forEach(subtask => {
      items.push({
        id: `subtask-${subtask.SubtaskID}`,
        type: 'subtask',
        createdAt: subtask.CreatedAt,
        data: subtask
      });
    });

    // إضافة التعليقات
    comments.forEach(comment => {
      items.push({
        id: `comment-${comment.CommentID}`,
        type: 'comment',
        createdAt: comment.CreatedAt,
        data: comment
      });
    });

    // ترتيب العناصر حسب التاريخ (الأحدث أولاً)
    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [subtasks, comments]);

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtaskTitle.trim()) return;

    if (assignTo === 'bulk') {
        if (newSubtaskBulkUsers.length === 0) {
            alert("الرجاء اختيار مستخدم واحد على الأقل");
            return;
        }
        for (const userId of newSubtaskBulkUsers) {
             await fetch('/api/subtasks', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                TaskID: taskId, Title: newSubtaskTitle, CreatedBy: actingUserId, ActedBy: actingUserId,
                DueDate: newSubtaskDueDate || null, AssignedTo: userId,
                ShowInCalendar: showInCalendar
              }),
            });
        }
        window.dispatchEvent(new CustomEvent('calendar:subtask:created', { detail: { ShowInCalendar: showInCalendar, DueDate: newSubtaskDueDate } }));
        
        setNewSubtaskTitle(''); setNewSubtaskDueDate(getTodayString()); setAssignTo(''); setShowInCalendar(false);
        setNewSubtaskBulkUsers([]);
        onSubtaskUpdate();
        refreshTasks();
        refreshNotifications();
        return;
    }

    const resp = await fetch('/api/subtasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TaskID: taskId,
        Title: newSubtaskTitle,
        CreatedBy: actingUserId,
        ActedBy: actingUserId,
        DueDate: newSubtaskDueDate || null,
        AssignedTo: assignTo || actingUserId,
        ShowInCalendar: showInCalendar
      }),
    });
    setNewSubtaskTitle('');
    setNewSubtaskDueDate(getTodayString());
    setAssignTo('');
    setShowInCalendar(false);
    onSubtaskUpdate();
    if (resp.ok) {
      window.dispatchEvent(new CustomEvent('calendar:subtask:created', { detail: { ShowInCalendar: showInCalendar, DueDate: newSubtaskDueDate } }));
    }
    // تحديث قائمة المهام وربما الإشعارات فورًا
    refreshTasks();
    refreshNotifications();
  };

  const handleToggleStatus = async (subtask: Subtask) => {
    if (!isSubtaskAssignedToActor(subtask)) {
      alert('فقط الشخص المسندت له المهمة الفرعية يمكنه تغيير حالة الإكمال.');
      return;
    }

    try {
      const resp = await fetch(`/api/subtasks/${subtask.SubtaskID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCompleted: !subtask.IsCompleted, UserID: actingUserId, isAdmin: currentUser.IsAdmin }),
      });

      if (!resp.ok) {
        if (resp.status === 403) {
          alert('ليس لديك الصلاحية لتغيير حالة هذه المهمة.');
          return;
        }
        const text = await resp.text().catch(() => '');
        alert(`فشل تحديث حالة المهمة الفرعية (${resp.status}). ${text}`);
        return;
      }

      onSubtaskUpdate();
      refreshTasks();
    } catch (error) {
      console.error('Failed to toggle subtask status:', error);
      alert('تعذر الاتصال بالخادم أثناء تحديث حالة المهمة الفرعية.');
    }
  };

  const handleAssign = async (subtask: Subtask, assignedTo: string) => {
    if (!isSubtaskCreatorActor(subtask)) {
      alert('فقط منشئ المهمة الفرعية يمكنه تغيير الإسناد.');
      return;
    }

    if (assignedTo === 'bulk') {
        setSelectedSubtaskForBulk(subtask);
        setBulkSelectedUsers(subtaskAssignedId(subtask) ? [subtaskAssignedId(subtask)] : []);
        setIsBulkModalOpen(true);
        return;
    }

    await fetch(`/api/subtasks/${subtask.SubtaskID}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedToUserId: assignedTo || null, assignedByUserId: actingUserId, UserID: actingUserId, isAdmin: currentUser.IsAdmin }),
    });
    onSubtaskUpdate();
    refreshTasks();
    refreshNotifications();
  };

  const submitBulkAssign = async () => {
      if (!selectedSubtaskForBulk) return;
      if (!isSubtaskCreatorActor(selectedSubtaskForBulk)) {
        alert('فقط منشئ المهمة الفرعية يمكنه تغيير الإسناد.');
        return;
      }
      if (bulkSelectedUsers.length === 0) {
          alert("الرجاء اختيار مستخدم واحد على الأقل");
          return;
      }
      
      try {
        const resp = await fetch(`/api/subtasks/${selectedSubtaskForBulk.SubtaskID}/bulk-assign`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignedToUserIds: bulkSelectedUsers, assignedByUserId: actingUserId, UserID: actingUserId, isAdmin: currentUser.IsAdmin }),
        });
        
        if (resp.ok) {
            onSubtaskUpdate();
            refreshTasks();
            refreshNotifications();
            setIsBulkModalOpen(false);
            setSelectedSubtaskForBulk(null);
            setBulkSelectedUsers([]);
        } else {
            alert("حدث خطأ أثناء الإسناد المتعدد");
        }
      } catch (e) {
          console.error(e);
          alert("حدث خطأ في الاتصال");
      }
  };

  const toggleUserSelection = (userId: string) => {
      setBulkSelectedUsers(prev => 
        prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
      );
  };

  // حفظ تفاصيل المهمة الفرعية (العنوان / تاريخ الاستحقاق)
  const saveSubtaskDetails = async (subtaskId: number, payload: Partial<Pick<Subtask, 'Title' | 'DueDate'>>) => {
    try {
      const resp = await fetch(`/api/subtasks/${subtaskId}/details`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, UserID: actingUserId, isAdmin: currentUser.IsAdmin }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        alert(`فشل حفظ التغييرات (${resp.status}). ${text}`);
        return false;
      }
      onSubtaskUpdate();
      refreshTasks();
      return true;
    } catch (err) {
      console.error('Network error while saving subtask details:', err);
      alert('تعذر الاتصال بالخادم أثناء الحفظ. تأكد من تشغيل الخادم وأن البروكسي مفعل.');
      return false;
    }
  };

  // تبديل إظهار المهمة الفرعية الحالية في التقويم
  const handleToggleCalendar = async (subtask: Subtask, nextShow: boolean) => {
    try {
      const url = `/api/subtasks/${subtask.SubtaskID}/calendar`;
      const resp = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ShowInCalendar: nextShow, UserID: actingUserId, isAdmin: currentUser.IsAdmin })
      });
      if (resp.ok) {
        window.dispatchEvent(new CustomEvent('calendar:subtask:created'));
        onSubtaskUpdate();
        refreshTasks();
        refreshNotifications();
      } else {
        const text = await resp.text().catch(() => '');
        if (resp.status === 404) {
          alert('لم يتم العثور على المهمة الفرعية (404). قد تكون محذوفة أو رقم المعرف غير صحيح.');
        } else {
          alert(`فشل تحديث التبديل في التقويم (${resp.status}). ${text}`);
        }
      }
    } catch (err) {
      console.error('Network error while toggling calendar flag:', err);
      alert('تعذر الاتصال بالخادم. تأكد من أن الخادم يعمل على المنفذ 5001 وأن البروكسي مفعل.');
    }
  };

  const handleDeleteSubtask = async (subtask: Subtask) => {
    if (!window.confirm('هل أنت متأكد من حذف هذه المهمة الفرعية؟')) return;
    try {
      const resp = await fetch(`/api/subtasks/${subtask.SubtaskID}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ UserID: actingUserId, isAdmin: currentUser.IsAdmin })
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        alert(`فشل حذف المهمة الفرعية (${resp.status}). ${text}`);
        return;
      }

      onSubtaskUpdate();
      refreshTasks();
      refreshNotifications();
    } catch (err) {
      console.error('Network error while deleting subtask:', err);
      alert('تعذر الاتصال بالخادم أثناء حذف المهمة الفرعية. تأكد من تشغيل الخادم.');
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || isSubmittingComment) return;
    
    if (useCustomDateTime) {
      const selectedDate = new Date(customDateTime);
      if (isNaN(selectedDate.getTime())) {
        alert('يرجى إدخال تاريخ ووقت صحيح');
        return;
      }
    }
    
    // تمرير التاريخ المخصص إذا تم تفعيله
    const commentData = {
      content: newComment,
      customDateTime: useCustomDateTime ? customDateTime : null,
      showInCalendar: showCommentInCalendar
    };
    
    await onCommentSubmit(commentData);
    setNewComment('');
    // إعادة تعيين التاريخ المخصص للوقت الحالي
    setCustomDateTime(getCurrentDateTime());
    setShowCommentInCalendar(false);
  };

  const saveComment = async (commentId: number, content: string) => {
    try {
      const resp = await fetch(`/api/comments/${commentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Content: content,
          UserID: actingUserId,
          isAdmin: currentUser.IsAdmin,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        alert(`فشل حفظ التعديل على التعليق (${resp.status}). ${text}`);
        return false;
      }
      onCommentsUpdate();
      refreshNotifications();
      return true;
    } catch (err) {
      console.error('Network error while saving comment:', err);
      alert('تعذر الاتصال بالخادم أثناء حفظ التعليق. تأكد من تشغيل الخادم.');
      return false;
    }
  };

  const handleDeleteComment = async (comment: Comment) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا التعليق؟')) return;
    try {
      const resp = await fetch(`/api/comments/${comment.CommentID}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ UserID: actingUserId, isAdmin: currentUser.IsAdmin }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        alert(`فشل حذف التعليق (${resp.status}). ${text}`);
        return;
      }
      onCommentsUpdate();
      refreshNotifications();
    } catch (err) {
      console.error('Network error while deleting comment:', err);
      alert('تعذر الاتصال بالخادم أثناء حذف التعليق. تأكد من تشغيل الخادم.');
    }
  };

  const renderSubtaskItem = (subtask: Subtask) => {
    const canDelete = true;
    const canEditTitle = true;
    const canEditDue = true;
    const canToggleStatus = isSubtaskAssignedToActor(subtask);
    const canManageAssignments = isSubtaskCreatorActor(subtask);
    const assignedId = subtaskAssignedId(subtask);
    const assignedInUsersList = !!safeUsers.find(user => userActorId(user) === assignedId);
    const assignedFallbackLabel = subtask.AssignedToName || (assignedId ? `منصب #${assignedId}` : '');

    return (
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mt-1">
          <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-grow">
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-3 mb-2">
              <div
                onClick={() => {
                  if (!canToggleStatus) return;
                  handleToggleStatus(subtask);
                }}
                className={canToggleStatus ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}
                title={canToggleStatus ? 'تغيير حالة الإكمال' : 'فقط الشخص المسندت له المهمة يمكنه تغيير الحالة'}
              >
                {subtask.IsCompleted ? (
                  <Check className="text-green-500 w-5 h-5" />
                ) : (
                  <Square className="text-content-secondary w-5 h-5" />
                )}
              </div>
              {editingTitleSubtaskId === subtask.SubtaskID ? (
                <input
                  type="text"
                  autoFocus
                  value={editingTitleValue}
                  onChange={(e) => setEditingTitleValue(e.target.value)}
                  onBlur={async () => {
                    const trimmed = editingTitleValue.trim();
                    if (trimmed && trimmed !== subtask.Title) {
                      await saveSubtaskDetails(subtask.SubtaskID, { Title: trimmed });
                    }
                    setEditingTitleSubtaskId(null);
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const trimmed = editingTitleValue.trim();
                      if (trimmed && trimmed !== subtask.Title) {
                        await saveSubtaskDetails(subtask.SubtaskID, { Title: trimmed });
                      }
                      setEditingTitleSubtaskId(null);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setEditingTitleSubtaskId(null);
                    }
                  }}
                  className={`font-medium w-full bg-bkg border border-content/20 rounded px-2 py-1 ${subtask.IsCompleted ? 'line-through text-gray-500 dark:text-gray-400' : 'text-content'}`}
                />
              ) : (
                <span
                  className={`font-medium ${subtask.IsCompleted ? 'line-through text-gray-500 dark:text-gray-400' : 'text-content'} ${canEditTitle ? 'cursor-text' : ''}`}
                  onClick={() => {
                    if (!canEditTitle) return;
                    setEditingTitleSubtaskId(subtask.SubtaskID);
                    setEditingTitleValue(subtask.Title || '');
                  }}
                  onDoubleClick={() => {
                    if (!canEditTitle) return;
                    setEditingTitleSubtaskId(subtask.SubtaskID);
                    setEditingTitleValue(subtask.Title || '');
                  }}
                  title={canEditTitle ? 'انقر للتحرير' : undefined}
                >
                  {subtask.Title}
                </span>
              )}
              <span className="text-xs text-content-secondary font-mono ml-2">#{subtask.SubtaskID}</span>
              {canDelete && (
                <button
                  onClick={() => handleDeleteSubtask(subtask)}
                  className="text-red-500 hover:text-red-700 ml-auto"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            
            <div className="flex flex-wrap gap-4 text-xs text-content-secondary">
              <div className="flex items-center gap-2">
                <UserPlus size={14} />
                <select
                  value={assignedId}
                  onChange={(e) => handleAssign(subtask, e.target.value)}
                  disabled={!canManageAssignments}
                  className="bg-transparent text-xs focus:outline-none disabled:opacity-70 dark:text-gray-300 max-w-[120px]"
                >
                  <option value="">غير مسندة</option>
                  <option value="bulk" className="font-bold text-primary">👥 إسناد متعدد...</option>
                  {assignedId && !assignedInUsersList && (
                    <option value={assignedId}>{assignedFallbackLabel}</option>
                  )}
                  {safeUsers.map(user => (
                    <option key={userActorId(user)} value={userActorId(user)}>{user.FullName}</option>
                  ))}
                </select>
                {canManageAssignments && (
                  <button
                    onClick={() => {
                      setSelectedSubtaskForBulk(subtask);
                      setBulkSelectedUsers(subtaskAssignedId(subtask) ? [subtaskAssignedId(subtask)] : []);
                      setIsBulkModalOpen(true);
                    }}
                    className="p-1 hover:bg-primary/10 rounded-full text-primary transition-colors"
                    title="إسناد متعدد / تكرار المهمة"
                  >
                    <Users size={14} />
                  </button>
                )}
              </div>
              
              {(subtask.CreatedByName || subtask.CreatedBy) && (
                <div className="flex items-center gap-1">
                  <span>
                    المنشيء: {subtask.CreatedByName || subtask.CreatedBy}
                    {subtask.ActedBy ? ` بواسطة (${subtask.ActedByName || getUserNameById(subtask.ActedBy)})` : ''}
                  </span>
                </div>
              )}
              
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <Calendar size={14} />
                  {editingDueSubtaskId === subtask.SubtaskID ? (
                    <input
                      type="date"
                      autoFocus
                      value={editingDueValue}
                      onChange={(e) => setEditingDueValue(e.target.value)}
                      onBlur={async () => {
                        const next = editingDueValue || '';
                        const original = subtask.DueDate ? new Date(subtask.DueDate).toISOString().slice(0, 10) : '';
                        if (next !== original) {
                          await saveSubtaskDetails(subtask.SubtaskID, { DueDate: next || null as any });
                        }
                        setEditingDueSubtaskId(null);
                      }}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const next = editingDueValue || '';
                          const original = subtask.DueDate ? new Date(subtask.DueDate).toISOString().slice(0, 10) : '';
                          if (next !== original) {
                            await saveSubtaskDetails(subtask.SubtaskID, { DueDate: next || null as any });
                          }
                          setEditingDueSubtaskId(null);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditingDueSubtaskId(null);
                        }
                      }}
                      className="text-xs bg-bkg border border-content/20 rounded px-2 py-1 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                    />
                  ) : (
                    <span
                      className="cursor-text"
                      onClick={() => {
                        if (!canEditDue) return;
                        setEditingDueSubtaskId(subtask.SubtaskID);
                        const original = subtask.DueDate ? new Date(subtask.DueDate).toISOString().slice(0, 10) : getTodayString();
                        setEditingDueValue(original);
                      }}
                      onDoubleClick={() => {
                        if (!canEditDue) return;
                        setEditingDueSubtaskId(subtask.SubtaskID);
                        const original = subtask.DueDate ? new Date(subtask.DueDate).toISOString().slice(0, 10) : getTodayString();
                        setEditingDueValue(original);
                      }}
                      title={canEditDue ? 'انقر لتعديل تاريخ الاستحقاق' : undefined}
                    >
                      الاستحقاق: {subtask.DueDate ? new Date(subtask.DueDate).toLocaleDateString('ar-EG') : '—'}
                    </span>
                  )}
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!(subtask as any).ShowInCalendar}
                    onChange={(e) => handleToggleCalendar(subtask, e.target.checked)}
                  />
                  <span>إظهار في التقويم</span>
                </label>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 mt-2 text-xs text-content-secondary">
            <Clock size={12} />
            <span>
              تم الإنشاء: {new Date(subtask.CreatedAt).toLocaleString('ar-EG', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Muscat'
              })}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const renderCommentItem = (comment: Comment) => {
    const canManage = true;
    const isEditing = editingCommentId === comment.CommentID;
    const handleToggleCommentCalendar = async (next: boolean) => {
      try {
        const resp = await fetch(`/api/comments/${comment.CommentID}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            UserID: actingUserId,
            ShowInCalendar: next,
            isAdmin: currentUser.IsAdmin,
          }),
        });
        if (resp.ok) {
          onCommentsUpdate();
          window.dispatchEvent(new CustomEvent('calendar:comment:updated', { detail: { CommentID: comment.CommentID, ShowInCalendar: next } }));
        } else {
          const text = await resp.text().catch(() => '');
          alert(`فشل تحديث إظهار التعليق في التقويم (${resp.status}). ${text}`);
        }
      } catch (err) {
        console.error('Network error while toggling comment calendar flag:', err);
        alert('تعذر الاتصال بالخادم أثناء تحديث إظهار التعليق في التقويم.');
      }
    };

    return (
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mt-1">
          <MessageCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-grow">
          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
            {isEditing ? (
              <textarea
                autoFocus
                value={editingCommentValue}
                onChange={(e) => setEditingCommentValue(e.target.value)}
                onBlur={async () => {
                  const trimmed = editingCommentValue.trim();
                  if (trimmed && trimmed !== comment.Content) {
                    await saveComment(comment.CommentID, trimmed);
                  }
                  setEditingCommentId(null);
                }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const trimmed = editingCommentValue.trim();
                    if (trimmed && trimmed !== comment.Content) {
                      await saveComment(comment.CommentID, trimmed);
                    }
                    setEditingCommentId(null);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingCommentId(null);
                  }
                }}
                className="w-full p-2 border border-content/20 rounded bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm mb-2"
                rows={3}
              />
            ) : (
              <p
                className={`text-content mb-2 break-words whitespace-pre-wrap ${canManage ? 'cursor-text' : ''}`}
                onClick={() => {
                  if (!canManage) return;
                  setEditingCommentId(comment.CommentID);
                  setEditingCommentValue(comment.Content || '');
                }}
                onDoubleClick={() => {
                  if (!canManage) return;
                  setEditingCommentId(comment.CommentID);
                  setEditingCommentValue(comment.Content || '');
                }}
                title={canManage ? 'انقر لتعديل هذا التعليق' : undefined}
              >
                {renderWithLinks(comment.Content)}
              </p>
            )}
            <div className="flex justify-between items-center">
              <div className="flex flex-col gap-1">
                <p className="text-xs text-content-secondary">
                  المنشيء: {comment.UserName || comment.UserID}
                  {comment.ActedBy ? ` بواسطة (${comment.ActedByName || getUserNameById(comment.ActedBy)})` : ''}
                </p>
                {canManage && (
                  <label className="flex items-center gap-2 text-xs text-content-secondary">
                    <input
                      type="checkbox"
                      checked={!!comment.ShowInCalendar}
                      onChange={(e) => handleToggleCommentCalendar(e.target.checked)}
                    />
                    <span>إظهار هذا التعليق في التقويم</span>
                  </label>
                )}
              </div>
              <div className="flex items-center gap-2">
                {canManage && (
                  <button
                    onClick={() => handleDeleteComment(comment)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <p className="text-xs text-content-secondary font-mono">#{comment.CommentID}</p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 mt-2 text-xs text-content-secondary">
            <Clock size={12} />
            <span>
              تاريخ الإدراج: {new Date(comment.CreatedAt).toLocaleString('ar-EG', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Muscat'
              })}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-8">
      {/* Bulk Assign Modal */}
      {isBulkModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bkg p-6 rounded-lg shadow-lg w-96 max-w-full">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Users size={20} />
              إسناد متعدد / تكرار المهمة
            </h3>
            <p className="text-sm text-content-secondary mb-4">
              اختر الموظفين الذين تريد إسناد المهمة لهم. سيتم تكرار المهمة لكل موظف إضافي.
            </p>
            <div className="max-h-60 overflow-y-auto space-y-2 mb-4 border border-content/10 p-2 rounded">
              {safeUsers.map(user => (
                <label key={userActorId(user)} className="flex items-center gap-2 cursor-pointer hover:bg-content/5 p-2 rounded transition-colors">
                  <input
                    type="checkbox"
                    checked={bulkSelectedUsers.includes(userActorId(user))}
                    onChange={() => toggleUserSelection(userActorId(user))}
                    className="w-4 h-4 text-primary rounded focus:ring-primary"
                  />
                  <span className="text-sm">{user.FullName}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setIsBulkModalOpen(false)} className="px-4 py-2 text-content-secondary hover:bg-content/10 rounded">إلغاء</button>
              <button onClick={submitBulkAssign} className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark shadow-sm">حفظ وتكرار</button>
            </div>
          </div>
        </div>
      )}

      {/* New Task Bulk Modal */}
      {isNewTaskBulkModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-bkg p-6 rounded-lg shadow-lg w-96 max-w-full">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                      <Users size={20} />
                      إسناد متعدد (مهمة جديدة)
                  </h3>
                  <p className="text-sm text-content-secondary mb-4">
                      اختر الموظفين الذين تريد إسناد المهمة لهم. سيتم إنشاء مهمة فرعية لكل موظف.
                  </p>
                  <div className="max-h-60 overflow-y-auto space-y-2 mb-4 border border-content/10 p-2 rounded">
                        {safeUsers.map(user => (
                          <label key={userActorId(user)} className="flex items-center gap-2 cursor-pointer hover:bg-content/5 p-2 rounded transition-colors">
                              <input 
                                type="checkbox" 
                                checked={newSubtaskBulkUsers.includes(userActorId(user))} 
                                onChange={() => setNewSubtaskBulkUsers(prev => prev.includes(userActorId(user)) ? prev.filter(id => id !== userActorId(user)) : [...prev, userActorId(user)])}
                                className="w-4 h-4 text-primary rounded focus:ring-primary"
                              />
                              <span className="text-sm">{user.FullName}</span>
                          </label>
                      ))}
                  </div>
                  <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setIsNewTaskBulkModalOpen(false); setAssignTo(''); setNewSubtaskBulkUsers([]); }} className="px-4 py-2 text-content-secondary hover:bg-content/10 rounded">إلغاء</button>
                  <button type="button" onClick={() => { setIsNewTaskBulkModalOpen(false); setAssignTo('bulk'); }} className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark shadow-sm">تأكيد الاختيار ({newSubtaskBulkUsers.length})</button>
              </div>
              </div>
          </div>
      )}

      {/* نموذج إضافة مهمة فرعية */}
      {canAddSubtasks && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div 
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setShowSubtaskForm(!showSubtaskForm)}
          >
            <h4 className="font-semibold text-content">إضافة مهمة فرعية جديدة</h4>
            <svg 
              className={`w-5 h-5 text-content transition-transform duration-200 ${showSubtaskForm ? 'rotate-180' : ''}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          
          {showSubtaskForm && (
          <form onSubmit={handleAddSubtask} className="grid grid-cols-1 md:grid-cols-12 gap-2">
            <div className="md:col-span-5">
              <input
                type="text"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                placeholder="عنوان المهمة الفرعية..."
                required
                className="w-full p-2 border rounded-md bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              />
            </div>
            <div className="md:col-span-2">
              <input
                type="date"
                value={newSubtaskDueDate}
                onChange={(e) => setNewSubtaskDueDate(e.target.value)}
                className="w-full p-2 border rounded-md bg-bkg dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
              />
            </div>
            <div className="md:col-span-3 flex items-center gap-1">
              <select
                value={assignTo}
                onChange={e => {
                    if (e.target.value === 'bulk') {
                        setIsNewTaskBulkModalOpen(true);
                        setAssignTo('bulk');
                    } else {
                        setAssignTo(e.target.value);
                    }
                }}
                className="p-2 border rounded-md bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 w-full"
              >
                <option value="">إسناد لـ: (نفسي)</option>
                <option value="bulk" className="font-bold text-primary">👥 إسناد متعدد...</option>
                {safeUsers.map(user => (
                  <option key={userActorId(user)} value={userActorId(user)}>{user.FullName}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => { setIsNewTaskBulkModalOpen(true); setAssignTo('bulk'); }}
                className="p-2 bg-primary/10 hover:bg-primary/20 rounded-md text-primary transition-colors flex-shrink-0"
                title="إسناد متعدد"
              >
                <Users size={20} />
              </button>
            </div>
            <div className="md:col-span-2 flex items-center justify-center">
              <label className="flex items-center gap-2 text-sm px-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showInCalendar}
                  onChange={(e) => setShowInCalendar(e.target.checked)}
                />
                إظهار في التقويم
              </label>
            </div>
            <div className="md:col-span-12 flex justify-end">
              <button
                type="submit"
                className="bg-primary text-white px-6 py-2 rounded-md hover:bg-primary-dark w-full md:w-auto"
              >
                إضافة
              </button>
            </div>
          </form>
          )}
        </div>
      )}
      
      {/* نموذج إضافة تعليق */}
      <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
        <div 
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setShowCommentForm(!showCommentForm)}
        >
          <h4 className="font-semibold text-content">إضافة تعليق جديد</h4>
          <svg 
            className={`w-5 h-5 text-content transition-transform duration-200 ${showCommentForm ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        
        {showCommentForm && (
        <form onSubmit={handleCommentSubmit}>
          <div className="mb-3">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="أضف تعليقاً..."
              rows={3}
              required
              className="w-full p-2 border rounded-md bg-bkg border-content/20 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
            />
          </div>
          
          {/* خيار تحديد التاريخ والوقت المخصص مع زر الإرسال */}
          <div className="flex flex-col md:flex-row gap-3 items-start">
            <div className="flex-1 p-3">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="checkbox"
                  id="useCustomDateTime"
                  checked={useCustomDateTime}
                  onChange={(e) => setUseCustomDateTime(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="useCustomDateTime" className="text-sm font-medium text-content">
                  تحديد تاريخ ووقت مخصص للتعليق
                </label>
              </div>
              
              {useCustomDateTime && (
                <div className="mt-2">
                  <label className="block text-xs text-content-secondary mb-1">
                    التاريخ والوقت (نظام 24 ساعة):
                  </label>
                  <input
                    type="datetime-local"
                    value={customDateTime}
                    onChange={(e) => setCustomDateTime(e.target.value)}
                    className="w-full p-2 border rounded-md bg-bkg border-content/20 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
                  />
                  <p className="text-xs text-content-secondary mt-1">
                    💡 يمكنك اختيار تاريخ سابق لترتيب التعليقات حسب التسلسل الزمني الصحيح
                  </p>
                </div>
              )}
              <div className="flex items-center gap-2 mt-3">
                <input
                  type="checkbox"
                  id="showCommentInCalendar"
                  checked={showCommentInCalendar}
                  onChange={(e) => setShowCommentInCalendar(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="showCommentInCalendar" className="text-sm font-medium text-content">
                  إظهار هذا التعليق في التقويم
                </label>
              </div>
            </div>
            
            <button
              type="submit"
              disabled={isSubmittingComment}
              className="bg-primary text-white px-6 py-2 rounded-md hover:bg-primary-dark disabled:opacity-50 self-start md:self-center h-fit"
            >
              {isSubmittingComment ? 'جاري الإرسال...' : 'إرسال التعليق'}
            </button>
          </div>
        </form>
        )}
      </div>
      
      {/* الجدول الزمني الموحد */}
      <div className="space-y-6">
        {timelineItems.length > 0 ? (
          timelineItems.map((item) => (
            <div key={item.id} className="relative">
              {item.type === 'subtask'
                ? renderSubtaskItem(item.data as Subtask)
                : renderCommentItem(item.data as Comment)
              }
            </div>
          ))
        ) : (
          <p className="text-center text-content-secondary py-8">
            لا توجد مهام فرعية أو تعليقات بعد.
          </p>
        )}
      </div>
    </div>
  );
};

export default UnifiedTimeline;
