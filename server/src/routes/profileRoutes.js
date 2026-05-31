// src/routes/profileRoutes.js
const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');

router.get('/:userId', profileController.getProfile);
router.put('/update', profileController.updateProfile);
router.post('/transfer-vacancy', profileController.transferVacancy);
router.post('/undo-transfer', profileController.undoTransfer);

module.exports = router;
