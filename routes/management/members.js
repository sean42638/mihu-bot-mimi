const express = require('express');
const router = express.Router();
const db = require('../../database');
const { client } = require('../../bot');
const { syncUsersJsonFromDb } = require('../../utils/dataSync');
const { requireAuth: ensureAuth, requirePerm: checkPerm } = require('../../middleware/auth');

// 💡 零負數 Guardrail 解析函式
function parseNumericInput(inputVal, currentVal) {
    if (inputVal === undefined || inputVal === null || inputVal === '') return Math.max(0, currentVal);
    const str = String(inputVal).trim();
    let result = currentVal;

    if (str.startsWith('+')) {
        const delta = parseFloat(str.slice(1)) || 0;
        result = currentVal + delta;
    } else if (str.startsWith('-')) {
        const delta = parseFloat(str.slice(1)) || 0;
        result = currentVal - delta;
    } else {
        const val = parseFloat(str);
        result = isNaN(val) ? currentVal : val;
    }

    return Math.max(0, result);
}

// 1. 會員管理頁面
router.get('/', ensureAuth, checkPerm('manage_members'), (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, currentUser) => {
        const memberSql = `
            SELECT 
                u.*,
                COALESCE((SELECT SUM(total_amount) FROM orders WHERE boss_id = u.id AND status != 'cancelled'), 0) + COALESCE(u.manual_spent, 0) as total_spent,
                COALESCE((SELECT SUM(amount) FROM topups WHERE user_id = u.id AND amount > 0), 0) + COALESCE(u.manual_deposited, 0) as total_deposited
            FROM users u
            ORDER BY u.created_at DESC
        `;

        db.all(memberSql, (mErr, members) => {
            if (mErr) {
                return res.render('members', {
                    user: currentUser || req.user,
                    members: [],
                    success: false,
                    errorMsg: '查詢會員失敗'
                });
            }

            db.all('SELECT * FROM vip_tiers ORDER BY level ASC', (vErr, vipTiers) => {
                const tiers = vipTiers || [];

                const processedMembers = (members || []).map(m => {
                    const currentVip = Number(m.vip_level || 0);
                    const nextTier = tiers.find(t => Number(t.level) === currentVip + 1);

                    let vipGapText = '已達頂級';
                    let gapSpent = 0;
                    let gapDeposit = 0;

                    if (nextTier) {
                        gapSpent = Math.max(0, nextTier.spent_threshold - Number(m.total_spent || 0));
                        gapDeposit = Math.max(0, nextTier.deposit_threshold - Number(m.total_deposited || 0));
                        vipGapText = `消差 $${gapSpent.toLocaleString()} / 存差 $${gapDeposit.toLocaleString()}`;
                    }

                    return {
                        ...m,
                        total_balance: Number(m.balance || 0) + Number(m.bonus_balance || 0),
                        next_vip_name: nextTier ? nextTier.name : null,
                        gap_spent: gapSpent,
                        gap_deposit: gapDeposit,
                        vip_gap_text: vipGapText
                    };
                });

                res.render('members', {
                    user: currentUser || req.user,
                    members: processedMembers,
                    success: req.query.saved === '1',
                    errorMsg: req.query.error || null
                });
            });
        });
    });
});

// 2. 單一會員 Discord 資訊同步
router.get('/sync/:id', ensureAuth, checkPerm('manage_members'), async (req, res) => {
    const targetId = req.params.id;
    try {
        const dcUser = await client.users.fetch(targetId);
        if (dcUser) {
            db.run(
                'UPDATE users SET username = ?, global_name = ?, avatar = ? WHERE id = ?',
                [dcUser.username, dcUser.globalName || dcUser.username, dcUser.avatar, targetId],
                () => {
                    syncUsersJsonFromDb();
                    res.redirect('/management/members?saved=1');
                }
            );
            return;
        }
    } catch (e) {}
    res.redirect('/management/members?error=' + encodeURIComponent('同步失敗'));
});

// 3. 全員 Discord 資訊同步
router.get('/sync-all', ensureAuth, checkPerm('manage_members'), (req, res) => {
    db.all('SELECT id FROM users', async (err, rows) => {
        if (rows && rows.length > 0) {
            for (const r of rows) {
                try {
                    const dcUser = await client.users.fetch(r.id);
                    if (dcUser) {
                        db.run(
                            'UPDATE users SET username = ?, global_name = ?, avatar = ? WHERE id = ?',
                            [dcUser.username, dcUser.globalName || dcUser.username, dcUser.avatar, r.id]
                        );
                    }
                } catch (e) {}
            }
            syncUsersJsonFromDb();
        }
        res.redirect('/management/members?saved=1');
    });
});

