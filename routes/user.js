const express = require('express');
const router = express.Router();
const db = require('../database');
const { syncUsersJsonFromDb, syncTalentsJsonFromDb, getCommissionData } = require('../utils/dataSync');
const { requireAuth: ensureAuth, requirePerm: checkPerm } = require('../middleware/auth');

// 首頁
router.get('/dashboard', ensureAuth, checkPerm('home'), (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, currentUser) => {
        db.get('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 1', (aErr, latestAnnouncement) => {
            res.render('dashboard', {
                user: currentUser || req.user,
                announcement: latestAnnouncement || null,
                error: req.query.error || null
            });
        });
    });
});

// 個人檔案
router.get('/profile', ensureAuth, checkPerm('profile'), (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, currentUser) => {
        res.render('profile', { user: currentUser || req.user, success: req.query.saved === '1' });
    });
});

router.post('/profile', ensureAuth, checkPerm('profile'), (req, res) => {
    const { custom_nickname, birthday, gender, age, mbti, real_name, bank_name, bank_code, bank_branch, bank_account } = req.body;
    const query = `UPDATE users SET custom_nickname = ?, birthday = ?, gender = ?, age = ?, mbti = ?, real_name = ?, bank_name = ?, bank_code = ?, bank_branch = ?, bank_account = ? WHERE id = ?`;
    db.run(query, [
        custom_nickname || null, birthday || null, gender || null, age ? parseInt(age, 10) : null, mbti || null,
        real_name || null, bank_name || null, bank_code || null, bank_branch || null, bank_account || null,
        req.user.id
    ], (err) => {
        if (err) return res.redirect('/profile?error=更新失敗');
        syncUsersJsonFromDb();
        res.redirect('/profile?saved=1');
    });
});

// 我的錢包
router.get('/wallet', ensureAuth, checkPerm('my_wallet'), (req, res) => {
    const userId = req.user.id;
    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, currentUser) => {
        if (err || !currentUser) return res.redirect('/dashboard?error=讀取使用者資料失敗');

        const statsSql = `SELECT COALESCE((SELECT SUM(total_amount) FROM orders WHERE boss_id = ? AND status != 'cancelled'), 0) + COALESCE(?, 0) as total_spent, COALESCE((SELECT SUM(amount) FROM topups WHERE user_id = ? AND amount > 0), 0) + COALESCE(?, 0) as total_deposited`;
        db.get(statsSql, [userId, currentUser.manual_spent || 0, userId, currentUser.manual_deposited || 0], (sErr, stats) => {
            db.all('SELECT * FROM vip_tiers ORDER BY level ASC', (vErr, vipTiers) => {
                const tiers = vipTiers || [];
                const spent = stats ? Number(stats.total_spent || 0) : 0;
                const deposited = stats ? Number(stats.total_deposited || 0) : 0;

                let calculatedVip = 0;
                for (const t of tiers) {
                    if ((t.spent_threshold > 0 && spent >= t.spent_threshold) || (t.deposit_threshold > 0 && deposited >= t.deposit_threshold)) {
                        calculatedVip = Math.max(calculatedVip, Number(t.level));
                    }
                }

                const currentVipInDb = Number(currentUser.vip_level || 0);
                const actualVip = Math.max(currentVipInDb, calculatedVip);

                if (calculatedVip > currentVipInDb) {
                    db.run('UPDATE users SET vip_level = ? WHERE id = ?', [calculatedVip, userId], () => syncUsersJsonFromDb());
                }

                const nextTier = tiers.find(t => Number(t.level) === actualVip + 1);
                let progressPercent = 0;
                let vipGapText = '尚無更高 VIP 門檻設定';

                if (nextTier) {
                    const spentPct = nextTier.spent_threshold > 0 ? (spent / nextTier.spent_threshold) * 100 : 0;
                    const depositPct = nextTier.deposit_threshold > 0 ? (deposited / nextTier.deposit_threshold) * 100 : 0;
                    progressPercent = Math.min(100, Math.max(0, Math.max(spentPct, depositPct)));
                    const gapSpent = Math.max(0, nextTier.spent_threshold - spent);
                    const gapDeposit = Math.max(0, nextTier.deposit_threshold - deposited);
                    vipGapText = `距離 ${nextTier.name || 'VIP ' + nextTier.level} 尚需消費 $${gapSpent.toLocaleString()} 或 預存 $${gapDeposit.toLocaleString()}`;
                } else if (tiers.length === 0) {
                    progressPercent = Math.min(100, (spent / 1000) * 100);
                    vipGapText = `距離 VIP 1 尚需消費 $${Math.max(0, 1000 - spent).toLocaleString()}`;
                } else {
                    progressPercent = 100;
                    vipGapText = '🎉 您已達到最高尊榮 VIP 等級！';
                }

                db.all('SELECT * FROM topups WHERE user_id = ? ORDER BY created_at DESC', [userId], (tErr, topups) => {
                    res.render('wallet', {
                        user: { ...currentUser, vip_level: actualVip },
                        stats: stats || { total_spent: 0, total_deposited: 0 },
                        progressPercent: progressPercent.toFixed(1),
                        vipGapText: vipGapText,
                        topups: topups || []
                    });
                });
            });
        });
    });
});

