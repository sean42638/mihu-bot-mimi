const express = require('express');
const router = express.Router();
const db = require('../database');
const { ensureAuth, checkPerm } = require('../middleware/auth');
const { sortByRoleWeight } = require('../utils/roleHelper');

// 🚀 自動檢查並補強 orders 與 users 表格欄位（防止缺少欄位導致 SQL 報錯崩潰）
db.run("ALTER TABLE orders ADD COLUMN staff_id TEXT", () => {});
db.run("ALTER TABLE orders ADD COLUMN player_id TEXT", () => {});
db.run("ALTER TABLE users ADD COLUMN balance REAL DEFAULT 0", () => {});
db.run("ALTER TABLE users ADD COLUMN bonus_balance REAL DEFAULT 0", () => {});
db.run("ALTER TABLE users ADD COLUMN manual_spent REAL DEFAULT 0", () => {});
db.run("ALTER TABLE users ADD COLUMN manual_deposited REAL DEFAULT 0", () => {});
db.run("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'idle'", () => {});
db.run("ALTER TABLE users ADD COLUMN commission_rate REAL", () => {});
db.run("ALTER TABLE users ADD COLUMN staff_channel_id TEXT", () => {});

// =========================================================================
// 📊 1. 會員管理 (Member Management - 獨立金額算式與權重排序)
// =========================================================================

// 1.1 渲染「會員管理」頁面
router.get('/members', ensureAuth, (req, res) => {
    const membersSql = `
        SELECT u.*,
            (COALESCE(u.balance, 0) + COALESCE(u.bonus_balance, 0)) as total_balance,
            COALESCE((SELECT SUM(total_amount) FROM orders WHERE boss_id = u.id AND status != 'cancelled'), 0) + COALESCE(u.manual_spent, 0) as total_spent,
            COALESCE((SELECT SUM(amount) FROM topups WHERE user_id = u.id AND amount > 0), 0) + COALESCE(u.manual_deposited, 0) as total_deposited
        FROM users u 
    `;

    db.all(membersSql, [], (err, rawMembers) => {
        if (err) {
            console.error('❌ 載入會員清單失敗:', err);
            return res.status(500).send('資料庫讀取錯誤');
        }

        db.all('SELECT * FROM vip_tiers ORDER BY level ASC', [], (vErr, vipTiers) => {
            const tiers = vipTiers || [];
            
            const processedMembers = (rawMembers || []).map(m => {
                const currentVip = Number(m.vip_level || 0);
                const spent = Number(m.total_spent || 0);
                const deposited = Number(m.total_deposited || 0);

                const nextTier = tiers.find(t => Number(t.level) > currentVip);

                let gapSpent = 0;
                let gapDeposit = 0;
                let gapText = '已達頂級';

                if (nextTier) {
                    const reqSpent = Number(nextTier.spent_threshold || 0);
                    const reqDeposit = Number(nextTier.deposit_threshold || 0);

                    gapSpent = Math.max(0, reqSpent - spent);
                    gapDeposit = Math.max(0, reqDeposit - deposited);
                    gapText = `距離 ${nextTier.name}: 消差 $${gapSpent.toLocaleString()} / 存差 $${gapDeposit.toLocaleString()}`;
                }

                return {
                    ...m,
                    total_balance: Number(m.total_balance || 0),
                    balance: Number(m.balance || 0),
                    bonus_balance: Number(m.bonus_balance || 0),
                    gap_spent: gapSpent,
                    gap_deposit: gapDeposit,
                    vip_gap_text: gapText
                };
            });

            // 🚀 依據全域身分權重進行階級排序 (店長 ➔ 財務長 ➔ 售後 ➔ 客服主管 ➔ 客服 ➔ 陪陪 ➔ 會員)
            const sortedMembers = sortByRoleWeight(processedMembers);

            res.render('members', {
                members: sortedMembers,
                currentUser: req.user,
                userPerms: req.user ? (req.user.permissions || []) : [],
                activePage: 'members',
                success: req.query.success === '1',
                errorMsg: req.query.error || null
            });
        });
    });
});

