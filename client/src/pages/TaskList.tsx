// src/pages/TaskList.tsx
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import TaskCard from '../components/TaskCard';
import SearchBar from '../components/SearchBar';
import { useNotification } from '../contexts/NotificationContext';
import type { CurrentUser, Subtask, Comment } from '../types';
import { getActiveUserId, getActiveAccount } from '../utils/activeAccount';
import { resolveCurrentActorId } from '../utils/actorIdentity';
import { Loader2, ClipboardCopy, Filter, User, Users, ChevronDown, MessageCircle, CheckSquare, ClipboardList, CheckCircle, Clock } from 'lucide-react';

type Task = {
  TaskID: number;
  Title: string;
  Description?: string;
  CreatedBy: string;
  CreatedByVacancyID?: number | string | null;
  CreatedByName?: string | null;
  AssignedTo?: string | null;
  AssignedToVacancyID?: number | string | null;
  AssignedToName: string | null;
  DueDate: string;
  Status: 'open' | 'in-progress' | 'completed' | 'cancelled';
  Priority: 'normal' | 'urgent' | 'starred';
  subtasks?: Subtask[];
  comments?: Comment[];
  HasAssignmentNotifications?: number;
  HasCommentNotifications?: number;
};

type ExportMode = 'title_creator' | 'tasks_incomplete_subtasks' | 'full';

type ActivityItem = {
  ItemType: 'task' | 'subtask' | 'comment';
  TaskID: number;
  TaskTitle: string;
  TaskStatus: Task['Status'];
  CreatedAt: string;
  ActorID: string | null;
  ActorName: string | null;
  SubtaskID: number | null;
  SubtaskTitle: string | null;
  CommentID: number | null;
  CommentContent: string | null;
  AssignedToID: string | null;
  AssignedToName: string | null;
};

type TaskListProps = { currentUser: CurrentUser; };

