// src/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// المسارات الخاصة بالمستخدمين
router.get('/', userController.getAllUsers);
router.post('/bootstrap-admin', userController.bootstrapAdmin);
router.post('/encrypt-passwords', userController.encryptExistingPasswords);
router.put('/:id/role', userController.setUserRole);
router.put('/:id', userController.updateUser);

// المسارات الخاصة بطلبات التسجيل
router.get('/requests', userController.getRegistrationRequests);
router.post('/requests/:id/approve', userController.approveRegistrationRequest);
router.delete('/requests/:id', userController.deleteRegistrationRequest);


module.exports = router;