// 1.2 單一會員 Discord 資料刷新
router.get('/members/sync/:id', ensureAuth, async (req, res) => {
    const targetUserId = req.params.id;
    try {
        const client = req.app.get('discordClient');
        if (client && client.users) {
            try {
                const dcUser = await client.users.fetch(targetUserId);
                if (dcUser) {
                    db.run(
                        `UPDATE users SET avatar = ?, global_name = ?, username = ? WHERE id = ?`,
                        [dcUser.avatar || null, dcUser.globalName || dcUser.username, dcUser.username, targetUserId]
                    );
                }
            } catch (e) {}
        }
        res.redirect('/management/members?success=1');
    } catch (error) {
        res.redirect('/management/members?error=' + encodeURIComponent('同步失敗'));
    }
});

// 1.3 全體會員 Discord 資料刷新
router.get('/members/sync-all', ensureAuth, async (req, res) => {
    res.redirect('/management/members?success=1');
});

// 1.4 手動更新會員帳務金額 (精準區分實充與贈送金)
router.post('/members/update-balance/:id', ensureAuth, (req, res) => {
    const targetUserId = req.params.id;
    const { add_amount, bonus_balance, balance, total_spent, total_deposited } = req.body;

    db.get('SELECT * FROM users WHERE id = ?', [targetUserId], (err, targetUser) => {
        if (err || !targetUser) {
            return res.redirect('/management/members?error=' + encodeURIComponent('找不到目標會員'));
        }

        let newBalance = balance !== undefined && balance !== '' ? Number(balance) : Number(targetUser.balance || 0);
        let newBonus = bonus_balance !== undefined && bonus_balance !== '' ? Number(bonus_balance) : Number(targetUser.bonus_balance || 0);
        
        if (add_amount && !isNaN(Number(add_amount))) {
            newBalance += Number(add_amount);
        }

        newBalance = Math.max(0, newBalance);
        newBonus = Math.max(0, newBonus);

        const newSpent = total_spent !== undefined && total_spent !== '' ? Math.max(0, Number(total_spent)) : Number(targetUser.manual_spent || 0);
        const newDeposited = total_deposited !== undefined && total_deposited !== '' ? Math.max(0, Number(total_deposited)) : Number(targetUser.manual_deposited || 0);

        db.run(
            `UPDATE users SET balance = ?, bonus_balance = ?, manual_spent = ?, manual_deposited = ? WHERE id = ?`,
            [newBalance, newBonus, newSpent, newDeposited, targetUserId],
            function (updateErr) {
                if (updateErr) {
                    return res.redirect('/management/members?error=' + encodeURIComponent('更新帳務失敗'));
                }

                try {
                    const { syncUsersJsonFromDb } = require('../utils/dataSync');
                    if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
                } catch (e) {}

                res.redirect('/management/members?success=1');
            }
        );
    });
});

// 1.5 👑 手動更新 VIP 等級與後台身分 (Role)
router.post('/members/update-vip/:id', ensureAuth, (req, res) => {
    const targetUserId = req.params.id;
    const { vip_level, role } = req.body;

    db.get('SELECT * FROM users WHERE id = ?', [targetUserId], (err, targetUser) => {
        if (err || !targetUser) {
            return res.redirect('/management/members?error=' + encodeURIComponent('找不到目標會員'));
        }

        let newVip = Number(vip_level);
        if (isNaN(newVip)) {
            if (vip_level && vip_level.startsWith('+')) newVip = Number(targetUser.vip_level || 0) + Number(vip_level.replace('+', ''));
            else if (vip_level && vip_level.startsWith('-')) newVip = Number(targetUser.vip_level || 0) - Number(vip_level.replace('-', ''));
            else newVip = Number(targetUser.vip_level || 0);
        }
        newVip = Math.max(0, newVip);
        const newRole = role || targetUser.role || 'member';

        db.run(
            'UPDATE users SET vip_level = ?, role = ? WHERE id = ?',
            [newVip, newRole, targetUserId],
            function (updateErr) {
                if (updateErr) {
                    console.error('❌ 更新 VIP 與身分失敗:', updateErr);
                    return res.redirect('/management/members?error=' + encodeURIComponent('更新身分失敗'));
                }

                if (req.user && req.user.id === targetUserId) {
                    req.user.role = newRole;
                    req.user.vip_level = newVip;
                }

                try {
                    const { syncUsersJsonFromDb } = require('../utils/dataSync');
                    if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
                } catch (e) {}

                res.redirect('/management/members?success=1');
            }
        );
    });
});

