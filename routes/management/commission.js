const express = require('express');
const router = express.Router();
const { requireAuth: ensureAuth, requirePerm: checkPerm } = require('../../middleware/auth');

router.get('/', ensureAuth, (req, res) => res.redirect('/system/commission'));

router.post('/', ensureAuth, checkPerm('sys_commission'), (req, res) => res.redirect('/system/commission'));

module.exports = router;