// 我的收入 (僅採計 status = 'completed' 已完成訂單)
router.get('/income', ensureAuth, checkPerm('my_income'), (req, res) => {
    const userId = req.user.id;

    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, currentUser) => {
        db.get('SELECT commission_rate FROM talents WHERE user_id = ?', [userId], (tErr, talentRow) => {
            const globalCommissions = getCommissionData();
            
            const personalRate = (talentRow && talentRow.commission_rate !== null && talentRow.commission_rate !== undefined && talentRow.commission_rate > 0) 
                ? Number(talentRow.commission_rate) 
                : null;

            if (!talentRow && currentUser) {
                db.run('INSERT OR IGNORE INTO talents (user_id, nickname, commission_rate, status) VALUES (?, ?, NULL, "idle")', 
                    [userId, currentUser.custom_nickname || currentUser.username], 
                    () => syncTalentsJsonFromDb()
                );
            }

            const orderSql = `
                SELECT 
                    o.*,
                    b.username as boss_username,
                    b.global_name as boss_global_name,
                    b.custom_nickname as boss_nickname,
                    b.avatar as boss_avatar
                FROM orders o
                LEFT JOIN users b ON o.boss_id = b.id
                WHERE o.talent_id = ?
                ORDER BY o.created_at DESC
            `;

            db.all(orderSql, [userId], (oErr, orders) => {
                const orderList = orders || [];
                const completedOrders = orderList.filter(o => o.status === 'completed');

                // 算總收入
                const totalIncome = completedOrders.reduce((sum, o) => {
                    const cat = o.category || '陪玩單';
                    const rate = (personalRate !== null && personalRate > 0) 
                        ? personalRate 
                        : (globalCommissions[cat] !== undefined ? globalCommissions[cat] : 0.7);
                    return sum + Math.round(Number(o.total_amount || 0) * rate);
                }, 0);

                // 算當月收入
                const currentMonthPrefix = new Date().toISOString().slice(0, 7);
                const monthlyOrders = completedOrders.filter(o => {
                    const dateStr = o.end_time || o.created_at || '';
                    return dateStr.startsWith(currentMonthPrefix);
                });
                
                const monthlyIncome = monthlyOrders.reduce((sum, o) => {
                    const cat = o.category || '陪玩單';
                    const rate = (personalRate !== null && personalRate > 0) 
                        ? personalRate 
                        : (globalCommissions[cat] !== undefined ? globalCommissions[cat] : 0.7);
                    return sum + Math.round(Number(o.total_amount || 0) * rate);
                }, 0);

                db.get('SELECT COALESCE(SUM(amount), 0) as total_withdrawn FROM payouts WHERE user_id = ? AND status = "completed"', [userId], (pErr, payoutStats) => {
                    const totalWithdrawn = payoutStats ? Number(payoutStats.total_withdrawn) : 0;
                    const availableToWithdraw = Math.max(0, totalIncome - totalWithdrawn);

                    res.render('income', {
                        user: currentUser || req.user,
                        personalRate: personalRate,
                        globalCommissions: globalCommissions,
                        commissionRate: personalRate || globalCommissions['陪玩單'] || 0.7,
                        stats: {
                            totalIncome: totalIncome,
                            monthlyIncome: monthlyIncome,
                            totalWithdrawn: totalWithdrawn,
                            availableToWithdraw: availableToWithdraw
                        },
                        orders: orderList
                    });
                });
            });
        });
    });
});

// 我的訂單
router.get('/my-orders', ensureAuth, checkPerm('my_orders'), (req, res) => {
    const userId = req.user.id;
    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, currentUser) => {
        const orderSql = `SELECT o.*, b.username as boss_username, b.global_name as boss_global_name, b.custom_nickname as boss_nickname, b.avatar as boss_avatar, t.username as talent_username, t.global_name as talent_global_name, t.custom_nickname as talent_nickname, t.avatar as talent_avatar FROM orders o LEFT JOIN users b ON o.boss_id = b.id LEFT JOIN users t ON o.talent_id = t.id WHERE o.boss_id = ? OR o.talent_id = ? ORDER BY o.created_at DESC`;
        db.all(orderSql, [userId, userId], (oErr, orders) => {
            res.render('my_orders', { user: currentUser || req.user, orders: orders || [] });
        });
    });
});

module.exports = router;