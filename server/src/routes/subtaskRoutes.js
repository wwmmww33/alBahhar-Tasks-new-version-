// src/routes/subtaskRoutes.js
const express = require('express');
const router = express.Router();
const subtaskController = require('../controllers/subtaskController');

router.get('/', subtaskController.getAllSubtasks);
router.post('/', subtaskController.createSubtask);
router.patch('/:subtaskId', subtaskController.updateSubtaskStatus);
router.patch('/:subtaskId/assign', subtaskController.assignSubtask);
router.post('/:subtaskId/bulk-assign', subtaskController.bulkAssignSubtask);
// تحديث نص المهمة الفرعية وتاريخ الاستحقاق
router.patch('/:subtaskId/details', subtaskController.updateSubtaskDetails);
// تبديل إظهار المهمة الفرعية في التقويم
router.patch('/:subtaskId/calendar', subtaskController.updateSubtaskCalendarFlag);
router.patch('/:subtaskId/department-shares', subtaskController.setSubtaskDepartmentShares);
router.patch('/:subtaskId/broadcast-level', subtaskController.setSubtaskBroadcastLevel);
router.patch('/:subtaskId/public-broadcast', subtaskController.setSubtaskPublicBroadcast);
// نقل المهمة الفرعية إلى مهمة أخرى
router.patch('/:subtaskId/move', subtaskController.moveSubtask);
router.delete('/:subtaskId', subtaskController.deleteSubtask);
module.exports = router;