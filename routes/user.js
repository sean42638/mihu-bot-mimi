const express = require('express');
const router = express.Router();
const db = require('../database');
const { syncUsersJsonFromDb, syncTalentsJsonFromDb, getCommissionData } = require('../utils/dataSync');
const { requireAuth: ensureAuth, requirePerm: checkPerm } = require('../middleware/auth');

// =========================================================================
// 1. 首頁 (Dashboard)
// =========================================================================
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

// =========================================================================
// 2. 個人檔案 (Profile)
// =========================================================================
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

// =========================================================================
// 3. 我的錢包模組 (Wallet) 🚀 完全對接獨立資金庫，排除名稱歧義
// =========================================================================
router.get('/wallet', ensureAuth, checkPerm('my_wallet'), (req, res) => {
    const userId = req.user.id;
    
    // 🚀 1. 核心整合：使用 LEFT JOIN 讀取 user_wallets，確保名稱精準對齊
    const userWalletSql = `
        SELECT u.*,
            COALESCE(w.balance, u.balance, 0) as balance,
            COALESCE(w.bonus_balance, u.bonus_balance, 0) as bonus_balance,
            COALESCE(w.manual_spent, u.manual_spent, 0) as manual_spent,
            COALESCE(w.manual_deposited, u.manual_deposited, 0) as manual_deposited
        FROM users u
        LEFT JOIN user_wallets w ON u.id = w.user_id
        WHERE u.id = ?
    `;

    db.get(userWalletSql, [userId], (err, currentUser) => {
        if (err || !currentUser) return res.redirect('/dashboard?error=讀取使用者資料失敗');

        // 💰 目前可用餘額 (balance) 與 贈送餘額 (bonus_balance)
        const currentBalance = Number(currentUser.balance || 0);
        const bonusBalance = Number(currentUser.bonus_balance || 0);
        const totalBalance = currentBalance + bonusBalance;

        // 💰 總累積消費 (manual_spent) 與 總累積實充 (manual_deposited)
        const spent = Number(currentUser.manual_spent || 0);
        const deposited = Number(currentUser.manual_deposited || 0);

        db.all('SELECT * FROM vip_tiers ORDER BY CAST(level AS INTEGER) ASC', (vErr, vipTiers) => {
            const tiers = vipTiers || [];

            // 👑 計算動態 VIP (雙軌制比對)
            let calculatedVip = 0;
            for (const t of tiers) {
                const reqSpent = Number(t.spent_threshold ?? t.min_spent ?? 0);
                const reqDeposit = Number(t.deposit_threshold ?? t.min_deposit ?? 0);
                const tierLevel = Number(t.level || 0);

                if ((reqSpent > 0 && spent >= reqSpent) || (reqDeposit > 0 && deposited >= reqDeposit)) {
                    calculatedVip = Math.max(calculatedVip, tierLevel);
                }
            }

            // 更新 Users 表中的 VIP 等級
            if (calculatedVip !== Number(currentUser.vip_level || 0)) {
                db.run('UPDATE users SET vip_level = ? WHERE id = ?', [calculatedVip, userId], () => {
                    try {
                        const { syncUsersJsonFromDb } = require('../utils/dataSync');
                        if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
                    } catch(e) {}
                });
            }

            const actualVip = calculatedVip;

            // 🌟 VIP 進度條計算
            const nextTier = tiers.find(t => Number(t.level) === actualVip + 1);
            let progressPercent = 0;
            let vipGapText = '尚無更高 VIP 門檻設定';

            if (nextTier) {
                const reqSpent = Number(nextTier.spent_threshold ?? nextTier.min_spent ?? 0);
                const reqDeposit = Number(nextTier.deposit_threshold ?? nextTier.min_deposit ?? 0);

                const spentPct = reqSpent > 0 ? (spent / reqSpent) * 100 : 0;
                const depositPct = reqDeposit > 0 ? (deposited / reqDeposit) * 100 : 0;

                progressPercent = Math.min(100, Math.max(0, Math.max(spentPct, depositPct)));

                const gapSpent = Math.max(0, reqSpent - spent);
                const gapDeposit = Math.max(0, reqDeposit - deposited);
                vipGapText = `距離 ${nextTier.name || 'VIP ' + nextTier.level} 尚需消費 $${gapSpent.toLocaleString()} 或 預存 $${gapDeposit.toLocaleString()}`;
            } else if (tiers.length === 0) {
                progressPercent = Math.min(100, (spent / 1000) * 100);
                vipGapText = `距離 VIP 1 尚需消費 $${Math.max(0, 1000 - spent).toLocaleString()}`;
            } else {
                progressPercent = 100;
                vipGapText = '🎉 您已達到最高尊榮 VIP 等級！';
            }

            // 📜 撈取點單歷史與流水
            const ordersSql = `
                SELECT o.*, 
                       t.username as talent_username, t.global_name as talent_global_name, t.custom_nickname as talent_nickname
                FROM orders o
                LEFT JOIN users t ON (o.talent_id = t.id OR o.staff_id = t.id)
                WHERE o.boss_id = ?
                ORDER BY o.created_at DESC
            `;

            db.all(ordersSql, [userId], (oErr, orders) => {
                const txSql = `SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC`;
                db.all(txSql, [userId], (txErr, transactions) => {
                    db.all('SELECT * FROM topups WHERE user_id = ? ORDER BY created_at DESC', [userId], (tErr, topups) => {

                        // 🚀 將對齊後的變數回傳給 frontend
                        res.render('wallet', {
                            user: { 
                                ...currentUser, 
                                vip_level: actualVip,
                                total_balance: totalBalance,
                                balance: currentBalance,
                                bonus_balance: bonusBalance,
                                manual_spent: spent,
                                manual_deposited: deposited // 👈 絕對對齊：累積實充
                            },
                            stats: {
                                total_spent: spent,
                                total_deposited: deposited // 👈 絕對對齊：累積實充
                            },
                            progressPercent: progressPercent.toFixed(1),
                            vipGapText: vipGapText,
                            orders: orders || [],             
                            transactions: transactions || [], 
                            topups: topups || [],
                            activePage: 'wallet'
                        });

                    });
                });
            });
        });
    });
});

// =========================================================================
// 4. 我的收入 (Income) - 保持不變
// =========================================================================
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
                WHERE o.talent_id = ? OR o.staff_id = ?
                ORDER BY o.created_at DESC
            `;

            db.all(orderSql, [userId, userId], (oErr, orders) => {
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

// =========================================================================
// 5. 我的訂單 (My Orders) - 保持不變
// =========================================================================
router.get('/my-orders', ensureAuth, (req, res) => {
    const currentUserId = req.user.id;

    const myOrdersSql = `
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
        WHERE o.boss_id = ? 
        ORDER BY o.created_at DESC
    `;

    db.all(myOrdersSql, [currentUserId], (err, orders) => {
        if (err) {
            console.error('❌ 讀取個人訂單失敗:', err);
            return res.status(500).send('讀取個人訂單失敗');
        }

        res.render('my_orders', {
            user: req.user,
            orders: orders || [],
            activePage: 'my-orders'
        });
    });
});

module.exports = router;