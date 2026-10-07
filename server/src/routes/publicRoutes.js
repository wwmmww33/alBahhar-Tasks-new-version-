const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/publicController');

router.get('/calendar', ctrl.getPublicCalendar);

module.exports = router;
