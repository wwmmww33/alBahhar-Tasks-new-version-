const express = require('express');
const router = express.Router();
const directoryController = require('../controllers/directoryController');

router.get('/search', directoryController.search);

module.exports = router;
