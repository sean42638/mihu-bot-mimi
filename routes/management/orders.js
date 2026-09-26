const express = require('express');
const router = express.Router();
const db = require('../../database');
const { syncOrdersJsonFromDb, syncUsersJsonFromDb } = require('../../utils/dataSync');
const { requireAuth: ensureAuth, requirePerm: checkPerm } = require('../../middleware/auth');
const { calculateDiscount } = require('../../utils/discountHelper');
const { dbRun } = require('../../utils/dbHelper');
const {
    calculateCommissionByCategory,
    getStudioIdForUser,
    getPersonalTalentShareRate,
    normalizeTalentShareRate,
    resolveServiceId
} = require('../../utils/commissionHelper');

function isPlatformAdmin(user) {
    return user && (user.id === '604610298581876746' || user.role === 'admin');
}

function canManageOrderStudio(user, studioId) {
    return isPlatformAdmin(user) || (Number(user && user.studio_id) || 1) === (Number(studioId) || 1);
}

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
            WHERE o.studio_id = ?
            ORDER BY o.created_at DESC
        `;

        const allStudios = isPlatformAdmin(req.user);
        const scopedOrderSql = allStudios ? orderSql.replace('WHERE o.studio_id = ?', '') : orderSql;
        const staffSql = `SELECT id, username, global_name, custom_nickname FROM users WHERE role IN ('staff', 'manager', 'admin', 'cs', 'cfo', 'aftersales', 'talent') ${allStudios ? '' : 'AND studio_id = ?'}`;

        db.all(scopedOrderSql, allStudios ? [] : [Number(req.user.studio_id) || 1], (oErr, orders) => {
            db.all(staffSql, allStudios ? [] : [Number(req.user.studio_id) || 1], (tErr, talents) => {
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
    const { category, game, content_tier, duration, unit, unit_price, original_price, discount, total_amount, talent_id, status, talent_message, note, is_delete } = req.body;

    try {
        if (is_delete === '1') {
            const order = await new Promise((resolve) => {
                db.get('SELECT * FROM orders WHERE id = ? OR order_no = ?', [orderId, orderId], (err, row) => resolve(row || null));
            });

            if (order && !canManageOrderStudio(req.user, order.studio_id)) {
                return res.status(403).send('無權修改其他工作室訂單');
            }

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

        const existingOrder = await new Promise((resolve) => {
            db.get('SELECT * FROM orders WHERE id = ? OR order_no = ?', [orderId, orderId], (err, row) => resolve(row || null));
        });
        if (!existingOrder) return res.redirect('/management/orders?error=' + encodeURIComponent('找不到目標訂單'));
        const studioId = Number(existingOrder.studio_id) || 1;
        if (!canManageOrderStudio(req.user, studioId)) return res.status(403).send('無權修改其他工作室訂單');

        const durVal = duration ? parseFloat(duration) : 1;
        const uPriceVal = unit_price ? parseFloat(unit_price) : 0;
        const rawPrice = original_price ? parseFloat(original_price) : (uPriceVal > 0 ? durVal * uPriceVal : (total_amount ? parseFloat(total_amount) : 0));
        const rawDiscount = discount ? parseFloat(discount) : 0;
        
        let finalAmount = rawPrice;
        let discountAmount = 0;

        if (typeof calculateDiscount === 'function') {
            const calcRes = calculateDiscount(rawPrice, rawDiscount);
            finalAmount = calcRes.finalAmount;
            discountAmount = calcRes.discountAmount;
        }

        // 🚀 計算未打折前的原價金額 (以原價算陪陪分潤)
        let origPriceForCommission = (uPriceVal > 0) ? (durVal * uPriceVal) : (finalAmount + discountAmount);
        if (origPriceForCommission <= 0) origPriceForCommission = finalAmount;

        // 🚀 查詢陪陪個人專屬特例抽傭
        const targetTalentId = talent_id || null;
        if (targetTalentId && await getStudioIdForUser(targetTalentId) !== studioId) {
            throw new Error('陪玩師不屬於此訂單的工作室');
        }
        const serviceId = await resolveServiceId(studioId, game, category || '陪玩單');
        const personalRate = targetTalentId ? await getPersonalTalentShareRate(targetTalentId) : null;

        // 🚀 呼叫獨立抽傭核心 Helper (以原價算陪陪實得)
        const { talentShareRate, platformCommission, talentNetEarning } = await calculateCommissionByCategory(
            category || '陪玩單',
            finalAmount,
            origPriceForCommission,
            personalRate,
            { studioId, serviceId }
        );

        const updateSql = `
            UPDATE orders SET 
                category = ?, game = ?, content_tier = ?, duration = ?, 
                unit = ?, unit_price = ?, discount = ?, total_amount = ?, talent_id = ?, staff_id = ?,
                studio_id = ?, service_id = ?, status = ?, commission_rate_snapshot = ?,
                platform_commission = ?, talent_earning = ?, talent_message = ?, note = ?
            WHERE id = ? OR order_no = ?
        `;

        await dbRun(updateSql, [
            category, game, content_tier || '', durVal,
            unit || '小時', uPriceVal, discountAmount, finalAmount,
            targetTalentId, targetTalentId, studioId, serviceId, status || 'pending',
            talentShareRate,
            platformCommission, talentNetEarning, talent_message || '', note || '',
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
        if (!canManageOrderStudio(req.user, order.studio_id)) return res.status(403).send('無權取消其他工作室訂單');

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
router.post('/complete/:id', ensureAuth, checkPerm('manage_orders'), async (req, res) => {
    const orderId = req.params.id;

    db.get('SELECT * FROM orders WHERE id = ? OR order_no = ?', [orderId, orderId], async (err, order) => {
        if (err || !order) {
            return res.redirect('/management/orders?error=' + encodeURIComponent('找不到目標訂單'));
        }
            if (!canManageOrderStudio(req.user, order.studio_id)) return res.status(403).send('無權結算其他工作室訂單');

        const dur = Number(order.duration || 1);
        const uPrice = Number(order.unit_price || 0);
        const finalAmt = Number(order.total_amount || 0);
        const disc = Number(order.discount || 0);
        const studioId = Number(order.studio_id) || 1;

        let origPriceForCommission = (uPrice > 0) ? (dur * uPrice) : (finalAmt + disc);
        if (origPriceForCommission <= 0) origPriceForCommission = finalAmt;

        const targetTalentId = order.talent_id || order.staff_id;
        let snapshotRate = normalizeTalentShareRate(order.commission_rate_snapshot);
        let platformCommission = Number(order.platform_commission);
        let talentNetEarning = Number(order.talent_earning);

        if (snapshotRate === null) {
            const serviceId = order.service_id || await resolveServiceId(studioId, order.game, order.category || '陪玩單');
            const personalRate = targetTalentId ? await getPersonalTalentShareRate(targetTalentId) : null;
            const commission = await calculateCommissionByCategory(
                order.category || '陪玩單', finalAmt, origPriceForCommission, personalRate, { studioId, serviceId }
            );
            snapshotRate = commission.talentShareRate;
            platformCommission = commission.platformCommission;
            talentNetEarning = commission.talentNetEarning;
        } else {
            talentNetEarning = Number.isFinite(talentNetEarning)
                ? talentNetEarning
                : Math.round(origPriceForCommission * snapshotRate);
            platformCommission = Number.isFinite(platformCommission)
                ? platformCommission
                : Math.max(0, finalAmt - talentNetEarning);
        }

        const completeSql = `
            UPDATE orders SET
                status = 'completed',
                commission_rate_snapshot = ?,
                platform_commission = ?,
                talent_earning = ?,
                end_time = DATETIME('now', 'localtime')
            WHERE id = ? OR order_no = ?
        `;

        db.run(completeSql, [snapshotRate, platformCommission, talentNetEarning, orderId, orderId], function (uErr) {
            if (uErr) {
                console.error('❌ 標記完成失敗:', uErr);
                return res.redirect('/management/orders?error=' + encodeURIComponent('標記完成失敗'));
            }
            try {
                syncOrdersJsonFromDb();
                if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
            } catch (e) {}
            res.redirect('/management/orders?successMsg=' + encodeURIComponent('訂單已成功標記為完成並完成原價分潤計算！'));
        });
    });
});

module.exports = router;