// =========================================================================
// 💼 2. 員工管理 (Staff Management)
// =========================================================================

// 2.1 渲染「員工列表」頁面
router.get('/staff', ensureAuth, (req, res) => {
    const safeStaffSql = `
        SELECT u.*,
            COALESCE((SELECT COUNT(*) FROM orders WHERE (staff_id = u.id OR player_id = u.id) AND status = 'completed'), 0) as total_orders,
            COALESCE((SELECT SUM(total_amount) FROM orders WHERE (staff_id = u.id OR player_id = u.id) AND status = 'completed'), 0) as total_revenue
        FROM users u 
        WHERE u.role IN ('admin', 'cfo', 'aftersales', 'after_sales', 'manager', 'cs_director', 'cs', 'staff', 'talent') 
           OR u.role IS NULL 
           OR u.role != 'member'
    `;

    db.all(safeStaffSql, [], (err, staffList) => {
        if (err) {
            console.error('❌ 載入員工清單 SQL 錯誤:', err);
            const fallbackSql = `SELECT u.* FROM users u WHERE u.role != 'member' OR u.role IS NULL`;
            db.all(fallbackSql, [], (fbErr, fbList) => {
                const sorted = sortByRoleWeight(fbList || []);
                res.render('staff', {
                    staffList: sorted,
                    currentUser: req.user,
                    userPerms: req.user ? (req.user.permissions || []) : [],
                    activePage: 'staff',
                    success: req.query.success === '1',
                    errorMsg: req.query.error || null
                });
            });
            return;
        }

        const sortedStaff = sortByRoleWeight(staffList || []);

        res.render('staff', {
            staffList: sortedStaff,
            currentUser: req.user,
            userPerms: req.user ? (req.user.permissions || []) : [],
            activePage: 'staff',
            success: req.query.success === '1',
            errorMsg: req.query.error || null
        });
    });
});

// 2.2 💼 變更員工職位與設定
router.post('/staff/update/:id', ensureAuth, (req, res) => {
    const targetStaffId = req.params.id;
    const { role, status, commission_rate, staff_channel_id } = req.body;

    let parsedRate = null;
    if (commission_rate !== undefined && commission_rate !== null && String(commission_rate).trim() !== '') {
        parsedRate = parseFloat(commission_rate);
        if (isNaN(parsedRate)) parsedRate = null;
    }

    const newRole = role || 'staff';
    const fullUpdateSql = `UPDATE users SET role = ?, status = ?, commission_rate = ?, staff_channel_id = ? WHERE id = ?`;
    
    db.run(fullUpdateSql, [newRole, status || 'idle', parsedRate, staff_channel_id || null, targetStaffId], function (err) {
        if (err) {
            console.warn('⚠️ 完整更新失敗，嘗試基礎職位更新:', err.message);
            db.run(`UPDATE users SET role = ? WHERE id = ?`, [newRole, targetStaffId], (fbErr) => {
                if (req.user && req.user.id === targetStaffId) req.user.role = newRole;
                try {
                    const { syncUsersJsonFromDb } = require('../utils/dataSync');
                    if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
                } catch (e) {}
                res.redirect('/management/staff?success=1');
            });
            return;
        }

        if (req.user && req.user.id === targetStaffId) {
            req.user.role = newRole;
        }

        try {
            const { syncUsersJsonFromDb } = require('../utils/dataSync');
            if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
        } catch (e) {}

        res.redirect('/management/staff?success=1');
    });
});

// 2.3 單一員工 Discord 刷洗
router.get('/staff/sync/:id', ensureAuth, async (req, res) => {
    res.redirect('/management/staff?success=1');
});

