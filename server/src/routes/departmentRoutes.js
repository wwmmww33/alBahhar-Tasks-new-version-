const express = require('express');
const router = express.Router();
const departmentController = require('../controllers/departmentController');
router.get('/', departmentController.getAllDepartments);
router.post('/', departmentController.createDepartment);
// الحد الأعلى لمستوى بث التقويم (مسارات ثابتة — يجب أن تسبق PUT /:id لتجنب تضارب المطابقة)
router.get('/max-broadcast-level', departmentController.getMaxBroadcastLevel);
router.put('/max-broadcast-level', departmentController.setMaxBroadcastLevel);
router.put('/public-calendar-settings', departmentController.setPublicCalendarSettings);
router.put('/:id', departmentController.updateDepartment);
router.delete('/:id', departmentController.deleteDepartment);
router.get('/:id/usage', departmentController.checkDepartmentUsage);
router.get('/:id/ancestor-chain', departmentController.getAncestorChain);
router.get('/:id/sharing-permission', departmentController.checkSharingPermission);
router.post('/:id/transfer-and-delete', departmentController.transferAndDeleteDepartment);
router.post('/:id/import-excel', departmentController.importDepartmentsFromExcel);
module.exports = router;
