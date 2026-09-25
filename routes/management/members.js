const express = require('express');
const router = express.Router();
const db = require('../../database');
const { ensureAuth } = require('../../middleware/auth');
const { sortByRoleWeight } = require('../../utils/roleHelper');
const { adjustUserWallet } = require('../../utils/walletHelper');

// 1.1 渲染「會員管理」頁面 (完整讀取 user_wallets 獨立資金表與連動 VIP)
router.get('/', ensureAuth, (req, res) => {
    const membersSql = `
        SELECT u.*,
            COALESCE(w.balance, u.balance, 0) as balance,
            COALESCE(w.bonus_balance, u.bonus_balance, 0) as bonus_balance,
            COALESCE(w.manual_spent, u.manual_spent, 0) as manual_spent,
            COALESCE(w.manual_deposited, u.manual_deposited, 0) as manual_deposited,
            (COALESCE(w.balance, u.balance, 0) + COALESCE(w.bonus_balance, u.bonus_balance, 0)) as total_balance,
            COALESCE((SELECT SUM(total_amount) FROM orders WHERE boss_id = u.id AND status != 'cancelled'), 0) + COALESCE(w.manual_spent, u.manual_spent, 0) as total_spent,
            COALESCE((SELECT SUM(amount) FROM topups WHERE user_id = u.id AND amount > 0), 0) + COALESCE(w.manual_deposited, u.manual_deposited, 0) as total_deposited
        FROM users u 
        LEFT JOIN user_wallets w ON u.id = w.user_id
    `;

    db.all(membersSql, [], (err, rawMembers) => {
        if (err) {
            console.error('❌ 載入會員清單失敗:', err);
            return res.status(500).send('資料庫讀取錯誤');
        }

        db.all('SELECT * FROM vip_tiers ORDER BY level ASC', [], (vErr, vipTiers) => {
            const tiers = vipTiers || [];
            
            const processedMembers = (rawMembers || []).map(m => {
                const spent = Number(m.total_spent || 0);
                const deposited = Number(m.total_deposited || 0);

                // 🚀 即時根據最新 (訂單 + 手動消費) 與 (儲值 + 手動實充) 計算 VIP 等級
                let currentVip = Number(m.vip_level || 0);
                for (const tier of tiers) {
                    if (spent >= Number(tier.spent_threshold || 0) || deposited >= Number(tier.deposit_threshold || 0)) {
                        currentVip = Math.max(currentVip, Number(tier.level));
                    }
                }

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
                    vip_level: currentVip,
                    total_balance: Number(m.total_balance || 0),
                    balance: Number(m.balance || 0),
                    bonus_balance: Number(m.bonus_balance || 0),
                    manual_spent: Number(m.manual_spent || 0),
                    manual_deposited: Number(m.manual_deposited || 0),
                    gap_spent: gapSpent,
                    gap_deposit: gapDeposit,
                    vip_gap_text: gapText
                };
            });

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
router.get('/sync/:id', ensureAuth, async (req, res) => {
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
router.get('/sync-all', ensureAuth, async (req, res) => {
    res.redirect('/management/members?success=1');
});

// 1.4 手動更新會員帳務金額 API (修正欄位對接)
router.post('/update-balance/:id', ensureAuth, async (req, res) => {
    const targetUserId = req.params.id;
    // 🚀 從 req.body 撈取前端表單送出的欄位名稱
    const { add_amount, bonus_change, bonus_balance, balance, total_spent, total_deposited, note } = req.body;

    try {
        await adjustUserWallet({
            userId: targetUserId,
            addAmount: add_amount !== undefined && add_amount !== '' ? add_amount : null,
            bonusChange: bonus_change !== undefined && bonus_change !== '' ? bonus_change : (bonus_balance !== undefined && bonus_balance !== '' ? bonus_balance : null),
            overrideBalance: balance !== undefined && balance !== '' ? balance : null,
            overrideSpent: total_spent !== undefined && total_spent !== '' ? total_spent : null,         // 🚀 精準對接 total_spent
            overrideDeposited: total_deposited !== undefined && total_deposited !== '' ? total_deposited : null, // 🚀 精準對接 total_deposited
            reason: note || '管理員手動調整帳務',
            operatorId: req.user ? req.user.id : null
        });

        try {
            const { syncUsersJsonFromDb } = require('../../utils/dataSync');
            if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
        } catch (e) {}

        res.redirect('/management/members?success=1');
    } catch (err) {
        console.error('❌ 帳務調整失敗:', err.message);
        res.redirect('/management/members?error=' + encodeURIComponent(err.message));
    }
});

// 1.5 👑 手動更新 VIP 等級與後台身分 (Role)
router.post('/update-vip/:id', ensureAuth, (req, res) => {
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
                    const { syncUsersJsonFromDb } = require('../../utils/dataSync');
                    if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
                } catch (e) {}

                res.redirect('/management/members?success=1');
            }
        );
    });
});

module.exports = router;