const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/myNotificationsController');
const { authenticateToken } = require('../middleware/auth');

router.get('/unread-count',   authenticateToken, ctrl.getUnreadCount);
router.get('/',               authenticateToken, ctrl.getNotifications);
router.put('/mark-all-read',  authenticateToken, ctrl.markAllAsRead);
router.put('/:id/read',       authenticateToken, ctrl.markOneAsRead);

module.exports = router;