const TaskList = ({ currentUser }: TaskListProps) => {
  const { setRefreshTasks } = useNotification();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 1. حالة جديدة للتحكم في نافذة التصدير
  const [exportText, setExportText] = useState<string | null>(null);
  
  // حالة للتحكم في قائمة التصدير المنسدلة
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportConfig, setExportConfig] = useState<{ tasks: Task[]; title: string } | null>(null);
  
  // حالة جديدة لاختيار المهام للتصدير
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  
  // وضع عرض المهام: شبكة أو قائمة
  const [layoutMode, setLayoutMode] = useState<'grid' | 'list'>((localStorage.getItem('task-layout') as 'grid' | 'list') || 'grid');
  useEffect(() => {
    const onLayoutChange = () => {
      const val = (localStorage.getItem('task-layout') as 'grid' | 'list') || 'grid';
      setLayoutMode(val);
    };
    window.addEventListener('tasks:layout-changed', onLayoutChange as any);
    return () => window.removeEventListener('tasks:layout-changed', onLayoutChange as any);
  }, []);
  
  // 2. حالة جديدة للفلتر
  const [filterMode, setFilterMode] = useState<'all' | 'my-created'>('all');
  
  // 3. حالة جديدة للبحث
  const [searchTerm, setSearchTerm] = useState<string>('');
  // 3.1 إضافة فلتر الأشخاص (اختياري)
  const [assigneeFilterUserId, setAssigneeFilterUserId] = useState<string | null>(null);
  
  // 4. حالة جديدة للتبويبات
  const [activeTab, setActiveTab] = useState<'active' | 'completed' | 'actioned' | 'updates'>('active');

  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityHasMore, setActivityHasMore] = useState(true);
  const [activityPage, setActivityPage] = useState(0);
  const [activityInfoMsg, setActivityInfoMsg] = useState<string | null>(null);
  const [effectiveActorIdFromApi, setEffectiveActorIdFromApi] = useState<string>('');

  // حدّ أقصى للعودة للوراء: 52 أسبوعاً (سنة كاملة)
  const ACTIVITY_MAX_PAGES = 52;

  const actorId = getActiveUserId(resolveCurrentActorId(currentUser) || currentUser.UserID);
  const subtaskAssigneeId = (subtask: Subtask) => String((subtask as any).AssignedToVacancyID ?? (subtask as any).AssignedTo ?? '');

  // في وضع التفويض: actorId = معرّف المفوِّض (User A)، currentUser = بيانات المفوَّض له (User B)
  const _activeAccount = getActiveAccount();
  const isDelegationMode = _activeAccount?.mode === 'delegation';
  // معرّف المفوِّض (UserID النصي) من localStorage — يُستخدم في مطابقة UserID القديم
  const delegatorUserIdFromAccount = isDelegationMode
    ? String(_activeAccount?.userId || _activeAccount?.actorId || '').trim()
    : '';



  // معرّف المنصب الحالي للمستخدم (VacancyID) من localStorage
  const currentVacancyId = String(
    (currentUser as any).CurrentVacancyID ||
    (currentUser as any).ActiveVacancyID ||
    (currentUser as any).VacancyID ||
    ''
  ).trim();

  // UserID الصريح للمستخدم المسجَّل (User B في وضع التفويض)
  const currentUserIdStrict = String(currentUser.UserID ?? '').trim();

  // في وضع التفويض: نستخدم معرّف المفوِّض (User A) للمطابقة
  // في الوضع العادي: نستخدم UserID المستخدم الحالي
  const actorUserIdStrict = isDelegationMode ? delegatorUserIdFromAccount : currentUserIdStrict;

  // VacancyID الفعلي للفاعل:
  // - وضع التفويض: effectiveActorIdFromApi (المُحلَّل من الخادم للمفوِّض) أو actorId من localStorage
  // - الوضع العادي: currentVacancyId للمستخدم الحالي أو effectiveActorIdFromApi
  const effectiveVacancyId = isDelegationMode
    ? (effectiveActorIdFromApi || actorId)
    : (currentVacancyId || effectiveActorIdFromApi);

  // مطابقة صارمة: VacancyID مع VacancyID، UserID مع UserID — لا خلط بينهما
  const isTaskCreatedByActor = (task: Task) => {
    const taskVacancyId = String((task as any).CreatedByVacancyID ?? '').trim();
    const taskCreatedBy = String(task.CreatedBy ?? '').trim();
    if (taskVacancyId && effectiveVacancyId && taskVacancyId === effectiveVacancyId) return true;
    if (taskCreatedBy && actorUserIdStrict && taskCreatedBy === actorUserIdStrict) return true;
    return false;
  };

  const isSubtaskAssignedToActor = (subtask: Subtask) => {
    const subVacancyId = String((subtask as any).AssignedToVacancyID ?? '').trim();
    const subAssignedTo = String((subtask as any).AssignedTo ?? '').trim();
    if (subVacancyId && effectiveVacancyId && subVacancyId === effectiveVacancyId) return true;
    if (subAssignedTo && actorUserIdStrict && subAssignedTo === actorUserIdStrict) return true;
    return false;
  };

  // تمييز بصري: VacancyID حصراً (باستخدام effectiveVacancyId كاحتياط)
  const isMySubtaskByVacancyId = (subtask: Subtask): boolean => {
    if (!effectiveVacancyId) return false;
    const subtaskVacancyId = String((subtask as any).AssignedToVacancyID ?? '').trim();
    return !!subtaskVacancyId && subtaskVacancyId === effectiveVacancyId;
  };

  const isCommentByActor = (task: Task) => {
    return (task.comments || []).some(comment => {
      const commentVacancyId = String((comment as any).CommentedByVacancyID ?? '').trim();
      const commentUserId = String((comment as any).UserID ?? '').trim();
      if (commentVacancyId && effectiveVacancyId && commentVacancyId === effectiveVacancyId) return true;
      if (commentUserId && actorUserIdStrict && commentUserId === actorUserIdStrict) return true;
      return false;
    });
  };

  const isTaskRelatedToActor = (task: Task) => {
    if (isTaskCreatedByActor(task)) return true;
    if ((task.subtasks || []).some(st => isSubtaskAssignedToActor(st))) return true;
    if (isCommentByActor(task)) return true;
    return false;
  };

  // نعتمد على قيم أوّلية (string/boolean) بدل كائن currentUser لتفادي إعادة إنشاء الدالة
  // مع كل render → ما كان يسبّب تصفير activityPage فور النقر على "تحميل المزيد".
  const isAdminFlag = !!currentUser.IsAdmin;
  const fetchActivity = useCallback(async (pageIndex = 0) => {
    setIsLoadingActivity(true);
    setActivityError(null);
    setActivityInfoMsg(null);
    try {
      // Fetch 7 days of activity based on pageIndex
      const res = await fetch(`/api/tasks/activity?userId=${actorId}&isAdmin=${isAdminFlag}&page=${pageIndex}&days=7`);
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !ct.includes('application/json')) {
        if (pageIndex === 0) setActivityItems([]);
        setActivityError('تعذر جلب آخر التحديثات.');
        return;
      }
      const data = await res.json().catch(() => []);
      const newItems = Array.isArray(data) ? (data as ActivityItem[]) : [];

      // بناء نص نطاق الفترة التي تم جلبها (للعرض للمستخدم)
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - (pageIndex * 7));
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 7);
      const fmt = (d: Date) => d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
      const rangeLabel = `${fmt(startDate)} — ${fmt(endDate)}`;

      // تغذية راجعة عند وجود أسبوع بلا نشاط — حتى لا يبدو الزر كأنه لا يعمل
      if (newItems.length === 0 && pageIndex > 0) {
        setActivityInfoMsg(`لا توجد تحديثات في الفترة: ${rangeLabel}. اضغط "تحميل المزيد" للبحث في فترة أبعد.`);
      } else if (newItems.length > 0) {
        setActivityInfoMsg(`آخر فترة تم جلبها: ${rangeLabel}`);
      }

      // السماح بالتحميل حتى الحدّ الأقصى
      setActivityHasMore(pageIndex < ACTIVITY_MAX_PAGES);

      setActivityItems(prev => pageIndex === 0 ? newItems : [...prev, ...newItems]);
      setActivityPage(pageIndex);
    } catch {
      if (pageIndex === 0) setActivityItems([]);
      setActivityError('تعذر الاتصال بالخادم لجلب آخر التحديثات.');
    } finally {
      setIsLoadingActivity(false);
    }
  }, [actorId, isAdminFlag]);

  useEffect(() => {
    if (activeTab === 'updates') {
      // Reset and fetch first page — فقط عند تبديل التبويب فعلياً
      setActivityPage(0);
      setActivityHasMore(true);
      setActivityInfoMsg(null);
      fetchActivity(0);
    }
    // نتعمّد استبعاد fetchActivity من الـ deps كي لا يُعاد التصفير عند كل render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const loadMoreActivity = () => {
    if (isLoadingActivity) return;
    if (!activityHasMore) return;
    if (activityPage >= ACTIVITY_MAX_PAGES) {
      setActivityHasMore(false);
      setActivityInfoMsg('تم الوصول إلى الحدّ الأقصى للفترات المتاحة (سنة كاملة).');
      return;
    }
    fetchActivity(activityPage + 1);
  };

  const exportActivityLog = () => {
    if (activityItems.length === 0) {
      return;
    }

    const formatDate = (dateString: string) => {
      return new Date(dateString).toLocaleString('ar-EG');
    };

    let content = `=== تقرير آخر التحديثات ===\n`;
    content += `تاريخ التصدير: ${new Date().toLocaleString('ar-EG')}\n`;
    content += `عدد التحديثات المعروضة: ${activityItems.length}\n\n`;

    activityItems.forEach((item) => {
      const date = formatDate(item.CreatedAt);
      const actor = item.ActorName || item.ActorID || 'مستخدم غير معروف';
      
      let actionType = 'مهمة جديدة';
      let details = '';
      
      if (item.ItemType === 'subtask') {
        actionType = 'مهمة فرعية جديدة';
        details = item.SubtaskTitle || '';
      } else if (item.ItemType === 'comment') {
        actionType = 'تعليق جديد';
        details = item.CommentContent || '';
      } else {
        // item.ItemType === 'task'
        actionType = 'مهمة جديدة';
        details = item.TaskTitle;
      }

      content += `[${date}] - بواسطة: ${actor}\n`;
      content += `النوع: ${actionType}\n`;
      
      if (item.ItemType === 'task') {
          content += `المهمة: ${item.TaskTitle}\n`;
      } else {
          content += `التفاصيل: ${details}\n`;
          content += `في المهمة: ${item.TaskTitle}\n`;
      }
      
      if (item.AssignedToName) {
        content += `مسند إلى: ${item.AssignedToName}\n`;
      }
      
      content += `----------------------------------------\n`;
    });

    setExportText(content);
  };

  const fetchTasksAndSubtasks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const isAdmin = currentUser.IsAdmin;
      const actingUserId = actorId;
      const tasksRes = await fetch(`/api/tasks/with-notifications?userId=${actingUserId}&isAdmin=${isAdmin}`);
      const effectiveActorHeader = tasksRes.headers.get('x-effective-actor-id') || tasksRes.headers.get('X-Effective-Actor-ID') || '';
      if (effectiveActorHeader) {
        setEffectiveActorIdFromApi(String(effectiveActorHeader).trim());
      }
      let tasksData: Task[] = [];

      // حرس قوي لتحليل JSON وتوفير سقوط احتياطي مع فحص نوع المحتوى
      const parseJsonSafely = async (res: Response): Promise<any[]> => {
        if (!res || !res.ok) return [];
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return [];
        try { return await res.json(); } catch { return []; }
      };

      if (!tasksRes.ok) {
        // في حالة فشل المسار مع الإشعارات، جرب المسار الأساسي كحل مؤقت
        console.warn('Tasks API responded non-OK:', tasksRes.status);
        const fallbackRes = await fetch(`/api/tasks?userId=${actingUserId}&isAdmin=${isAdmin}`);
        const fallbackEffectiveActor = fallbackRes.headers.get('x-effective-actor-id') || fallbackRes.headers.get('X-Effective-Actor-ID') || '';
        if (fallbackEffectiveActor) {
          setEffectiveActorIdFromApi(String(fallbackEffectiveActor).trim());
        }
        const fallbackData = await parseJsonSafely(fallbackRes);
        tasksData = Array.isArray(fallbackData) ? fallbackData as Task[] : [];
      } else {
        // عند نجاح الطلب، حاول تحليل JSON بشكل آمن
        const primaryData = await parseJsonSafely(tasksRes);
        if (Array.isArray(primaryData)) {
          tasksData = primaryData as Task[];
        } else {
          console.warn('with-notifications returned non-JSON or invalid; falling back to /api/tasks');
          const fallbackRes = await fetch(`/api/tasks?userId=${actingUserId}&isAdmin=${isAdmin}`);
          const fallbackEffectiveActor = fallbackRes.headers.get('x-effective-actor-id') || fallbackRes.headers.get('X-Effective-Actor-ID') || '';
          if (fallbackEffectiveActor) {
            setEffectiveActorIdFromApi(String(fallbackEffectiveActor).trim());
          }
          const fallbackData = await parseJsonSafely(fallbackRes);
          tasksData = Array.isArray(fallbackData) ? fallbackData as Task[] : [];
        }
      }

      // التأكد من أن tasksData مصفوفة
      if (!Array.isArray(tasksData)) {
        console.error('Tasks data is not an array:', tasksData);
        tasksData = [];
      }

      // جلب المهام الفرعية والتعليقات والأولويات الشخصية بشكل متوازي للمهام غير المكتملة فقط
      const BATCH_SIZE = 6;
      const fetchInBatches = async <T,>(items: Task[], batchSize: number, fn: (task: Task) => Promise<T>): Promise<T[]> => {
        const results: T[] = [];
        for (let i = 0; i < items.length; i += batchSize) {
          const batch = items.slice(i, i + batchSize);
          const batchResults = await Promise.all(batch.map(fn));
          results.push(...batchResults);
        }
        return results;
      };

      const nonCompletedTasks = tasksData.filter(t => t.Status !== 'completed' && t.Status !== 'cancelled');

      // جلب تفاصيل المهام غير المكتملة فقط
      const subtasksResults = await fetchInBatches(nonCompletedTasks, BATCH_SIZE, async (task) =>
        fetch(`/api/tasks/${task.TaskID}/subtasks?userId=${actingUserId}&isAdmin=${currentUser.IsAdmin}`)
          .then(res => res.status === 403 ? [] : res.json())
          .catch(() => [])
      );

      const commentsResults = await fetchInBatches(nonCompletedTasks, BATCH_SIZE, async (task) =>
        fetch(`/api/tasks/${task.TaskID}/comments?userId=${actingUserId}&isAdmin=${currentUser.IsAdmin}`)
          .then(res => res.status === 403 ? [] : res.json())
          .catch(() => [])
      );
      
      const prioritiesResults = await fetchInBatches(nonCompletedTasks, BATCH_SIZE, async (task) =>
        fetch(`/api/tasks/${task.TaskID}/user-priority?userId=${actingUserId}`)
          .then(res => res.json())
          .catch(() => ({ priority: task.Priority }))
      );

      // بناء خريطة تفاصيل حسب المعرف للدمج السهل
      const detailsById: Record<number, { subtasks: Subtask[]; comments: Comment[]; priority: 'normal' | 'urgent' | 'starred'; }> = {};
      nonCompletedTasks.forEach((t, idx) => {
        detailsById[t.TaskID] = {
          subtasks: subtasksResults[idx] || [],
          comments: commentsResults[idx] || [],
          priority: prioritiesResults[idx]?.priority || t.Priority,
        };
      });

      // دمج البيانات: إبقاء المهام المكتملة بدون تفاصيل حتى يُفتح تبويبها
      tasksData = tasksData.map(task => {
        const det = detailsById[task.TaskID];
        return {
          ...task,
          subtasks: det ? det.subtasks : [],
          comments: det ? det.comments : [],
          Priority: det ? det.priority : task.Priority,
          HasCommentNotifications: typeof task.HasCommentNotifications === 'number' ? task.HasCommentNotifications : 0
        };
      });

      setTasks(tasksData);
    } catch (err) {
      console.error('Error fetching tasks:', err);
      setError('فشل في تحميل المهام');
    } finally {
      setIsLoading(false);
    }
  }, [actorId, currentUser.IsAdmin]);

  useEffect(() => {
    fetchTasksAndSubtasks();
    
    // تسجيل دالة تحديث المهام في NotificationContext
    setRefreshTasks(fetchTasksAndSubtasks);
    
    // تم تعطيل تحديث قائمة المهام عند عودة التركيز إلى النافذة
  }, [fetchTasksAndSubtasks]);

  // حالة وتتبع تحميل المهام المكتملة على دفعات
  const [completedPage, setCompletedPage] = useState(1);
  const [isLoadingCompleted, setIsLoadingCompleted] = useState(false);
  const [completedHasMore, setCompletedHasMore] = useState(true);
  const [isSearchingCompleted, setIsSearchingCompleted] = useState(false);

  // دالة لجلب 10 مهام مكتملة إضافية عند الطلب (لا يتم استدعاؤها تلقائياً)
  const loadMoreCompletedTasks = async () => {
    try {
      if (isLoadingCompleted || !completedHasMore) return;

      setIsLoadingCompleted(true);
      const actingUserId = actorId;
      const isAdmin = currentUser.IsAdmin;
      const pageSize = 10;

      const completedTasksRes = await fetch(`/api/tasks/completed?userId=${actingUserId}&isAdmin=${isAdmin}&page=${completedPage}&pageSize=${pageSize}`);
      if (!completedTasksRes.ok) {
        setCompletedHasMore(false);
        return;
      }

      const completedTasksData: Task[] = await completedTasksRes.json();
      if (!Array.isArray(completedTasksData) || completedTasksData.length === 0) {
        setCompletedHasMore(false);
        return;
      }

      const BATCH_SIZE = 6;
      const fetchInBatches = async <T,>(items: Task[], batchSize: number, fn: (task: Task) => Promise<T>): Promise<T[]> => {
        const results: T[] = [];
        for (let i = 0; i < items.length; i += batchSize) {
          const batch = items.slice(i, i + batchSize);
          const batchResults = await Promise.all(batch.map(fn));
          results.push(...batchResults);
        }
        return results;
      };

      const completedSubtasks = await fetchInBatches(completedTasksData, BATCH_SIZE, async (task) =>
        fetch(`/api/tasks/${task.TaskID}/subtasks?userId=${actingUserId}&isAdmin=${currentUser.IsAdmin}`)
          .then(res => res.status === 403 ? [] : res.json())
          .catch(() => [])
      );

      const completedComments = await fetchInBatches(completedTasksData, BATCH_SIZE, async (task) =>
        fetch(`/api/tasks/${task.TaskID}/comments?userId=${actingUserId}&isAdmin=${currentUser.IsAdmin}`)
          .then(res => res.status === 403 ? [] : res.json())
          .catch(() => [])
      );

      const completedPriorities = await fetchInBatches(completedTasksData, BATCH_SIZE, async (task) =>
        fetch(`/api/tasks/${task.TaskID}/user-priority?userId=${actingUserId}`)
          .then(res => res.json())
          .catch(() => ({ priority: task.Priority }))
      );

      // دمج المهام المكتملة في الحالة الحالية مع تفاصيلها
      setTasks(prev => {
        const byId: Record<number, { subtasks: Subtask[]; comments: Comment[]; priority: 'normal' | 'urgent' | 'starred'; }> = {};
        completedTasksData.forEach((t, idx) => {
          byId[t.TaskID] = {
            subtasks: completedSubtasks[idx] || [],
            comments: completedComments[idx] || [],
            priority: completedPriorities[idx]?.priority || t.Priority,
          };
        });

        // تحديث المهام الموجودة أو إضافتها إن لم تكن موجودة
        const existingIds = new Set(prev.map(t => t.TaskID));
        const updated = prev.map(t => {
          const det = byId[t.TaskID];
          if (!det) return t;
          return { ...t, subtasks: det.subtasks, comments: det.comments, Priority: det.priority };
        });

        const newCompleted = completedTasksData
          .filter(t => !existingIds.has(t.TaskID))
          .map(t => {
            const det = byId[t.TaskID];
            return {
              ...t,
              subtasks: det ? det.subtasks : [],
              comments: det ? det.comments : [],
              Priority: det ? det.priority : t.Priority,
              HasCommentNotifications: typeof t.HasCommentNotifications === 'number' ? t.HasCommentNotifications : 0
            };
          });

        return [...updated, ...newCompleted];
      });

      // إذا كانت أقل من حجم الصفحة، فليس هناك المزيد
      if (completedTasksData.length < pageSize) {
        setCompletedHasMore(false);
      }

      setCompletedPage(prev => prev + 1);
    } catch (e) {
      console.error('Error fetching completed task details:', e);
    } finally {
      setIsLoadingCompleted(false);
    }
  };

  // دالة للبحث في المهام المكتملة في قاعدة البيانات
  const searchCompletedTasksInDb = async () => {
    const term = searchTerm.trim();
    if (!term) return;

    try {
      setIsSearchingCompleted(true);
      const actingUserId = actorId;
      const isAdmin = currentUser.IsAdmin;

      const res = await fetch(`/api/tasks/completed/search?userId=${actingUserId}&isAdmin=${isAdmin}&q=${encodeURIComponent(term)}`);
      if (!res.ok) {
        return;
      }

      const completedTasksData: Task[] = await res.json();

      setTasks(prev => {
        // الحفاظ على المهام غير المكتملة كما هي
        const nonCompleted = prev.filter(
          t => t.Status !== 'completed' && t.Status !== 'cancelled'
        );

        // دمج نتائج البحث المكتملة بدون تكرار
        const existingIds = new Set(nonCompleted.map(t => t.TaskID));
        const mergedCompleted = completedTasksData.filter(t => !existingIds.has(t.TaskID));

        return [...nonCompleted, ...mergedCompleted];
      });
    } catch (e) {
      console.error('Error searching completed tasks in DB:', e);
    } finally {
      setIsSearchingCompleted(false);
    }
  };

  // دالة لتحديث أولوية المهمة
  const updateTaskPriority = async (taskId: number, newPriority: 'normal' | 'urgent' | 'starred') => {
    try {
      const actingUserId = actorId;
      const response = await fetch(`/api/tasks/${taskId}/user-priority?userId=${actingUserId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priority: newPriority
        }),
      });

      if (response.ok) {
        // تحديث الحالة المحلية
        setTasks(prevTasks => 
          prevTasks.map(task => 
            task.TaskID === taskId 
              ? { ...task, Priority: newPriority }
              : task
          )
        );
      } else {
        console.error('Failed to update task priority');
      }
    } catch (error) {
      console.error('Error updating task priority:', error);
    }
  };

  const buildExportContent = (tasksToExport: Task[], title: string, mode: ExportMode) => {
    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-GB');
    };

    let exportContent = `=== ${title} ===\n`;
    exportContent += `تاريخ التصدير: ${new Date().toLocaleDateString('en-GB')}\n`;
    exportContent += `عدد المهام: ${tasksToExport.length}\n\n`;

    tasksToExport.forEach((task, index) => {
      if (mode === 'title_creator') {
        exportContent += `${index + 1}. ${task.Title}\n`;
        exportContent += `   👤 المنشئ: ${task.CreatedByName || task.CreatedBy}\n\n`;
        return;
      }

      exportContent += `${index + 1}. ${task.Title}\n`;
      exportContent += `   📅 تاريخ الاستحقاق: ${formatDate(task.DueDate)}\n`;

      if (mode === 'tasks_incomplete_subtasks') {
        const incompleteSubtasks = (task.subtasks || []).filter(st => !st.IsCompleted);
        if (incompleteSubtasks.length > 0) {
          exportContent += `   📋 المهام الفرعية غير المنجزة (${incompleteSubtasks.length}):\n`;
          incompleteSubtasks.forEach((subtask, subIndex) => {
            exportContent += `      ${subIndex + 1}. ⏳ ${subtask.Title}\n`;
          });
        } else {
          exportContent += `   لا توجد مهام فرعية غير منجزة.\n`;
        }
        exportContent += `\n`;
        return;
      }

      if (task.subtasks && task.subtasks.length > 0) {
        exportContent += `   📋 المهام الفرعية (${task.subtasks.length}):\n`;
        task.subtasks.forEach((subtask, subIndex) => {
          const statusIcon = subtask.IsCompleted ? '✅' : '⏳';
          exportContent += `      ${subIndex + 1}. ${statusIcon} ${subtask.Title}\n`;
        });
      }

      if (task.comments && task.comments.length > 0) {
        exportContent += `   💬 التعليقات (${task.comments.length}):\n`;
        task.comments.forEach((comment, commentIndex) => {
          const commentDate = new Date(comment.CreatedAt).toLocaleDateString('en-GB');
          exportContent += `      ${commentIndex + 1}. ${comment.Content} - (${comment.UserName || comment.UserID}, ${commentDate})\n`;
        });
      }

      exportContent += `\n`;
    });

    return exportContent;
  };

  const startExport = (tasksToExport: Task[], title: string) => {
    if (!tasksToExport.length) {
      setExportText('لا توجد مهام للتصدير في هذا التبويب.');
      setShowExportMenu(false);
      return;
    }
    setExportConfig({ tasks: tasksToExport, title });
    setShowExportMenu(false);
  };

  const handleExportWithMode = (mode: ExportMode) => {
    if (!exportConfig) return;
    const content = buildExportContent(exportConfig.tasks, exportConfig.title, mode);
    setExportText(content);
    setExportConfig(null);
  };

  const handleExportUrgent = () => {
    const urgentTasks = tasks.filter(task => task.Priority === 'urgent');
    startExport(urgentTasks, 'المهام العاجلة');
  };
  
  const handleExportSelected = () => {
    const selectedTasksList = tasks.filter(task => selectedTasks.has(task.TaskID));
    startExport(selectedTasksList, 'المهام المختارة');
    setIsSelectionMode(false);
    setSelectedTasks(new Set());
  };
  
  // دوال التعامل مع اختيار المهام
  const toggleTaskSelection = (taskId: number) => {
    const newSelected = new Set(selectedTasks);
    if (newSelected.has(taskId)) {
      newSelected.delete(taskId);
    } else {
      newSelected.add(taskId);
    }
    setSelectedTasks(newSelected);
  };
  
  const selectAllTasks = () => {
    const currentTabTasks = getCurrentTabTasks();
    const allTaskIds = new Set(currentTabTasks.map(task => task.TaskID));
    setSelectedTasks(allTaskIds);
  };
  
  const clearSelection = () => {
    setSelectedTasks(new Set());
  };
  
  // دالة للحصول على مهام التبويب الحالي
  const getCurrentTabTasks = () => {
    switch (activeTab) {
      case 'active': return activeTasks;
      case 'completed': return completedTasks;
      case 'actioned': return actionedTasks;
      case 'updates': return [];
      default: return activeTasks;
    }
  };

  // دالة نسخ النص إلى الحافظة
  const copyToClipboard = async () => {
    if (exportText) {
      try {
        await navigator.clipboard.writeText(exportText);
        setExportText(null);
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
    }
  };

  // 5. فلترة المهام حسب الوضع المحدد والبحث
  // بناء قائمة الأشخاص المتاحين من المهام الفرعية الموجودة حالياً
  const assigneeOptions = useMemo(() => {
    const map = new Map<string, string | undefined>();
    tasks.forEach(task => {
      (task.subtasks || []).forEach(st => {
        const stAssignedTo = subtaskAssigneeId(st as any);
        if (stAssignedTo) {
          // استخدام الاسم إن وجد، وإلا نبقي المعرف فقط
          map.set(stAssignedTo, (st as any).AssignedToName);
        }
      });
    });
    // ترتيب أبجدي حسب الاسم إن وجد، وإلا حسب المعرف
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name: name || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const filteredTasks = tasks.filter(task => {
    const isRelated = isTaskRelatedToActor(task);
    if (!isRelated) {
      return false;
    }

    // فلتر حسب المنشئ
    const matchesFilter = filterMode === 'all' || isTaskCreatedByActor(task);
    
    // فلتر حسب البحث
    const matchesSearch = !searchTerm.trim() || 
      task.Title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (task.Description && task.Description.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (task.CreatedByName && task.CreatedByName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (task.AssignedToName && task.AssignedToName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      // البحث في المهام الفرعية
      (task.subtasks && task.subtasks.some(subtask => 
        subtask.Title.toLowerCase().includes(searchTerm.toLowerCase())
      )) ||
      // البحث في التعليقات
      (task.comments && task.comments.some(comment => 
        comment.Content.toLowerCase().includes(searchTerm.toLowerCase())
      ));

    // فلتر حسب الشخص المختار: عند اختيار شخص معيّن، نعرض فقط المهام التي تحتوي
    // على مهام فرعية غير مكتملة مسندة له، ونستبعد المهام التي لا تحتوي على مهام فرعية إطلاقاً
    const matchesAssignee = !assigneeFilterUserId
      ? true
      : !!(task.subtasks && task.subtasks.length > 0 &&
           task.subtasks.some(st => !st.IsCompleted && subtaskAssigneeId(st as any) === assigneeFilterUserId));
    
    return matchesFilter && matchesSearch && matchesAssignee;
  });



  const isOpenStatus = (task: Task) =>
    task.Status !== 'completed' &&
    task.Status !== 'cancelled';

  const activeTasks = filteredTasks.filter(task => {
    if (!isOpenStatus(task)) return false;
    const subtasks = task.subtasks || [];
    if (subtasks.some(subtask => isSubtaskAssignedToActor(subtask) && !subtask.IsCompleted)) return true;
    if (subtasks.length === 0 && isTaskCreatedByActor(task)) return true;
    return false;
  });

  const completedTasks = filteredTasks.filter(task => task.Status === 'completed' || task.Status === 'cancelled');

  // المهام المتعلقة بي ولا يوجد فيها إجراء معلق (سواء أنشأتها أو أنهيت جميع مهامي الفرعية)
  // "أنجزت إجرائي فيها": مفتوحة + متعلقة بي + لا توجد مهام فرعية معلقة لي
  // يشمل: مهام أنشأتها بلا مهام فرعية لي، ومهام أنهيت فيها جميع مهامي الفرعية
  const actionedTasks = filteredTasks.filter(task => {
    if (!isOpenStatus(task)) return false;
    const subtasks = task.subtasks || [];
    const hasMyIncompleteSubtasks = subtasks.some(
      subtask => isSubtaskAssignedToActor(subtask) && !subtask.IsCompleted
    );
    return !hasMyIncompleteSubtasks;
  });

  // دالة للحصول على أكبر معرف للمهام الفرعية الغير مكتملة
  const getMaxIncompleteSubtaskId = (task: Task): number => {
    if (!task.subtasks || task.subtasks.length === 0) {
      return 0; // إذا لم توجد مهام فرعية، استخدم 0
    }
    
    // فلترة المهام الفرعية الغير مكتملة
    const myIncompleteSubtasks = task.subtasks.filter(
      st => !st.IsCompleted && isSubtaskAssignedToActor(st)
    ) || [];
    
    if (myIncompleteSubtasks.length === 0) {
      return 0; // إذا لم توجد مهام فرعية غير مكتملة، استخدم 0
    }
    
    // العثور على أكبر معرف من المهام الفرعية الغير مكتملة
    return Math.max(...myIncompleteSubtasks.map(st => st.SubtaskID));
  };

  // دالة لحساب الإشعارات لكل تبويب
  const getTabNotifications = (tasks: Task[]) => {
    return tasks.reduce((acc, task) => {
      // حساب إشعارات الإسناد والتعليقات
      const hasAssignmentNotifications = task.HasAssignmentNotifications && task.HasAssignmentNotifications > 0;
      const hasCommentNotifications = task.HasCommentNotifications && task.HasCommentNotifications > 0;
      
      if (hasAssignmentNotifications) {
        acc.assignment += 1;
      }
      if (hasCommentNotifications) {
        acc.comment += 1;
      }
      
      return acc;
    }, { assignment: 0, comment: 0 });
  };

  // حساب الإشعارات لكل تبويب
  const activeTabNotifications = getTabNotifications(activeTasks);
  const actionedTabNotifications = getTabNotifications(actionedTasks);
  const completedTabNotifications = getTabNotifications(completedTasks);

  // حساب إجمالي الإشعارات لكل تبويب

  // ترتيب المهام: المهام العاجلة أولاً، ثم حسب أكبر معرف للمهام الفرعية الغير مكتملة
  const sortTasks = (tasks: Task[]) => {
    return tasks.sort((a, b) => {
      // أولوية للمهام العاجلة
      if (a.Priority === 'urgent' && b.Priority !== 'urgent') return -1;
      if (b.Priority === 'urgent' && a.Priority !== 'urgent') return 1;
      
      // إذا كانت كلاهما عاجلة أو كلاهما عادية، رتب حسب أكبر معرف للمهام الفرعية
      const maxIdA = getMaxIncompleteSubtaskId(a);
      const maxIdB = getMaxIncompleteSubtaskId(b);
      return maxIdB - maxIdA; // ترتيب تنازلي (الأكبر أولاً)
    });
  };
  
  sortTasks(activeTasks);
  sortTasks(actionedTasks);
  sortTasks(completedTasks);

  if (isLoading) return <div className="flex justify-center items-center p-8"><Loader2 className="animate-spin text-primary" size={48} /></div>;
  if (error) return <p className="text-center p-8 text-red-500">حدث خطأ: {error}</p>;

  return (
    <div className="space-y-12 relative">
      {/* --- البحث والفلتر والتصدير --- */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border p-4 mb-6">
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4">
          {/* مكون البحث */}
          <div className="flex items-center gap-4 flex-1">
            <SearchBar 
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              placeholder="البحث في المهام والمهام الفرعية والتعليقات..."
            />
          </div>
          
          {/* فلتر المهام */}
      <div className="flex items-center gap-4">
        <Filter className="text-primary" size={20} />
        <span className="font-medium text-content">عرض المهام:</span>
        <div className="flex gap-2">
          <button
            onClick={() => setFilterMode('all')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
              filterMode === 'all'
                ? 'bg-primary text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-content hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <Users size={16} />
            جميع المهام
          </button>
          <button
            onClick={() => setFilterMode('my-created')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
              filterMode === 'my-created'
                ? 'bg-primary text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-content hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            <User size={16} />
            المهام التي أنشأتها
          </button>
        </div>
      </div>

      {/* فلتر أسماء الأشخاص */}
      <div className="flex items-center gap-2">
        <span className="font-medium text-content">حسب الشخص:</span>
        <select
          value={assigneeFilterUserId ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            setAssigneeFilterUserId(val ? val : null);
          }}
          className="px-3 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-content hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          <option value="">جميع الأشخاص</option>
          {assigneeOptions.map(opt => (
            <option key={opt.id} value={opt.id}>{opt.name}</option>
          ))}
        </select>
        {assigneeFilterUserId && (
          <button
            onClick={() => setAssigneeFilterUserId(null)}
            className="px-2 py-1 text-sm rounded-md bg-gray-200 dark:bg-gray-600"
          >
            مسح الفلتر
          </button>
        )}
      </div>
          
          {/* أزرار التحكم في الاختيار */}
          {isSelectionMode && (
            <div className="flex items-center gap-2">
              <button
                onClick={selectAllTasks}
                className="px-3 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors text-sm"
              >
                اختيار الكل
              </button>
              <button
                onClick={clearSelection}
                className="px-3 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors text-sm"
              >
                إلغاء الاختيار
              </button>
              <button
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedTasks(new Set());
                }}
                className="px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors text-sm"
              >
                إنهاء الاختيار
              </button>
              {selectedTasks.size > 0 && (
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  تم اختيار {selectedTasks.size} مهمة
                </span>
              )}
            </div>
          )}
          
          {/* زر التصدير */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary-dark transition-colors"
            >
              <ClipboardCopy size={16} />
              <span>تصدير</span>
              <ChevronDown size={16} className={`transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg border z-10">
                <button
                  onClick={handleExportUrgent}
                  className="w-full text-right px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  🔴 المهام العاجلة فقط
                </button>
                <button
                  onClick={() => startExport(activeTasks, 'المهام النشطة')}
                  className="w-full text-right px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  ⚡ المهام النشطة
                </button>
                <button
                  onClick={() => startExport(externalTasks, 'المهام الخارجية')}
                  className="w-full text-right px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  🏢 المهام الخارجية
                </button>
                <button
                  onClick={() => startExport(actionedTasks, 'المهام التي أنجزت إجرائي فيها')}
                  className="w-full text-right px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  ✅ المهام التي أنجزت إجرائي فيها
                </button>
                <hr className="my-1" />
                <button
                  onClick={() => {
                    setIsSelectionMode(!isSelectionMode);
                    setShowExportMenu(false);
                  }}
                  className="w-full text-right px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-medium"
                >
                  🎯 اختيار مهام محددة
                </button>
                {selectedTasks.size > 0 && (
                  <button
                    onClick={handleExportSelected}
                    className="w-full text-right px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-blue-600 font-medium"
                  >
                    📤 تصدير المهام المختارة ({selectedTasks.size})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {exportConfig && !exportText && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setExportConfig(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-content mb-2">خيارات التصدير</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              سيتم التصدير من: {exportConfig.title}
            </p>
            <div className="space-y-2">
              <button
                onClick={() => handleExportWithMode('title_creator')}
                className="w-full text-right px-4 py-2 rounded-md border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm"
              >
                1) تصدير عنوان المهمة والمنشئ فقط
              </button>
              <button
                onClick={() => handleExportWithMode('tasks_incomplete_subtasks')}
                className="w-full text-right px-4 py-2 rounded-md border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm"
              >
                2) تصدير المهام والمهام الفرعية غير المنجزة
              </button>
              <button
                onClick={() => handleExportWithMode('full')}
                className="w-full text-right px-4 py-2 rounded-md border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-sm"
              >
                3) تصدير المهام والمهام الفرعية بالكامل والتعليقات
              </button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setExportConfig(null)}
                className="bg-gray-200 dark:bg-gray-600 px-4 py-2 rounded-md text-sm"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {exportText && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setExportText(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-content mb-4">تقرير المهام (جاهز للنسخ)</h2>
            <textarea
              readOnly
              value={exportText}
              className="w-full h-64 p-2 border rounded bg-gray-50 dark:bg-gray-700 font-mono text-sm"
              onFocus={(e) => e.target.select()}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => {
                const printWindow = window.open('', '_blank');
                if (printWindow) {
                  printWindow.document.write(`
                    <html dir="rtl">
                      <head>
                        <title>طباعة التقرير</title>
                        <style>
                          body { font-family: sans-serif; padding: 20px; white-space: pre-wrap; line-height: 1.5; }
                        </style>
                      </head>
                      <body>${exportText}</body>
                    </html>
                  `);
                  printWindow.document.close();
                  printWindow.print();
                }
              }} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700">
                طباعة
              </button>
              <button onClick={copyToClipboard} className="bg-primary text-white px-4 py-2 rounded-md hover:bg-primary-dark">
                نسخ وإغلاق
              </button>
              <button onClick={() => setExportText(null)} className="bg-gray-200 dark:bg-gray-600 px-4 py-2 rounded-md">
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}



      {/* --- نظام التبويبات --- */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border mb-6">
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('active')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'active'
                ? 'text-primary border-b-2 border-primary bg-blue-50 dark:bg-blue-900/20'
                : 'text-gray-600 dark:text-gray-400 hover:text-primary'
            }`}
          >
            ⚡ المهام النشطة ({activeTasks.length})
            <div className="flex items-center gap-1 ml-2">
              {activeTabNotifications.assignment > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full animate-pulse">
                  {activeTabNotifications.assignment}
                </span>
              )}
              {activeTabNotifications.comment > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-green-500 rounded-full animate-pulse">
                  {activeTabNotifications.comment}
                </span>
              )}
            </div>
          </button>
          <button
            onClick={() => setActiveTab('actioned')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'actioned'
                ? 'text-primary border-b-2 border-primary bg-blue-50 dark:bg-blue-900/20'
                : 'text-gray-600 dark:text-gray-400 hover:text-primary'
            }`}
          >
            🔧 المهام التي أنجزت إجرائي فيها ({actionedTasks.length})
            <div className="flex items-center gap-1 ml-2">
              {actionedTabNotifications.assignment > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full animate-pulse">
                  {actionedTabNotifications.assignment}
                </span>
              )}
              {actionedTabNotifications.comment > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-green-500 rounded-full animate-pulse">
                  {actionedTabNotifications.comment}
                </span>
              )}
            </div>
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'completed'
                ? 'text-primary border-b-2 border-primary bg-blue-50 dark:bg-blue-900/20'
                : 'text-gray-600 dark:text-gray-400 hover:text-primary'
            }`}
          >
            ✅ المهام المكتملة
            <div className="flex items-center gap-1 ml-2">
              {completedTabNotifications.assignment > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full animate-pulse">
                  {completedTabNotifications.assignment}
                </span>
              )}
              {completedTabNotifications.comment > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-green-500 rounded-full animate-pulse">
                  {completedTabNotifications.comment}
                </span>
              )}
            </div>
          </button>
          <button
            onClick={() => setActiveTab('updates')}
            className={`px-6 py-3 font-medium transition-colors ${
              activeTab === 'updates'
                ? 'text-primary border-b-2 border-primary bg-blue-50 dark:bg-blue-900/20'
                : 'text-gray-600 dark:text-gray-400 hover:text-primary'
            }`}
          >
            🕒 آخر التحديثات
          </button>
        </div>
      </div>

      {/* --- عرض المهام حسب التبويب النشط --- */}
      {activeTab === 'updates' && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-content border-b-2 border-purple-500 pb-2">آخر التحديثات</h1>
            </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={exportActivityLog}
              className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 flex items-center gap-2"
            >
              <ClipboardCopy size={16} />
              تصدير للطباعة
            </button>
            <button
              type="button"
              onClick={() => fetchActivity(0)}
              className="bg-primary text-white px-4 py-2 rounded-md hover:bg-primary-dark"
            >
              تحديث
            </button>
          </div>
          </div>

          {activityInfoMsg && (
            <div className="mb-4 text-sm text-center text-content-secondary bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md py-2 px-3">
              {activityInfoMsg}
            </div>
          )}

          {isLoadingActivity && activityItems.length === 0 ? (
            <div className="flex justify-center items-center py-8">
              <Loader2 className="animate-spin mr-2" />
              <span>جاري تحميل آخر التحديثات...</span>
            </div>
          ) : activityError ? (
            <p className="text-red-500 text-center py-4">{activityError}</p>
          ) : activityItems.length > 0 ? (
            <div className="space-y-4">
              {activityItems.map((item) => {
                const key = `${item.ItemType}-${item.SubtaskID ?? item.CommentID ?? item.TaskID}-${item.CreatedAt}`;
                
                let icon = <ClipboardList className="text-blue-500" size={20} />;
                let label = 'مهمة جديدة';
                let bgColor = 'bg-blue-50 dark:bg-blue-900/10';

                if (item.ItemType === 'subtask') {
                  icon = <CheckSquare className="text-purple-500" size={20} />;
                  label = 'مهمة فرعية جديدة';
                  bgColor = 'bg-purple-50 dark:bg-purple-900/10';
                } else if (item.ItemType === 'comment') {
                  icon = <MessageCircle className="text-green-500" size={20} />;
                  label = 'تعليق جديد';
                  bgColor = 'bg-green-50 dark:bg-green-900/10';
                }

                const actor = item.ActorName || item.ActorID || 'مستخدم غير معروف';
                const isCompleted = item.TaskStatus === 'completed';

                return (
                  <div
                    key={key}
                    className={`p-4 border rounded-lg shadow-sm transition-all hover:shadow-md ${bgColor} border-content/10`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="mt-1 flex-shrink-0 bg-white dark:bg-gray-800 p-2 rounded-full shadow-sm">
                        {icon}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-bold text-content text-lg">{label}</span>
                          <span className="text-xs text-content-secondary flex items-center gap-1 bg-white dark:bg-gray-800 px-2 py-1 rounded-full shadow-sm">
                            <Clock size={12} />
                            {new Date(item.CreatedAt).toLocaleString('ar-EG')}
                          </span>
                        </div>

                        <div className="text-sm text-content mb-2">
                          <span className="text-content-secondary">في المهمة: </span>
                          <Link 
                            to={`/task/${item.TaskID}`} 
                            className={`font-medium hover:underline ${isCompleted ? 'text-gray-500 line-through decoration-gray-400' : 'text-primary'}`}
                          >
                            {item.TaskTitle}
                          </Link>
                          {isCompleted && (
                            <span className="inline-flex items-center gap-1 mr-2 text-xs font-medium text-green-600 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
                              <CheckCircle size={10} />
                              مكتملة
                            </span>
                          )}
                        </div>

                        {item.ItemType === 'subtask' && item.SubtaskTitle && (
                          <div className="bg-white/60 dark:bg-black/20 p-3 rounded-md border border-content/5 mb-2">
                            <div className="flex items-center gap-2 text-content font-medium">
                              <CheckSquare size={16} className="text-content-secondary" />
                              {item.SubtaskTitle}
                            </div>
                          </div>
                        )}

                        {item.ItemType === 'comment' && item.CommentContent && (
                          <div className="bg-white/60 dark:bg-black/20 p-3 rounded-md border border-content/5 mb-2">
                            <div className="text-content whitespace-pre-wrap text-sm leading-relaxed">
                              "{item.CommentContent}"
                            </div>
                          </div>
                        )}

                        <div className="flex items-center gap-2 mt-2 text-xs text-content-secondary flex-wrap">
                          <div className="flex items-center gap-1 bg-white dark:bg-gray-800 px-2 py-1 rounded-full border border-content/10">
                            <User size={12} />
                            <span>بواسطة: <span className="font-medium text-content">{actor}</span></span>
                          </div>

                          {item.AssignedToName && (
                            <div className="flex items-center gap-1 bg-white dark:bg-gray-800 px-2 py-1 rounded-full border border-content/10">
                              <Users size={12} />
                              <span>مسند إلى: <span className="font-medium text-content">{item.AssignedToName}</span></span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {/* زر تحميل المزيد */}
              {activityHasMore && (
                <div className="flex justify-center pt-4">
                  <button
                    onClick={loadMoreActivity}
                    disabled={isLoadingActivity}
                    className="bg-primary text-white px-6 py-2 rounded-md hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isLoadingActivity ? <Loader2 className="animate-spin" size={16} /> : null}
                    {isLoadingActivity ? 'جاري التحميل...' : 'تحميل المزيد (7 أيام سابقة)'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8">
              <p className="text-content-secondary mb-4">لا توجد تحديثات في الفترة الحالية.</p>
              {activityHasMore ? (
                <button
                  onClick={loadMoreActivity}
                  disabled={isLoadingActivity}
                  className="bg-primary text-white px-6 py-2 rounded-md hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isLoadingActivity ? <Loader2 className="animate-spin" size={16} /> : null}
                  {isLoadingActivity ? 'جاري التحميل...' : 'تحميل فترة سابقة (7 أيام قبل ذلك)'}
                </button>
              ) : (
                <p className="text-xs text-gray-400">تم الوصول إلى الحدّ الأقصى للبحث في الأنشطة (سنة كاملة).</p>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'active' && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-content border-b-2 border-primary pb-2">المهام النشطة</h1>
              {searchTerm.trim() && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                  عُثر على {activeTasks.length} مهمة نشطة تطابق البحث
                </p>
              )}
            </div>
          </div>
          {activeTasks.length > 0 ? (
            layoutMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {activeTasks.map(task => (
                  <TaskCard 
                    key={task.TaskID} 
                    task={task} 
                    onPriorityChange={updateTaskPriority}
                    isSelectionMode={isSelectionMode}
                    isSelected={selectedTasks.has(task.TaskID)}
                    onToggleSelection={toggleTaskSelection}
                    isMySubtask={isMySubtaskByVacancyId}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {activeTasks.map(task => (
                  <TaskCard 
                    key={task.TaskID} 
                    task={task} 
                    onPriorityChange={updateTaskPriority}
                    isSelectionMode={isSelectionMode}
                    isSelected={selectedTasks.has(task.TaskID)}
                    onToggleSelection={toggleTaskSelection}
                    isMySubtask={isMySubtaskByVacancyId}
                  />
                ))}
              </div>
            )
          ) : (
            <p className="text-content-secondary text-center py-4">
              {searchTerm.trim() 
                ? `لم يتم العثور على مهام نشطة تطابق البحث "${searchTerm}"`
                : "لا توجد مهام نشطة حالياً. عمل رائع!"
              }
            </p>
          )}
        </div>
      )}


      

      {activeTab === 'actioned' && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-content border-b-2 border-orange-500 pb-2">تم اتخاذ الاجراء فيها</h1>
              {searchTerm.trim() && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                  عُثر على {actionedTasks.length} مهمة تم اتخاذ إجراء فيها تطابق البحث
                </p>
              )}
            </div>
          </div>
          {actionedTasks.length > 0 ? (
            layoutMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {actionedTasks.map(task => (
                  <TaskCard 
                    key={task.TaskID} 
                    task={task} 
                    onPriorityChange={updateTaskPriority}
                    isSelectionMode={isSelectionMode}
                    isSelected={selectedTasks.has(task.TaskID)}
                    onToggleSelection={toggleTaskSelection}
                    isMySubtask={isMySubtaskByVacancyId}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {actionedTasks.map(task => (
                  <TaskCard 
                    key={task.TaskID} 
                    task={task} 
                    onPriorityChange={updateTaskPriority}
                    isSelectionMode={isSelectionMode}
                    isSelected={selectedTasks.has(task.TaskID)}
                    onToggleSelection={toggleTaskSelection}
                    isMySubtask={isMySubtaskByVacancyId}
                  />
                ))}
              </div>
            )
          ) : (
            <p className="text-content-secondary text-center py-4">
              {searchTerm.trim() 
                ? `لم يتم العثور على مهام تم اتخاذ إجراء فيها تطابق البحث "${searchTerm}"`
                : "لا توجد مهام تم اتخاذ إجراء فيها حالياً."
              }
            </p>
          )}
        </div>
      )}

      {activeTab === 'completed' && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-content-secondary border-b-2 border-green-500 pb-2">المهام المكتملة</h1>
              {searchTerm.trim() && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                  عُثر على {completedTasks.length} مهمة مكتملة تطابق البحث
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
            <div className="flex justify-center sm:justify-start">
              <button
                onClick={loadMoreCompletedTasks}
                disabled={isLoadingCompleted || !completedHasMore}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  isLoadingCompleted || !completedHasMore
                    ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                    : 'bg-green-500 text-white hover:bg-green-600'
                }`}
              >
                {isLoadingCompleted
                  ? 'جاري جلب المهام المكتملة...'
                  : completedHasMore
                    ? 'جلب 10 مهام مكتملة إضافية'
                    : 'لا توجد مهام مكتملة أخرى للعرض'}
              </button>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <button
                onClick={searchCompletedTasksInDb}
                disabled={isSearchingCompleted || !searchTerm.trim()}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  isSearchingCompleted || !searchTerm.trim()
                    ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                {isSearchingCompleted ? 'جاري البحث في قاعدة البيانات...' : 'بحث في المهام المكتملة من قاعدة البيانات'}
              </button>
              {!searchTerm.trim() && (
                <span className="text-xs text-gray-500 text-center sm:text-right">
                  أدخل كلمة في مربع البحث بالأعلى ثم اضغط زر البحث هنا.
                </span>
              )}
            </div>
          </div>
          {completedTasks.length > 0 ? (
            layoutMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 opacity-80">
                {completedTasks.map(task => (
                  <TaskCard 
                    key={task.TaskID} 
                    task={task} 
                    onPriorityChange={updateTaskPriority}
                    isSelectionMode={isSelectionMode}
                    isSelected={selectedTasks.has(task.TaskID)}
                    onToggleSelection={toggleTaskSelection}
                    isMySubtask={isMySubtaskByVacancyId}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-4 opacity-80">
                {completedTasks.map(task => (
                  <TaskCard 
                    key={task.TaskID} 
                    task={task} 
                    onPriorityChange={updateTaskPriority}
                    isSelectionMode={isSelectionMode}
                    isSelected={selectedTasks.has(task.TaskID)}
                    onToggleSelection={toggleTaskSelection}
                    isMySubtask={isMySubtaskByVacancyId}
                  />
                ))}
              </div>
            )
          ) : (
            <p className="text-content-secondary text-center py-4">
              {searchTerm.trim() 
                ? `لم يتم العثور على مهام مكتملة تطابق البحث "${searchTerm}"`
                : null}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskList;

// جلب المهام الفرعية والتعليقات لكل مهمة لكن مع تحديد حد أقصى للتوازي (BATCH_SIZE) للحد من العواصف وتقليل أخطاء net::ERR_INSUFFICIENT_RESOURCES. كذلك تطبيق نفس النهج على جلب المهام الفرعية والتعليقات والأولوية.

