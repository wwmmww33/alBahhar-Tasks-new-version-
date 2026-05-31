// src/routes/vacancyRoutes.js
const express = require('express');
const router = express.Router();
const vacancyController = require('../controllers/vacancyController');

// GET /api/vacancies/ranks — قائمة الرتب من جدول VacancyRanks
router.get('/ranks', vacancyController.listRanks);

// GET /api/vacancies/candidates — كل المستخدمين النشطين (مع سياق القسم/المنصب الحالي)
router.get('/candidates', vacancyController.listCandidates);

// GET /api/vacancies/unassigned-users — قائمة المستخدمين بلا إسناد حالي
router.get('/unassigned-users', vacancyController.listUnassignedUsers);

// GET /api/vacancies/user-scope/:userId — مناصب نطاق نقل المهام للمستخدم (مُحدَّد من منصبه الحالي)
router.get('/user-scope/:userId', vacancyController.listByUserTransferScope);

// GET /api/vacancies/department/:departmentId/scope — مناصب هرمية القسم للإسناد (يحترم حدود Type=0)
router.get('/department/:departmentId/scope', vacancyController.listByDepartmentScope);

// GET /api/vacancies/department/:departmentId/independent-scope — كل مناصب القسم المستقل (Type=1)
router.get('/department/:departmentId/independent-scope', vacancyController.listByIndependentDepartment);

// GET /api/vacancies/department/:departmentId — مناصب قسم مع الحامل الحالي
router.get('/department/:departmentId', vacancyController.listByDepartment);

// POST /api/vacancies — إنشاء منصب جديد
router.post('/', vacancyController.createVacancy);

// PUT /api/vacancies/:id — تعديل منصب
router.put('/:id', vacancyController.updateVacancy);

// GET /api/vacancies/:id/rank — رتبة منصب محدد
router.get('/:id/rank', vacancyController.getVacancyRank);

// PUT /api/vacancies/:id/rank — تعيين/تعديل رتبة منصب
router.put('/:id/rank', vacancyController.setVacancyRank);

// DELETE /api/vacancies/:id/rank — حذف رتبة منصب
router.delete('/:id/rank', vacancyController.deleteVacancyRank);

// DELETE /api/vacancies/:id — حذف منصب
router.delete('/:id', vacancyController.deleteVacancy);

// POST /api/vacancies/:id/assign — إسناد مستخدم للمنصب
router.post('/:id/assign', vacancyController.assignUser);

// DELETE /api/vacancies/:id/assign — إلغاء الإسناد (المنصب يصبح شاغراً)
router.delete('/:id/assign', vacancyController.unassignCurrent);

module.exports = router;
