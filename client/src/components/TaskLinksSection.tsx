// src/components/TaskLinksSection.tsx
// غلاف موحّد يجمع "المهام المرتبطة" و"نسَب المهمة" في صندوق واحد أنيق
// بدل صندوقين منفصلين — كل قسم يُطوى تلقائيًا إن لم توجد بيانات لتوفير المساحة.
import RelatedTasksSection from './RelatedTasksSection';
import TaskLineageSection from './TaskLineageSection';

type ParentTask = { TaskID: number; Title: string; hasAccess: boolean };

type Props = {
  taskId: number;
  userId: string;
  isAdmin: boolean;
  isPersonal?: boolean;
  originalUserId?: string;
  deptId?: number | null;
  parentTask: ParentTask | null;
  onParentChanged: () => void;
};

const TaskLinksSection = ({
  taskId,
  userId,
  isAdmin,
  isPersonal,
  originalUserId,
  deptId,
  parentTask,
  onParentChanged,
}: Props) => {
  return (
    <div className="mt-6 border border-content/10 rounded-lg divide-y divide-content/10 overflow-hidden">
      <RelatedTasksSection
        taskId={taskId}
        userId={userId}
        isAdmin={isAdmin}
        isPersonal={isPersonal}
        originalUserId={originalUserId}
        deptId={deptId}
      />
      <TaskLineageSection
        taskId={taskId}
        userId={userId}
        isAdmin={isAdmin}
        parentTask={parentTask}
        deptId={deptId}
        onParentChanged={onParentChanged}
      />
    </div>
  );
};

export default TaskLinksSection;
