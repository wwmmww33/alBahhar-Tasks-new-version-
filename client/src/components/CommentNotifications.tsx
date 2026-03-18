import React, { useState, useEffect } from 'react';
import { Bell, MessageCircle, CheckCheck } from 'lucide-react';

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

interface CommentNotificationsProps {
  userId: string;
  onNotificationClick?: (taskId: number) => void;
}

const CommentNotifications: React.FC<CommentNotificationsProps> = ({ 
  userId, 
  onNotificationClick 
}) => {
  const [notifications, setNotifications] = useState<CommentNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // جلب عدد الإشعارات غير المقروءة
  const fetchUnreadCount = async () => {
    try {
      const response = await fetch(`/api/comment-notifications/user/${userId}/unread-count`);
      if (!response.ok) return;
      try {
        const data = await response.json();
        if (data && (data.success || typeof data.unreadCount === 'number')) {
          setUnreadCount(typeof data.unreadCount === 'number' ? data.unreadCount : 0);
        }
      } catch {
        // تجاهل أخطاء JSON
      }
    } catch (error) {
      console.error('خطأ في جلب عدد الإشعارات:', error);
    }
  };

  // جلب الإشعارات
  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/comment-notifications/user/${userId}`);
      if (!response.ok) return;
      try {
        const data = await response.json();
        if (data && data.success && Array.isArray(data.notifications)) {
          setNotifications(data.notifications);
        }
      } catch {
        // تجاهل أخطاء JSON
      }
    } catch (error) {
      console.error('خطأ في جلب الإشعارات:', error);
    } finally {
      setLoading(false);
    }
  };

  // تحديد الإشعار كمقروء
  const markAsRead = async (notificationId: number) => {
    try {
      const response = await fetch(`/api/comment-notifications/${notificationId}/read`, {
        method: 'PUT'
      });
      if (!response.ok) return;
      try {
        const data = await response.json();
        if (data && data.success) {
          setNotifications(prev => 
            prev.map(notif => 
              notif.NotificationID === notificationId 
                ? { ...notif, IsRead: true, ReadAt: new Date().toISOString() }
                : notif
            )
          );
          fetchUnreadCount();
        }
      } catch {
        // إذا كانت الاستجابة بدون JSON، اعتبرها نجاحًا طالما أنها ok
        setNotifications(prev => 
          prev.map(notif => 
            notif.NotificationID === notificationId 
              ? { ...notif, IsRead: true, ReadAt: new Date().toISOString() }
              : notif
          )
        );
        fetchUnreadCount();
      }
    } catch (error) {
      console.error('خطأ في تحديد الإشعار كمقروء:', error);
    }
  };

  // تحديد جميع الإشعارات كمقروءة
  const markAllAsRead = async () => {
    try {
      const response = await fetch(`/api/comment-notifications/user/${userId}/mark-all-read`, {
        method: 'PUT'
      });
      if (!response.ok) return;
      try {
        const data = await response.json();
        if (data && data.success) {
          setNotifications(prev => 
            prev.map(notif => ({ 
              ...notif, 
              IsRead: true, 
              ReadAt: new Date().toISOString() 
            }))
          );
          setUnreadCount(0);
        }
      } catch {
        // إذا كانت الاستجابة بدون JSON، اعتبر العملية ناجحة طالما أنها ok
        setNotifications(prev => 
          prev.map(notif => ({ 
            ...notif, 
            IsRead: true, 
            ReadAt: new Date().toISOString() 
          }))
        );
        setUnreadCount(0);
      }
    } catch (error) {
      console.error('خطأ في تحديد جميع الإشعارات كمقروءة:', error);
    }
  };

  // تحديث عدد الإشعارات كل 30 ثانية
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [userId]);

  // جلب الإشعارات عند فتح القائمة
  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen]);

  const handleNotificationClick = (notification: CommentNotification) => {
    if (!notification.IsRead) {
      markAsRead(notification.NotificationID);
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

  return (
    <div className="relative">
      {/* زر الإشعارات */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
        title="إشعارات التعليقات"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-green-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* قائمة الإشعارات */}
      {isOpen && (
        <div className="absolute left-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-96 overflow-hidden">
          {/* رأس القائمة */}
          <div className="p-3 border-b border-gray-200 flex justify-between items-center">
            <h3 className="font-semibold text-gray-800">إشعارات التعليقات</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm text-green-600 hover:text-green-800 flex items-center gap-1"
                title="تحديد الكل كمقروء"
              >
                <CheckCheck size={14} />
                تحديد الكل كمقروء
              </button>
            )}
          </div>

          {/* محتوى الإشعارات */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-gray-500">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600 mx-auto"></div>
                <p className="mt-2">جاري التحميل...</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                <MessageCircle size={32} className="mx-auto mb-2 text-gray-300" />
                <p>لا توجد إشعارات</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.NotificationID}
                  onClick={() => handleNotificationClick(notification)}
                  className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-green-50 transition-colors ${
                    !notification.IsRead ? 'bg-green-50 border-l-4 border-l-green-500' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      <MessageCircle 
                        size={16} 
                        className={notification.IsRead ? 'text-gray-400' : 'text-green-500'} 
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {notification.CommentedByUsername}
                        </p>
                        {!notification.IsRead && (
                          <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></div>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-1">
                        علق على: <span className="font-medium">{notification.TaskTitle}</span>
                      </p>
                      <p className="text-xs text-gray-500 line-clamp-2">
                        {notification.CommentContent}
                      </p>
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

export default CommentNotifications;