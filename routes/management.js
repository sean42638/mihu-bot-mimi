const express = require('express');
const router = express.Router();
const db = require('../database');

// 🚀 自動檢查並補強 orders 與 users 表格欄位
db.run("ALTER TABLE orders ADD COLUMN staff_id TEXT", () => {});
db.run("ALTER TABLE orders ADD COLUMN player_id TEXT", () => {});
db.run("ALTER TABLE users ADD COLUMN balance REAL DEFAULT 0", () => {});
db.run("ALTER TABLE users ADD COLUMN bonus_balance REAL DEFAULT 0", () => {});
db.run("ALTER TABLE users ADD COLUMN manual_spent REAL DEFAULT 0", () => {});
db.run("ALTER TABLE users ADD COLUMN manual_deposited REAL DEFAULT 0", () => {});
db.run("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'idle'", () => {});
db.run("ALTER TABLE users ADD COLUMN commission_rate REAL", () => {});
db.run("ALTER TABLE users ADD COLUMN staff_channel_id TEXT", () => {});

// 🚀 載入拆分模組 (含新建立的獨立抽傭路由)
const membersRouter = require('./management/members');
const staffRouter = require('./management/staff');
const payrollRouter = require('./management/payroll');
const ordersRouter = require('./management/orders');
const commissionRouter = require('./management/commission'); // 👈 新增獨立抽傭模組

// 🚀 正確掛載管理子路由（指定專屬路徑前綴）
router.use('/members', membersRouter);
router.use('/staff', staffRouter);
router.use('/payroll', payrollRouter);
router.use('/orders', ordersRouter);
router.use('/commission', commissionRouter); // 👈 正確掛載 /management/commission

module.exports = router;