// 4. 帳務調整 POST
router.post('/update-balance/:id', ensureAuth, checkPerm('member_adjust_balance'), (req, res) => {
    const targetId = req.params.id;
    const { add_amount, balance, bonus_balance, total_spent, total_deposited, note } = req.body;

    const statsSql = `
        SELECT 
            COALESCE((SELECT SUM(total_amount) FROM orders WHERE boss_id = ? AND status != 'cancelled'), 0) as order_spent,
            COALESCE((SELECT SUM(amount) FROM topups WHERE user_id = ? AND amount > 0), 0) as topup_deposited
    `;

    db.get('SELECT * FROM users WHERE id = ?', [targetId], (err, oldUser) => {
        if (err || !oldUser) {
            return res.redirect('/management/members?error=' + encodeURIComponent('找不到目標會員'));
        }

        db.get(statsSql, [targetId, targetId], (sErr, stats) => {
            const baseOrderSpent = stats ? stats.order_spent : 0;
            const baseTopupDeposited = stats ? stats.topup_deposited : 0;

            const currentSpent = baseOrderSpent + (oldUser.manual_spent || 0);
            const currentDeposited = baseTopupDeposited + (oldUser.manual_deposited || 0);

            let newBalance = oldUser.balance || 0;

            if (add_amount !== undefined && add_amount !== null && String(add_amount).trim() !== '') {
                const addVal = parseFloat(add_amount) || 0;
                newBalance = Math.max(0, newBalance + addVal);
            } else {
                newBalance = parseNumericInput(balance, newBalance);
            }

            const newBonus = parseNumericInput(bonus_balance, oldUser.bonus_balance || 0);
            const newSpentTotal = parseNumericInput(total_spent, currentSpent);
            const newDepositedTotal = parseNumericInput(total_deposited, currentDeposited);

            const newManualSpent = newSpentTotal - baseOrderSpent;
            const newManualDeposited = newDepositedTotal - baseTopupDeposited;

            const diffAmount = newBalance - Number(oldUser.balance || 0);
            const diffBonus = newBonus - Number(oldUser.bonus_balance || 0);

            db.all('SELECT * FROM vip_tiers ORDER BY level ASC', (vErr, tiers) => {
                let calculatedVip = 0;
                if (!vErr && tiers && tiers.length > 0) {
                    for (const t of tiers) {
                        if (newSpentTotal >= t.spent_threshold || newDepositedTotal >= t.deposit_threshold) {
                            calculatedVip = Number(t.level);
                        }
                    }
                }

                const updateSql = `
                    UPDATE users SET 
                        balance = ?, 
                        bonus_balance = ?, 
                        vip_level = ?, 
                        manual_spent = ?, 
                        manual_deposited = ? 
                    WHERE id = ?
                `;

                db.run(updateSql, [newBalance, newBonus, calculatedVip, newManualSpent, newManualDeposited, targetId], (uErr) => {
                    if (uErr) {
                        return res.redirect('/management/members?error=' + encodeURIComponent('更新資料庫失敗'));
                    }

                    if (diffAmount !== 0 || diffBonus !== 0) {
                        db.run(
                            'INSERT INTO topups (user_id, amount, bonus, channel_type, note, operator_id) VALUES (?, ?, ?, "後台調帳", ?, ?)',
                            [targetId, diffAmount, diffBonus, note || '後台帳務校正', req.user.id]
                        );
                    }
                    syncUsersJsonFromDb();
                    res.redirect('/management/members?saved=1');
                });
            });
        });
    });
});

// 5. VIP 調整 POST
router.post('/update-vip/:id', ensureAuth, checkPerm('member_adjust_vip'), (req, res) => {
    const targetId = req.params.id;
    const { vip_level, note } = req.body;

    db.get('SELECT vip_level FROM users WHERE id = ?', [targetId], (err, oldUser) => {
        if (err || !oldUser) {
            return res.redirect('/management/members?error=' + encodeURIComponent('找不到目標會員'));
        }

        const newVip = Math.round(parseNumericInput(vip_level, oldUser.vip_level || 0));

        db.run('UPDATE users SET vip_level = ? WHERE id = ?', [newVip, targetId], (uErr) => {
            if (uErr) {
                return res.redirect('/management/members?error=' + encodeURIComponent('VIP更新失敗'));
            }

            db.run(
                'INSERT INTO topups (user_id, amount, bonus, channel_type, note, operator_id) VALUES (?, 0, 0, "後台手動VIP調整", ?, ?)',
                [targetId, note || `手動調整VIP等級為 VIP ${newVip}`, req.user.id]
            );

            syncUsersJsonFromDb();
            res.redirect('/management/members?saved=1');
        });
    });
});

module.exports = router;