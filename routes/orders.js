const express = require('express');
const router = express.Router();
const db = require('../database');
const { dbRun } = require('../utils/dbHelper');
const { syncOrdersJsonFromDb } = require('../utils/dataSync');
const { requireAuth: ensureAuth, requirePerm: checkPerm } = require('../middleware/auth');
const { calculateDiscount } = require('../utils/discountHelper');

/**
 * 📋 1. 我的訂單 (GET /orders/my)
 * 權限定義：僅抓取當前登入會員身為「闆闆」(boss_id = req.user.id) 的消費/下單紀錄
 */
router.get('/my', ensureAuth, (req, res) => {
    const currentUserId = req.user.id;

    const sql = `
        SELECT 
            o.*,
            b.username as boss_username,
            b.global_name as boss_global_name,
            b.custom_nickname as boss_nickname,
            b.avatar as boss_avatar,
            t.username as talent_username,
            t.global_name as talent_global_name,
            t.custom_nickname as talent_nickname,
            t.avatar as talent_avatar
        FROM orders o
        LEFT JOIN users b ON o.boss_id = b.id
        LEFT JOIN users t ON o.talent_id = t.id
        WHERE o.boss_id = ?
        ORDER BY o.created_at DESC
    `;

    db.all(sql, [currentUserId], (err, orders) => {
        if (err) {
            console.error('❌ 查詢「我的訂單」失敗:', err);
            return res.render('my_orders', { user: req.user, orders: [] });
        }

        res.render('my_orders', {
            user: req.user,
            orders: orders || []
        });
    });
});

/**
 * 🛠️ 2. 訂單管理全站總覽 (GET /management/orders 或 /orders)
 * 權限定義：管理者/客服視角，抓取全站所有訂單
 */
router.get('/orders', ensureAuth, checkPerm('manage_orders'), (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, currentUser) => {
        const orderSql = `
            SELECT 
                o.*,
                b.username as boss_username,
                b.global_name as boss_global_name,
                b.custom_nickname as boss_nickname,
                b.avatar as boss_avatar,
                t.username as talent_username,
                t.global_name as talent_global_name,
                t.custom_nickname as talent_nickname,
                t.avatar as talent_avatar
            FROM orders o
            LEFT JOIN users b ON o.boss_id = b.id
            LEFT JOIN users t ON o.talent_id = t.id
            ORDER BY o.created_at DESC
        `;

        db.all(orderSql, (oErr, orders) => {
            db.all("SELECT id, username, global_name, custom_nickname FROM users WHERE role IN ('staff', 'manager', 'admin', 'cs', 'cfo', 'aftersales', 'talent')", (tErr, talents) => {
                res.render('orders', {
                    user: currentUser || req.user,
                    orders: orders || [],
                    talents: talents || [],
                    success: req.query.saved === '1'
                });
            });
        });
    });
});

/**
 * ✏️ 3. POST: 處理訂單編輯、折扣計算與刪除 (管理員權限)
 */
router.post('/orders/update/:id', ensureAuth, checkPerm('manage_orders'), async (req, res) => {
    const orderId = req.params.id;
    const { category, game, content_tier, duration, unit, original_price, discount, total_amount, talent_id, status, talent_message, note, is_delete } = req.body;

    try {
        if (is_delete === '1') {
            await dbRun('DELETE FROM orders WHERE id = ? OR order_no = ?', [orderId, orderId]);
            syncOrdersJsonFromDb();
            return res.redirect('/management/orders?saved=1');
        }

        const rawPrice = original_price ? parseFloat(original_price) : (total_amount ? parseFloat(total_amount) : 0);
        const rawDiscount = discount ? parseFloat(discount) : 0;
        const { finalAmount, discountAmount } = calculateDiscount(rawPrice, rawDiscount);

        const updateSql = `
            UPDATE orders SET 
                category = ?, game = ?, content_tier = ?, duration = ?, 
                unit = ?, discount = ?, total_amount = ?, talent_id = ?, status = ?, 
                talent_message = ?, note = ?
            WHERE id = ? OR order_no = ?
        `;

        await dbRun(updateSql, [
            category, game, content_tier || '', duration ? parseFloat(duration) : 1,
            unit || '小時', discountAmount, finalAmount,
            talent_id || null, status || 'pending',
            talent_message || '', note || '',
            orderId, orderId
        ]);

        syncOrdersJsonFromDb();
        res.redirect('/management/orders?saved=1');
    } catch (err) {
        console.error('❌ 更新訂單失敗:', err);
        res.redirect('/management/orders?error=' + encodeURIComponent('更新失敗'));
    }
});

module.exports = router;