import React, { useState, useEffect, useCallback } from 'react';
import { Bell, MessageCircle, UserPlus, CheckCheck, RefreshCw } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

interface CommentNotification {
  NotificationID: number;
  CommentID: number;
  TaskID: number;
  CommentedByUserID: string;
  CommentedByVacancyID?: number | string | null;
  NotifyUserID: string;
  NotifyVacancyID?: number | string | null;
  NotificationType: string;
  IsRead: boolean;
  CreatedAt: string;
  ReadAt?: string;
  CommentContent: string;
  TaskTitle: string;
  CommentedByUsername: string;
}

interface AssignmentNotification {
  NotificationID: number;
  TaskID: number;
  AssignedToUserID: string;
  AssignedToVacancyID?: number | string | null;
  AssignedByUserID: string;
  AssignedByVacancyID?: number | string | null;
  IsRead: boolean;
  CreatedAt: string;
  ReadAt?: string;
  TaskTitle: string;
  AssignedByName: string;
}

interface UnifiedNotificationsProps {
  userId: string;
  onNotificationClick?: (taskId: number) => void;
}

const UnifiedNotifications: React.FC<UnifiedNotificationsProps> = ({ 
  userId, 
  onNotificationClick 
}) => {
  const { refreshTasks, setRefreshNotifications } = useNotification();
  const [commentNotifications, setCommentNotifications] = useState<CommentNotification[]>([]);
  const [assignmentNotifications, setAssignmentNotifications] = useState<AssignmentNotification[]>([]);
  const [commentUnreadCount, setCommentUnreadCount] = useState(0);
  const [assignmentUnreadCount, setAssignmentUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // جلب عدد إشعارات التعليقات غير المقروءة
  const fetchCommentUnreadCount = useCallback(async () => {
    try {
      const response = await fetch(`/api/comment-notifications/user/${userId}/unread-count`);
      if (!response.ok) return;
      try {
        const data = await response.json();
        if (data && (data.success || typeof data.unreadCount === 'number')) {
          setCommentUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : 0);
        }
      } catch {
        // تجاهل أخطاء JSON
      }
    } catch (error) {
      console.error('خطأ في جلب عدد إشعارات التعليقات:', error);
    }
  }, [userId]);

  // جلب عدد إشعارات الإسناد غير المقروءة
  const fetchAssignmentUnreadCount = useCallback(async () => {
    try {
      const response = await fetch(`/api/tasks/assignment-notifications?userId=${userId}`);
      if (!response.ok) return;
      try {
        const data = await response.json();
        if (Array.isArray(data)) {
          setAssignmentUnreadCount(data.length);
        }
      } catch {
        // تجاهل أخطاء JSON
      }
    } catch (error) {
      console.error('خطأ في جلب عدد إشعارات الإسناد:', error);
    }
  }, [userId]);

  // جلب إشعارات التعليقات (غير المقروءة فقط)
  const fetchCommentNotifications = async () => {
    try {
      const response = await fetch(`/api/comment-notifications/user/${userId}?unreadOnly=true`);
      if (!response.ok) return;
      try {
        const data = await response.json();
        if (data && data.success && Array.isArray(data.notifications)) {
          setCommentNotifications(data.notifications);
        }
      } catch {
        // تجاهل أخطاء JSON
      }
    } catch (error) {
      console.error('خطأ في جلب إشعارات التعليقات:', error);
    }
  };

  // جلب إشعارات الإسناد
  const fetchAssignmentNotifications = async () => {
    try {
      const response = await fetch(`/api/tasks/assignment-notifications?userId=${userId}`);
      if (!response.ok) return;
      try {
        const data = await response.json();
        if (Array.isArray(data)) {
          setAssignmentNotifications(data);
        }
      } catch {
        // تجاهل أخطاء JSON
      }
    } catch (error) {
      console.error('خطأ في جلب إشعارات الإسناد:', error);
    }
  };

  // تحديث العدادات والجلب
  const updateNotificationCounts = useCallback(async () => {
    try {
      await Promise.all([
        fetchCommentUnreadCount(),
        fetchAssignmentUnreadCount()
      ]);
    } catch (err) {
      console.error('خطأ أثناء تحديث العدادات:', err);
    }
  }, [fetchCommentUnreadCount, fetchAssignmentUnreadCount]);

  const fetchAllNotifications = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchCommentNotifications(),
        fetchAssignmentNotifications()
      ]);
    } catch (err) {
      console.error('خطأ أثناء جلب جميع الإشعارات:', err);
    } finally {
      setLoading(false);
    }
  };

  // تحديد إشعار التعليق كمقروء
  const markCommentAsRead = async (notificationId: number) => {
    try {
      const response = await fetch(`/api/comment-notifications/${notificationId}/read`, {
        method: 'PUT'
      });
      if (!response.ok) return;
      try {
        const data = await response.json();
        if (data && data.success) {
          setCommentNotifications(prev => 
            prev.map(notif => 
              notif.NotificationID === notificationId 
                ? { ...notif, IsRead: true, ReadAt: new Date().toISOString() }
                : notif
            )
          );
          await updateNotificationCounts();
        }
      } catch {
        // إذا كانت الاستجابة بدون JSON، اعتبرها نجاحًا طالما أنها ok
        setCommentNotifications(prev => 
          prev.map(notif => 
            notif.NotificationID === notificationId 
              ? { ...notif, IsRead: true, ReadAt: new Date().toISOString() }
              : notif
          )
        );
        await updateNotificationCounts();
      }
    } catch (error) {
      console.error('خطأ في تحديد إشعار التعليق كمقروء:', error);
    }
  };

  // تحديد إشعار الإسناد كمقروء
  const markAssignmentAsRead = async (notificationId: number) => {
    try {
      const response = await fetch(`/api/tasks/assignment-notifications/${notificationId}/read`, {
        method: 'PATCH'
      });
      if (!response.ok) return;
      // لا تعتمد على JSON هنا لأن الخادم يعيد رسالة فقط
      setAssignmentNotifications(prev => 
        prev.map(notif => 
          notif.NotificationID === notificationId 
            ? { ...notif, IsRead: true, ReadAt: new Date().toISOString() }
            : notif
        )
      );
      await updateNotificationCounts();
    } catch (error) {
      console.error('خطأ في تحديد إشعار الإسناد كمقروء:', error);
    }
  };

  // تحديد جميع إشعارات التعليقات كمقروءة
  const markAllCommentsAsRead = async () => {
    try {
      const response = await fetch(`/api/comment-notifications/user/${userId}/mark-all-read`, {
        method: 'PUT'
      });
      if (!response.ok) return;
      try {
        const data = await response.json();
        if (data && data.success) {
          setCommentNotifications(prev => 
            prev.map(notif => 
              ({ ...notif, IsRead: true, ReadAt: new Date().toISOString() })
            )
          );
          setCommentUnreadCount(0);
        }
      } catch {
        // إذا كانت الاستجابة بدون JSON، اعتبر العملية ناجحة طالما أنها ok
        setCommentNotifications(prev => 
          prev.map(notif => ({ ...notif, IsRead: true, ReadAt: new Date().toISOString() }))
        );
        setCommentUnreadCount(0);
      }
    } catch (error) {
      console.error('خطأ في تحديد جميع إشعارات التعليقات كمقروءة:', error);
    }
  };

  // تحديث يدوي للبيانات
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await updateNotificationCounts();
      if (refreshTasks) {
        refreshTasks();
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // تسجيل دالة تحديث الإشعارات في السياق لتمكين التحديث الفوري من أماكن أخرى
  useEffect(() => {
    setRefreshNotifications(async () => {
      await updateNotificationCounts();
    });
  }, [setRefreshNotifications, updateNotificationCounts]);

  // تحديث عدادات الإشعارات فورًا وعند الفاصل الزمني المحدد
  useEffect(() => {
    // تحديث عدادات الإشعارات فورًا وعند الفاصل الزمني المحدد
    updateNotificationCounts();
    const interval = setInterval(updateNotificationCounts, 30000);
    
    // تحديث الإشعارات فقط عند عودة التركيز إلى النافذة
    const handleFocus = () => {
      updateNotificationCounts();
    };
    window.addEventListener('focus', handleFocus);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [updateNotificationCounts]);

  // جلب الإشعارات عند فتح القائمة
  useEffect(() => {
    if (isOpen) {
      fetchAllNotifications();
    }
  }, [isOpen]);

  const handleNotificationClick = (notification: CommentNotification | AssignmentNotification, type: 'comment' | 'assignment') => {
    if (!notification.IsRead) {
      if (type === 'comment') {
        markCommentAsRead(notification.NotificationID);
      } else {
        markAssignmentAsRead(notification.NotificationID);
      }
    }
    if (onNotificationClick) {
      onNotificationClick(notification.TaskID);
    }
    setIsOpen(false);
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'الآن';
    if (diffInMinutes < 60) return `منذ ${diffInMinutes} دقيقة`;
    if (diffInMinutes < 1440) return `منذ ${Math.floor(diffInMinutes / 60)} ساعة`;
    return `منذ ${Math.floor(diffInMinutes / 1440)} يوم`;
  };

  const totalUnreadCount = commentUnreadCount + assignmentUnreadCount;
  const allNotifications = [
    ...commentNotifications.map(n => ({ ...n, type: 'comment' as const })),
    ...assignmentNotifications.map(n => ({ ...n, type: 'assignment' as const }))
  ].sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());

  return (
    <div className="relative">
      {/* زر الإشعارات مع المؤشرات الملونة */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
        title="الإشعارات"
      >
        <Bell size={20} />
        
        {/* مؤشر إشعارات التعليقات (أخضر - يسار) */}
        {commentUnreadCount > 0 && (
          <span className="absolute -top-1 -left-1 bg-green-500 text-white text-[10px] rounded-full h-4 min-w-[1.25rem] px-1 flex items-center justify-center">
            {commentUnreadCount > 99 ? '99+' : commentUnreadCount}
          </span>
        )}
        
        {/* مؤشر إشعارات المهام الفرعية (أحمر - يمين) */}
        {assignmentUnreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full h-4 min-w-[1.25rem] px-1 flex items-center justify-center">
            {assignmentUnreadCount > 99 ? '99+' : assignmentUnreadCount}
          </span>
        )}
        
        {/* مؤشر إجمالي في المنتصف إذا لم توجد إشعارات منفصلة */}
        {totalUnreadCount > 0 && commentUnreadCount === 0 && assignmentUnreadCount === 0 && (
          <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
            {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
          </span>
        )}
      </button>

      {/* قائمة الإشعارات */}
      {isOpen && (
        <div className="absolute left-0 mt-2 w-96 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-96 overflow-hidden">
          {/* رأس القائمة */}
          <div className="p-3 border-b border-gray-200 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-800">الإشعارات</h3>
              <div className="flex gap-1">
                {commentUnreadCount > 0 && (
                  <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
                    {commentUnreadCount} تعليق
                  </span>
                )}
                {assignmentUnreadCount > 0 && (
                  <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">
                    {assignmentUnreadCount} مهمة
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1 disabled:opacity-50"
                title="تحديث"
              >
                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              </button>
              {commentUnreadCount > 0 && (
                <button
                  onClick={markAllCommentsAsRead}
                  className="text-sm text-green-600 hover:text-green-800 flex items-center gap-1"
                  title="تحديد تعليقات كمقروءة"
                >
                  <CheckCheck size={14} />
                </button>
              )}
            </div>
          </div>

          {/* محتوى الإشعارات */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-gray-500">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600 mx-auto"></div>
                <p className="mt-2">جاري التحميل...</p>
              </div>
            ) : allNotifications.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                <Bell size={32} className="mx-auto mb-2 text-gray-300" />
                <p>لا توجد إشعارات</p>
              </div>
            ) : (
              allNotifications.map((notification) => (
                <div
                  key={`${notification.type}-${notification.NotificationID}`}
                  onClick={() => handleNotificationClick(notification, notification.type)}
                  className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                    !notification.IsRead ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      {notification.type === 'comment' ? (
                        <MessageCircle 
                          size={16} 
                          className={notification.IsRead ? 'text-gray-400' : 'text-green-500'} 
                        />
                      ) : (
                        <UserPlus 
                          size={16} 
                          className={notification.IsRead ? 'text-gray-400' : 'text-red-500'} 
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {notification.type === 'comment' 
                            ? (notification as CommentNotification).CommentedByUsername
                            : (notification as AssignmentNotification).AssignedByName
                          }
                        </p>
                        {!notification.IsRead && (
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            notification.type === 'comment' ? 'bg-green-500' : 'bg-red-500'
                          }`}></div>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-1">
                        {notification.type === 'comment' ? 'علق على: ' : 'أسند إليك مهمة: '}
                        <span className="font-medium">{notification.TaskTitle}</span>
                      </p>
                      {notification.type === 'comment' && (
                        <p className="text-xs text-gray-500 line-clamp-2">
                          {(notification as CommentNotification).CommentContent}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {formatTimeAgo(notification.CreatedAt)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* خلفية لإغلاق القائمة */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setIsOpen(false)}
        ></div>
      )}
    </div>
  );
};

export default UnifiedNotifications;
