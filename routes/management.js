const express = require('express');
const router = express.Router();

// 🚀 載入三大模組化子路由器
const membersRouter = require('./management/members');
const staffRouter = require('./management/staff');
const ordersRouter = require('./management/orders');

// 🚀 統一分發前綴路由
router.use('/members', membersRouter);
router.use('/staff', staffRouter);
router.use('/orders', ordersRouter);

module.exports = router;