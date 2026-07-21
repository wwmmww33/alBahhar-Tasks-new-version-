// src/routes/calendarRoutes.js
const express = require('express');
const router = express.Router();
const calendarController = require('../controllers/calendarController');

router.get('/subtasks', calendarController.getDepartmentCalendarSubtasks);
router.get('/reminders', calendarController.getSubtaskReminders);
router.get('/assigned', calendarController.getAssignedSubtasks);

router.get('/personal-events', calendarController.getPersonalEvents);
router.post('/personal-events', calendarController.createPersonalEvent);
router.put('/personal-events/:id', calendarController.updatePersonalEvent);
router.delete('/personal-events/:id', calendarController.deletePersonalEvent);

router.get('/comments', calendarController.getCalendarComments);

module.exports = router;
