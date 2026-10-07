
// src/routes/commentRoutes.js
const express = require('express');
const router = express.Router();
const commentController = require('../controllers/commentController');

router.post('/', commentController.createComment);
router.put('/:commentId', commentController.updateComment);
router.patch('/:commentId/move', commentController.moveComment);
router.patch('/:commentId/department-shares', commentController.setCommentDepartmentShares);
router.patch('/:commentId/broadcast-level', commentController.setCommentBroadcastLevel);
router.patch('/:commentId/public-broadcast', commentController.setCommentPublicBroadcast);
router.delete('/:commentId', commentController.deleteComment);

module.exports = router;
