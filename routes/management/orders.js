const express = require('express');
const router = express.Router();
const db = require('../../database');
const { syncOrdersJsonFromDb } = require('../../utils/dataSync');
const { requireAuth: ensureAuth, requirePerm: checkPerm } = require('../../middleware/auth');
const { calculateDiscount } = require('../../utils/discountHelper');
const { dbRun } = require('../../utils/dbHelper');

// 1. 訂單管理頁面
router.get('/', ensureAuth, checkPerm('manage_orders'), (req, res) => {
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

// 2. 處理訂單編輯、折扣計算與手動刪除 POST
router.post('/update/:id', ensureAuth, checkPerm('manage_orders'), async (req, res) => {
    const orderId = req.params.id;
    const { category, game, content_tier, duration, unit, original_price, discount, total_amount, talent_id, status, talent_message, note, is_delete } = req.body;

    try {
        if (is_delete === '1') {
            await dbRun('DELETE FROM orders WHERE id = ? OR order_no = ?', [orderId, orderId]);
            syncOrdersJsonFromDb();
            return res.redirect('/management/orders?saved=1');
        }

        // 計算折抵後的最終金額 (>=1 直減，0.1~0.99 折數，<0 防呆)
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