// 2.4 全體員工 Discord 刷洗
router.get('/staff/sync-all', ensureAuth, async (req, res) => {
    res.redirect('/management/staff?success=1');
});

// =========================================================================
// 📑 3. 訂單管理 (Order Management - 包含作廢退款與完成結算)
// =========================================================================

// 3.1 渲染「訂單管理」頁面
router.get('/orders', ensureAuth, (req, res) => {
    const ordersSql = `
        SELECT o.*, 
            b.username as boss_username, b.custom_nickname as boss_nickname, b.avatar as boss_avatar,
            s.username as staff_username, s.custom_nickname as staff_nickname, s.avatar as staff_avatar
        FROM orders o
        LEFT JOIN users b ON o.boss_id = b.id
        LEFT JOIN users s ON (o.staff_id = s.id OR o.talent_id = s.id)
        ORDER BY o.created_at DESC
    `;

    db.all(ordersSql, [], (err, orders) => {
        if (err) {
            console.error('❌ 載入訂單清單失敗:', err);
            orders = [];
        }

        res.render('orders', {
            orders: orders || [],
            currentUser: req.user,
            userPerms: req.user ? (req.user.permissions || []) : [],
            activePage: 'orders',
            successMsg: req.query.successMsg || null,
            errorMsg: req.query.error || null
        });
    });
});

// 3.2 ❌ 訂單作廢：全額退款至闆闆錢包 + 直接物理刪除訂單
router.post('/orders/cancel/:id', ensureAuth, (req, res) => {
    const orderId = req.params.id;

    db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order) => {
        if (err || !order) {
            return res.redirect('/management/orders?error=' + encodeURIComponent('找不到目標訂單'));
        }

        const refundAmount = Number(order.total_amount || 0);
        const bossId = order.boss_id;
        const orderNo = order.order_no;

        // 1. 若有扣款金額，先退回闆闆錢包 (實充 balance)
        const processRefund = new Promise((resolve, reject) => {
            if (refundAmount > 0 && bossId) {
                db.run(
                    "UPDATE users SET balance = balance + ? WHERE id = ?",
                    [refundAmount, bossId],
                    function (refundErr) {
                        if (refundErr) return reject(refundErr);

                        // 寫入錢包交易流水紀錄
                        db.run(`
                            INSERT INTO wallet_transactions (user_id, type, amount, description, created_at)
                            VALUES (?, 'order_refund', ?, ?, DATETIME('now', 'localtime'))
                        `, [bossId, refundAmount, `棄單/作廢退款 - 訂單號: ${orderNo}`], () => {});

                        resolve();
                    }
                );
            } else {
                resolve();
            }
        });

        processRefund.then(() => {
            // 🚀 2. 核心要求：直接從資料庫中刪除該筆訂單 (DELETE)
            db.run("DELETE FROM orders WHERE id = ?", [orderId], function (deleteErr) {
                if (deleteErr) {
                    console.error('❌ 刪除訂單失敗:', deleteErr);
                    return res.redirect('/management/orders?error=' + encodeURIComponent('刪除訂單失敗'));
                }

                try {
                    const { syncUsersJsonFromDb } = require('../utils/dataSync');
                    if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
                } catch (e) {}

                res.redirect('/management/orders?successMsg=' + encodeURIComponent(`訂單 ${orderNo} 已退款 $${refundAmount} NTD 並直接刪除！`));
            });
        }).catch((rErr) => {
            console.error('❌ 退款處理出錯:', rErr);
            res.redirect('/management/orders?error=' + encodeURIComponent('退款處理失敗'));
        });
    });
});

// 3.3 ✅ 手動完成訂單 (完成結算)
router.post('/orders/complete/:id', ensureAuth, (req, res) => {
    const orderId = req.params.id;

    db.run("UPDATE orders SET status = 'completed' WHERE id = ?", [orderId], function (err) {
        if (err) {
            return res.redirect('/management/orders?error=' + encodeURIComponent('更新失敗'));
        }
        res.redirect('/management/orders?successMsg=' + encodeURIComponent('訂單已標記為完成！'));
    });
});

module.exports = router;