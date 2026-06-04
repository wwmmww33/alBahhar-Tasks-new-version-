const express = require('express');
const router = express.Router();
const commentNotificationController = require('../controllers/commentNotificationController');
const { authenticateToken } = require('../middleware/auth');

// جلب إشعارات التعليقات للمستخدم (المصادقة مطلوبة — يعرض فقط إشعارات المستخدم الحالي)
router.get('/user/:userId', authenticateToken, commentNotificationController.getCommentNotifications);

// عدد الإشعارات غير المقروءة
router.get('/user/:userId/unread-count', authenticateToken, commentNotificationController.getUnreadNotificationsCount);

// تحديد الإشعار كمقروء
router.put('/:notificationId/read', authenticateToken, commentNotificationController.markNotificationAsRead);

// تحديد جميع الإشعارات كمقروءة
router.put('/user/:userId/mark-all-read', authenticateToken, commentNotificationController.markAllNotificationsAsRead);

// عدد الإشعارات غير المقروءة لمهمة معينة
router.get('/task/:taskId/user/:userId/unread-count', authenticateToken, commentNotificationController.getUnreadNotificationsCountForTask);

// تحديد إشعارات التعليقات كمقروءة لمهمة معينة
router.put('/task/:taskId/user/:userId/mark-read', authenticateToken, commentNotificationController.markTaskCommentNotificationsAsRead);

module.exports = router;