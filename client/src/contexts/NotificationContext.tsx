import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface NotificationContextType {
  viewedTasks: Set<number>;
  markTaskAsViewed: (taskId: number) => void;
  isTaskViewed: (taskId: number) => boolean;
  clearViewedTasks: () => void;
  refreshTasks: () => void;
  setRefreshTasks: (refreshFn: () => void) => void;
  refreshNotifications: () => void;
  setRefreshNotifications: (refreshFn: () => void) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};

interface NotificationProviderProps {
  children: ReactNode;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
  const [viewedTasks, setViewedTasks] = useState<Set<number>>(new Set());
  const [refreshTasksFn, setRefreshTasksFn] = useState<(() => void) | null>(null);
  const [refreshNotificationsFn, setRefreshNotificationsFn] = useState<(() => void) | null>(null);

  const markTaskAsViewed = useCallback((taskId: number) => {
    setViewedTasks(prev => new Set([...prev, taskId]));
  }, []);

  const isTaskViewed = useCallback((taskId: number) => {
    return viewedTasks.has(taskId);
  }, [viewedTasks]);

  const clearViewedTasks = useCallback(() => {
    setViewedTasks(new Set());
  }, []);

  const refreshTasks = useCallback(() => {
    if (refreshTasksFn) {
      refreshTasksFn();
    }
  }, [refreshTasksFn]);

  const setRefreshTasks = useCallback((refreshFn: () => void) => {
    setRefreshTasksFn(() => refreshFn);
  }, []);

  const refreshNotifications = useCallback(() => {
    if (refreshNotificationsFn) {
      refreshNotificationsFn();
    }
  }, [refreshNotificationsFn]);

  const setRefreshNotifications = useCallback((refreshFn: () => void) => {
    setRefreshNotificationsFn(() => refreshFn);
  }, []);

  const value: NotificationContextType = useMemo(() => ({
    viewedTasks,
    markTaskAsViewed,
    isTaskViewed,
    clearViewedTasks,
    refreshTasks,
    setRefreshTasks,
    refreshNotifications,
    setRefreshNotifications
  }), [
    viewedTasks,
    markTaskAsViewed,
    isTaskViewed,
    clearViewedTasks,
    refreshTasks,
    setRefreshTasks,
    refreshNotifications,
    setRefreshNotifications
  ]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};