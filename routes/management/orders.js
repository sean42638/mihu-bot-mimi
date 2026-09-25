const express = require('express');
const router = express.Router();
const db = require('../../database');
const { syncOrdersJsonFromDb, syncUsersJsonFromDb } = require('../../utils/dataSync');
const { requireAuth: ensureAuth, requirePerm: checkPerm } = require('../../middleware/auth');
const { calculateDiscount } = require('../../utils/discountHelper');
const { dbRun } = require('../../utils/dbHelper');

// =========================================================================
// 1. 訂單管理主頁面 (對應完整網址 /management/orders)
// =========================================================================
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
                t.avatar as talent_avatar,

                cs.username as cs_username,
                cs.global_name as cs_global_name,
                cs.custom_nickname as cs_nickname,
                cs.avatar as cs_avatar
            FROM orders o
            LEFT JOIN users b ON o.boss_id = b.id
            LEFT JOIN users t ON (o.talent_id = t.id OR o.staff_id = t.id)
            LEFT JOIN users cs ON o.cs_id = cs.id
            ORDER BY o.created_at DESC
        `;

        db.all(orderSql, (oErr, orders) => {
            db.all("SELECT id, username, global_name, custom_nickname FROM users WHERE role IN ('staff', 'manager', 'admin', 'cs', 'cfo', 'aftersales', 'talent')", (tErr, talents) => {
                res.render('orders', {
                    user: currentUser || req.user,
                    currentUser: currentUser || req.user,
                    orders: orders || [],
                    talents: talents || [],
                    activePage: 'orders',
                    success: req.query.saved === '1' || req.query.success === '1',
                    successMsg: req.query.successMsg || null,
                    errorMsg: req.query.error || null
                });
            });
        });
    });
});

// =========================================================================
// 2. 處理訂單更新/單筆刪除 (對應 /management/orders/update/:id)
// =========================================================================
router.post('/update/:id', ensureAuth, checkPerm('manage_orders'), async (req, res) => {
    const orderId = req.params.id;
    const { category, game, content_tier, duration, unit, original_price, discount, total_amount, talent_id, status, talent_message, note, is_delete } = req.body;

    try {
        if (is_delete === '1') {
            const order = await new Promise((resolve) => {
                db.get('SELECT * FROM orders WHERE id = ? OR order_no = ?', [orderId, orderId], (err, row) => resolve(row || null));
            });

            if (order && Number(order.total_amount || 0) > 0 && order.boss_id) {
                const refundAmount = Number(order.total_amount);
                await dbRun('UPDATE users SET balance = balance + ? WHERE id = ?', [refundAmount, order.boss_id]);
                
                dbRun(`
                    INSERT INTO wallet_transactions (user_id, type, amount, description, created_at)
                    VALUES (?, 'order_refund', ?, ?, DATETIME('now', 'localtime'))
                `, [order.boss_id, refundAmount, `後台手動刪除退款 - 訂單: ${order.order_no}`]).catch(() => {});
            }

            await dbRun('DELETE FROM orders WHERE id = ? OR order_no = ?', [orderId, orderId]);
            try {
                syncOrdersJsonFromDb();
                if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
            } catch (e) {}

            return res.redirect('/management/orders?successMsg=' + encodeURIComponent('訂單已退款並成功刪除！'));
        }

        const rawPrice = original_price ? parseFloat(original_price) : (total_amount ? parseFloat(total_amount) : 0);
        const rawDiscount = discount ? parseFloat(discount) : 0;
        
        let finalAmount = rawPrice;
        let discountAmount = 0;

        if (typeof calculateDiscount === 'function') {
            const calcRes = calculateDiscount(rawPrice, rawDiscount);
            finalAmount = calcRes.finalAmount;
            discountAmount = calcRes.discountAmount;
        }

        const updateSql = `
            UPDATE orders SET 
                category = ?, game = ?, content_tier = ?, duration = ?, 
                unit = ?, discount = ?, total_amount = ?, talent_id = ?, staff_id = ?, status = ?, 
                talent_message = ?, note = ?
            WHERE id = ? OR order_no = ?
        `;

        await dbRun(updateSql, [
            category, game, content_tier || '', duration ? parseFloat(duration) : 1,
            unit || '小時', discountAmount, finalAmount,
            talent_id || null, talent_id || null, status || 'pending',
            talent_message || '', note || '',
            orderId, orderId
        ]);

        try {
            syncOrdersJsonFromDb();
            if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
        } catch (e) {}

        res.redirect('/management/orders?saved=1');
    } catch (err) {
        console.error('❌ 更新訂單失敗:', err);
        res.redirect('/management/orders?error=' + encodeURIComponent('更新失敗'));
    }
});

// =========================================================================
// 🚀 3. 專用訂單批量刪除 API (對應 /management/orders/batch-delete)
// =========================================================================
router.post('/batch-delete', ensureAuth, async (req, res) => {
    try {
        const userRole = req.user ? String(req.user.role || '').toLowerCase() : 'member';
        const isOwnerAdmin = ['admin', 'owner'].includes(userRole);

        if (!isOwnerAdmin) {
            return res.redirect('/management/orders?error=' + encodeURIComponent('🚫 權限不足！批量刪除僅限店長使用。'));
        }

        let orderIds = req.body.order_ids;
        if (!orderIds) {
            return res.redirect('/management/orders?error=' + encodeURIComponent('⚠️ 請至少勾選一筆訂單！'));
        }

        if (!Array.isArray(orderIds)) {
            orderIds = [orderIds];
        }

        const placeholders = orderIds.map(() => '?').join(',');
        const deleteSql = `DELETE FROM orders WHERE id IN (${placeholders}) OR order_no IN (${placeholders})`;
        const sqlParams = [...orderIds, ...orderIds];

        await dbRun(deleteSql, sqlParams);

        try {
            syncOrdersJsonFromDb();
            if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
        } catch (e) {}

        res.redirect('/management/orders?successMsg=' + encodeURIComponent(`✅ 成功批量刪除 ${orderIds.length} 筆訂單！`));

    } catch (err) {
        console.error('❌ 批量刪除訂單出錯:', err);
        res.redirect('/management/orders?error=' + encodeURIComponent('批量刪除失敗：' + err.message));
    }
});

// =========================================================================
// 4. 單筆作廢退款 API (對應 /management/orders/cancel/:id)
// =========================================================================
router.post('/cancel/:id', ensureAuth, checkPerm('manage_orders'), (req, res) => {
    const orderId = req.params.id;

    db.get('SELECT * FROM orders WHERE id = ? OR order_no = ?', [orderId, orderId], (err, order) => {
        if (err || !order) {
            return res.redirect('/management/orders?error=' + encodeURIComponent('找不到目標訂單'));
        }

        const refundAmount = Number(order.total_amount || 0);
        const bossId = order.boss_id;
        const orderNo = order.order_no;

        const processRefund = new Promise((resolve, reject) => {
            if (refundAmount > 0 && bossId) {
                db.run(
                    "UPDATE users SET balance = balance + ? WHERE id = ?",
                    [refundAmount, bossId],
                    function (refundErr) {
                        if (refundErr) return reject(refundErr);

                        db.run(`
                            INSERT INTO wallet_transactions (user_id, type, amount, description, created_at)
                            VALUES (?, 'order_refund', ?, ?, DATETIME('now', 'localtime'))
                        `, [bossId, refundAmount, `作廢退款 - 訂單號: ${orderNo}`], () => {});

                        resolve();
                    }
                );
            } else {
                resolve();
            }
        });

        processRefund.then(() => {
            db.run("DELETE FROM orders WHERE id = ? OR order_no = ?", [orderId, orderId], function (deleteErr) {
                if (deleteErr) {
                    console.error('❌ 刪除訂單失敗:', deleteErr);
                    return res.redirect('/management/orders?error=' + encodeURIComponent('刪除訂單失敗'));
                }

                try {
                    syncOrdersJsonFromDb();
                    if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
                } catch (e) {}

                res.redirect('/management/orders?successMsg=' + encodeURIComponent(`訂單 ${orderNo} 已成功退款 $${refundAmount} NTD 並直接刪除！`));
            });
        }).catch((rErr) => {
            console.error('❌ 退款處理出錯:', rErr);
            res.redirect('/management/orders?error=' + encodeURIComponent('退款處理失敗'));
        });
    });
});

// =========================================================================
// 5. 標記完成 API (對應 /management/orders/complete/:id)
// =========================================================================
router.post('/complete/:id', ensureAuth, checkPerm('manage_orders'), (req, res) => {
    const orderId = req.params.id;

    db.run("UPDATE orders SET status = 'completed' WHERE id = ? OR order_no = ?", [orderId, orderId], function (err) {
        if (err) {
            return res.redirect('/management/orders?error=' + encodeURIComponent('標記完成失敗'));
        }
        try {
            syncOrdersJsonFromDb();
        } catch (e) {}
        res.redirect('/management/orders?successMsg=' + encodeURIComponent('訂單已成功標記為完成！'));
    });
});

module.exports = router;