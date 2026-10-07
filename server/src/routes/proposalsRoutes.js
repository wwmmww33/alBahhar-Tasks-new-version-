const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/proposalsController');

router.get('/', ctrl.getProposals);
router.post('/', ctrl.createProposal);
router.patch('/:id', ctrl.updateProposal);
router.delete('/:id', ctrl.deleteProposal);

module.exports = router;
