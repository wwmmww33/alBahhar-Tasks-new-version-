const express = require('express');
const multer = require('multer');
const router = express.Router();
const directoryController = require('../controllers/directoryController');

// نخزّن الملف المرفوع في الذاكرة مؤقتاً فقط (لا يُكتب على القرص إلا بعد التحقق)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

router.get('/search', directoryController.search);
router.get('/status', directoryController.status);
router.post('/pdf/upload', upload.single('file'), directoryController.uploadPdf);
router.post('/excel/inspect', upload.single('file'), directoryController.inspectExcel);
router.post('/excel/finalize', directoryController.finalizeExcel);
router.delete('/excel', directoryController.deleteExcel);

module.exports = router;
