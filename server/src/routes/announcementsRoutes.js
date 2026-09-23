const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/announcementsController');

router.get('/', ctrl.getAnnouncements);
router.get('/unread-count', ctrl.getUnreadCount);
router.post('/mark-all-read', ctrl.markAllAsRead);
router.post('/:id/read', ctrl.markAsRead);
router.post('/', ctrl.createAnnouncement);
router.put('/:id', ctrl.updateAnnouncement);
router.delete('/:id', ctrl.deleteAnnouncement);

module.exports = router;
