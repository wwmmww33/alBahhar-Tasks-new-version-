// src/routes/delegationRoutes.js
const express = require('express');
const router = express.Router();
const delegationController = require('../controllers/delegationController');

// إدارة التفويضات للمستخدم الحالي (كمفوِّض)
router.get('/', delegationController.getDelegations);
router.get('/as-delegate', delegationController.getDelegationsAsDelegate);
router.post('/', delegationController.createDelegation);
router.put('/:id', delegationController.updateDelegation);
router.delete('/:id', delegationController.deleteDelegation);

// تكليفات المناصب الشاغرة (للمدير ومدير النظام)
router.get('/vacant-positions/list', delegationController.listVacantPositions);
router.get('/vacant-positions/delegations', delegationController.listVacantPositionDelegations);
router.post('/vacant-positions/delegations', delegationController.createVacantPositionDelegation);
router.delete('/vacant-positions/delegations/:id', delegationController.deleteVacantPositionDelegation);

// إدارة الرمز السري للتفويض
router.get('/secret', delegationController.getDelegationSecret);
router.put('/secret/update', delegationController.updateDelegationSecret);

// سر تفويض محدد (حسب DelegationID)
router.get('/:id/secret', delegationController.getDelegationSecretForDelegation);
router.put('/:id/secret', delegationController.updateDelegationSecretForDelegation);

module.exports = router;
