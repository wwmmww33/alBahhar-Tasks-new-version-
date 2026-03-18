// src/routes/taskRoutes.js
const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');

// --- الترتيب الصحيح للمسارات ---

// GET /api/tasks (للحصول على كل المهام غير المكتملة)
router.get('/', taskController.getAllTasks);

// GET /api/tasks/with-notifications (للحصول على المهام مع الإشعارات - غير المكتملة فقط)
router.get('/with-notifications', taskController.getTasksWithNotifications);

// GET /api/tasks/activity (للحصول على آخر التحديثات: مهمة/مهمة فرعية/تعليق)
router.get('/activity', taskController.getTaskActivity);

// GET /api/tasks/completed (للحصول على المهام المكتملة/الملغاة عند الحاجة)
router.get('/completed', taskController.getCompletedTasks);

// GET /api/tasks/completed/search (للبحث في المهام المكتملة/الملغاة في قاعدة البيانات)
router.get('/completed/search', taskController.searchCompletedTasks);

// GET /api/tasks/assignment-notifications (للحصول على إشعارات الإسناد)
router.get('/assignment-notifications', taskController.getAssignmentNotifications);

// PATCH /api/tasks/assignment-notifications/1/read (لتحديد إشعار كمقروء)
router.patch('/assignment-notifications/:notificationId/read', taskController.markAssignmentNotificationAsRead);

// POST /api/tasks (لإنشاء مهمة جديدة)
router.post('/', taskController.createTask);

// GET /api/tasks/department/1/users (يجب أن يكون قبل /:id)
router.get('/department/:departmentId/users', taskController.getUsersByDepartment);

// GET /api/tasks/1 (للحصول على مهمة محددة)
router.get('/:id', taskController.getTaskById);

// PATCH /api/tasks/1/status (لتحديث حالة مهمة)
router.patch('/:id/status', taskController.updateTaskStatus);

// PATCH /api/tasks/1/category (لتحديث تصنيف مهمة)
router.patch('/:taskId/category', taskController.updateTaskCategory);

// PATCH /api/tasks/1/assign (لإسناد المهمة الرئيسية)
router.patch('/:id/assign', taskController.assignTask);

// PUT /api/tasks/1/priority (لتحديث أولوية مهمة - الطريقة القديمة)
router.put('/:id/priority', taskController.updateTaskPriority);

// PUT /api/tasks/1/user-priority (لتحديث الأولوية الشخصية للمستخدم)
router.put('/:id/user-priority', taskController.updateUserTaskPriority);

// PUT /api/tasks/1/view (لتحديث عرض المهمة)
router.put('/:taskId/view', taskController.updateTaskView);

// PATCH /api/tasks/1/url (لتحديث رابط المهمة الخارجي)
router.patch('/:id/url', taskController.updateTaskUrl);

// PATCH /api/tasks/1/title (لتحديث عنوان المهمة)
router.patch('/:id/title', taskController.updateTaskTitle);

// GET /api/tasks/1/user-priority (للحصول على الأولوية الشخصية للمستخدم)
router.get('/:id/user-priority', taskController.getUserTaskPriority);

// GET /api/tasks/1/subtasks (للحصول على المهام الفرعية)
router.get('/:id/subtasks', taskController.getSubtasksForTask);

// GET /api/tasks/1/comments (للحصول على التعليقات)
router.get('/:id/comments', taskController.getCommentsForTask);

// DELETE /api/tasks/1 (لحذف مهمة كاملة مع مهامها الفرعية)
router.delete('/:id', taskController.deleteTask);

module.exports = router;
