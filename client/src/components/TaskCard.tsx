// src/components/TaskCard.tsx
import { User, Calendar, Flag, AlertTriangle, CheckSquare } from 'lucide-react';
// import { useNotification } from '../contexts/NotificationContext';
import type { Subtask } from '../types';

// تعريف Task محلي مع Status إضافي
type TaskCardTask = {
  TaskID: number;
  Title: string;
  Description?: string;
  CreatedBy: string;
  CreatedByVacancyID?: number | string | null;
  CreatedByName?: string | null;
  ActedBy?: string | null;
  LastActedByVacancyID?: number | string | null;
  ActedByName?: string | null;
  AssignedTo?: string | null;
  AssignedToVacancyID?: number | string | null;
  AssignedToName: string | null;
  DueDate: string | null;
  Status: string;
  Priority: string;
  subtasks?: Subtask[];
  HasNewSubtasks?: boolean;
  HasAssignmentNotifications?: number;
  HasCommentNotifications?: number;
};

const statusStyles: { [key: string]: { bg: string; text: string; label: string } } = { 
  open: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-800 dark:text-gray-200', label: 'مفتوحة' }, 
  'in-progress': { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-200', label: 'قيد التنفيذ' }, 
  completed: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-200', label: 'مكتملة' }, 
  cancelled: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-200', label: 'ملغاة' },
};

interface TaskCardProps {
  task: TaskCardTask;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (taskId: number) => void;
  onPriorityChange?: (taskId: number, newPriority: 'normal' | 'urgent' | 'starred') => Promise<void>;
  isMySubtask?: (subtask: Subtask) => boolean;
}

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelection,
  onPriorityChange,
  isMySubtask
}) => {
  const style = statusStyles[task.Status] || statusStyles.open;
  
  // تحديد لون الحدود والخلفية حسب الأولوية
  const priorityStyles = task.Priority === 'urgent'
    ? 'border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20 dark:border-red-400'
    : 'border-l-4 border-blue-500 bg-white dark:bg-gray-800 dark:border-blue-400';

  // الحصول على المهام الفرعية غير المكتملة مع إظهار مهام المستخدم أولاً
  const incompleteSubtasksRaw = task.subtasks?.filter(subtask => !subtask.IsCompleted) || [];
  const incompleteSubtasks = isMySubtask
    ? [
        ...incompleteSubtasksRaw.filter(st => isMySubtask(st)),
        ...incompleteSubtasksRaw.filter(st => !isMySubtask(st)),
      ]
    : incompleteSubtasksRaw;
  
  // تحديد ما إذا كانت البطاقة تحتوي على إشعارات إسناد أو تعليقات
  const hasAssignmentNotifications = (task.HasAssignmentNotifications || 0) > 0;
  const hasCommentNotifications = (task.HasCommentNotifications || 0) > 0;

  const renderSubtaskRow = (subtask: Subtask) => {
    const isMine = isMySubtask ? isMySubtask(subtask) : false;
    if (isMine) {
      return (
        <div
          key={subtask.SubtaskID}
          className="flex items-center gap-2 text-xs rounded-md px-2 py-1 bg-blue-100 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-600 text-blue-800 dark:text-blue-200 font-medium"
        >
          <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 ring-2 ring-blue-300 dark:ring-blue-500"></div>
          <span className="truncate flex-1">{subtask.Title}</span>
          <span className="text-blue-500 dark:text-blue-400 font-bold whitespace-nowrap">← أنا</span>
        </div>
      );
    }
    return (
      <div key={subtask.SubtaskID} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-100">
        <div className="w-2 h-2 bg-orange-400 rounded-full flex-shrink-0"></div>
        <span className="truncate">{subtask.Title}</span>
        {subtask.AssignedToName && (
          <span className="text-gray-500 dark:text-gray-300">({subtask.AssignedToName})</span>
        )}
      </div>
    );
  };

  const handlePriorityClick = (e: React.MouseEvent, priority: 'normal' | 'urgent' | 'starred') => {
    e.preventDefault();
    e.stopPropagation();
    if (onPriorityChange) {
      onPriorityChange(task.TaskID, priority);
    }
  };

  const getCardClassName = () => {
    let baseClasses = 'bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md dark:hover:shadow-lg transition-all duration-200 relative';

    
    if (isSelectionMode) {
      baseClasses += isSelected ? ' ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-900/30' : ' hover:bg-gray-50 dark:hover:bg-gray-700';
    } else {
      // تطبيق ألوان البطاقة حسب نوع الإشعارات
      if (hasCommentNotifications) {
        baseClasses += ' border-l-4 border-green-500 dark:border-green-400 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 shadow-green-100 dark:shadow-green-900/20';
      } else if (hasAssignmentNotifications) {
        baseClasses += ' border-l-4 border-yellow-500 dark:border-yellow-400 bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-900/20 dark:to-amber-900/20 shadow-yellow-100 dark:shadow-yellow-900/20';
      } else {
        baseClasses += ' ' + priorityStyles;
      }
      baseClasses += ' hover:shadow-lg dark:hover:shadow-xl';
    }
    
    return baseClasses;
  };

  if (isSelectionMode) {
    return (
      <div onClick={() => onToggleSelection && onToggleSelection(task.TaskID)} className={getCardClassName()}>
        {/* خانة الاختيار في وضع الاختيار */}
        <div className="absolute top-2 left-2 z-10">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelection && onToggleSelection(task.TaskID)}
            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        <div className="p-4">
          {/* العنوان وأزرار الأولوية */}
          <div className="flex justify-between items-start mb-3">
            <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100 flex-1">#{task.TaskID} - {task.Title}</h3>
            <div className="flex items-center gap-2">
              {onPriorityChange && (
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={(e) => handlePriorityClick(e, 'urgent')}
                    className={`p-1 rounded transition-colors ${
                      task.Priority === 'urgent' 
                        ? 'bg-red-500 text-white' 
                        : 'bg-gray-200 text-gray-600 hover:bg-red-200'
                    }`}
                    title="تحديد كأولوية عاجلة"
                  >
                    <AlertTriangle size={12} />
                  </button>
                  <button
                    onClick={(e) => handlePriorityClick(e, 'normal')}
                    className={`p-1 rounded transition-colors ${
                      task.Priority === 'normal' 
                        ? 'bg-blue-500 text-white' 
                        : 'bg-gray-200 text-gray-600 hover:bg-blue-200'
                    }`}
                    title="أولوية عادية"
                  >
                    <Flag size={12} />
                  </button>
                </div>
              )}
              <span className={`px-3 py-1 text-xs font-semibold rounded-full ${style.bg} ${style.text}`}>
                {style.label}
              </span>
            </div>
          </div>

          {/* الوصف */}
          <p className="text-sm text-gray-600 dark:text-gray-100 line-clamp-2 mb-3">
            {task.Description}
          </p>

          {/* معلومات المهمة */}
          <div className="mt-4 space-y-3 text-sm text-gray-600 dark:text-gray-100">
            <div className="flex items-center gap-2"><User size={14} /><span>المنشيء: {(task.CreatedByName || task.CreatedBy || 'غير محدد')}{task.ActedBy ? ` بواسطة (${task.ActedByName || task.ActedBy})` : ''}</span></div>
            <div className="flex items-center gap-2"><Calendar size={14} /><span>تاريخ الاستحقاق: {task.DueDate ? new Date(task.DueDate).toLocaleDateString('ar-EG') : 'غير محدد'}</span></div>
            {task.Priority === 'urgent' && (<div className="flex items-center gap-2 text-red-600 font-semibold"><AlertTriangle size={14} /><span>أولوية عاجلة</span></div>)}
            
            {/* عرض المهام الفرعية غير المكتملة */}
            {incompleteSubtasks.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <CheckSquare size={14} className="text-blue-500" />
                  <span className="font-medium text-gray-700 dark:text-white">المهام الفرعية المتبقية ({incompleteSubtasks.length}):</span>
                </div>
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {incompleteSubtasks.slice(0, 4).map(subtask => renderSubtaskRow(subtask))}
                  {incompleteSubtasks.length > 4 && (
                    <div className="text-xs text-gray-500 dark:text-gray-300 italic">
                      و {incompleteSubtasks.length - 4} مهام فرعية أخرى...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* مؤشر الإشعارات */}
          {hasAssignmentNotifications && (
            <div className="mt-2 flex items-center text-xs text-blue-600 dark:text-blue-400">
              <div className="w-2 h-2 bg-blue-500 rounded-full mr-2 animate-pulse"></div>
              تحديثات جديدة
            </div>
          )}

          {/* تم إزالة مؤشر المهام الفرعية الجديدة لصالح نظام HasAssignmentNotifications الموحد */}
        </div>
      </div>
    );
  }

  return (
    <a href={`/task/${task.TaskID}`} target="_blank" rel="noreferrer" className={getCardClassName()}>
      <div className="p-4">
        {/* العنوان وأزرار الأولوية */}
        <div className="flex justify-between items-start mb-3">
          <h3 className="font-bold text-lg text-gray-800 dark:text-white flex-1">#{task.TaskID} - {task.Title}</h3>
          <div className="flex items-center gap-2">
            {onPriorityChange && (
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={(e) => handlePriorityClick(e, 'urgent')}
                  className={`p-1 rounded transition-colors ${
                    task.Priority === 'urgent' 
                      ? 'bg-red-500 text-white dark:bg-red-600' 
                      : 'bg-gray-200 text-gray-600 hover:bg-red-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-red-800/50'
                  }`}
                  title="تحديد كأولوية عاجلة"
                >
                  <AlertTriangle size={12} />
                </button>
                <button
                  onClick={(e) => handlePriorityClick(e, 'normal')}
                  className={`p-1 rounded transition-colors ${
                    task.Priority === 'normal' 
                      ? 'bg-blue-500 text-white dark:bg-blue-600' 
                      : 'bg-gray-200 text-gray-600 hover:bg-blue-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-blue-800/50'
                  }`}
                  title="أولوية عادية"
                >
                  <Flag size={12} />
                </button>
              </div>
            )}
            <span className={`px-3 py-1 text-xs font-semibold rounded-full ${style.bg} ${style.text}`}>
              {style.label}
            </span>
          </div>
        </div>

        {/* الوصف */}
        <p className="text-sm text-gray-600 dark:text-gray-100 line-clamp-2 mb-3">
          {task.Description}
        </p>

        {/* معلومات المهمة */}
        <div className="mt-4 space-y-3 text-sm text-gray-600 dark:text-gray-100">
          <div className="flex items-center gap-2"><User size={14} /><span>المنشيء: {(task.CreatedByName || task.CreatedBy || 'غير محدد')}{task.ActedBy ? ` بواسطة (${task.ActedByName || task.ActedBy})` : ''}</span></div>
          <div className="flex items-center gap-2"><Calendar size={14} /><span>تاريخ الاستحقاق: {task.DueDate ? new Date(task.DueDate).toLocaleDateString('ar-EG') : 'غير محدد'}</span></div>
          {task.Priority === 'urgent' && (<div className="flex items-center gap-2 text-red-600 font-semibold"><AlertTriangle size={14} /><span>أولوية عاجلة</span></div>)}
          
          {/* عرض المهام الفرعية غير المكتملة */}
          {incompleteSubtasks.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <CheckSquare size={14} className="text-blue-500" />
                <span className="font-medium text-gray-700 dark:text-white">المهام الفرعية المتبقية ({incompleteSubtasks.length}):</span>
              </div>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {incompleteSubtasks.slice(0, 4).map(subtask => renderSubtaskRow(subtask))}
                {incompleteSubtasks.length > 4 && (
                  <div className="text-xs text-gray-500 dark:text-gray-300 italic">
                    و {incompleteSubtasks.length - 4} مهام فرعية أخرى...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* مؤشر الإشعارات */}
        {hasAssignmentNotifications && (
          <div className="mt-2 flex items-center text-xs text-blue-600 dark:text-blue-400">
            <div className="w-2 h-2 bg-blue-500 rounded-full mr-2 animate-pulse"></div>
            تحديثات جديدة
          </div>
        )}

        {/* تم إزالة مؤشر المهام الفرعية الجديدة لصالح نظام HasAssignmentNotifications الموحد */}
      </div>
    </a>
  );
};

export default TaskCard;