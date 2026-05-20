// src/routes/ranksRoutes.js
const express = require('express');
const router = express.Router();
const ranksController = require('../controllers/ranksController');

// GET /api/ranks
router.get('/', ranksController.listRanks);

module.exports = router;
