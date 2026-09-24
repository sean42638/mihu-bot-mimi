const express = require('express');
const router = express.Router();
const db = require('../../database');
const { client } = require('../../bot');
const { syncUsersJsonFromDb, syncTalentsJsonFromDb } = require('../../utils/dataSync');
const { requireAuth: ensureAuth, requirePerm: checkPerm } = require('../../middleware/auth');

// 1. 員工管理列表
router.get('/', ensureAuth, checkPerm('manage_staff'), (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, currentUser) => {
        const staffSql = `
            SELECT 
                u.*,
                t.status,
                t.commission_rate,
                t.staff_channel_id,
                COALESCE((SELECT COUNT(*) FROM orders WHERE talent_id = u.id AND status = 'completed'), 0) as total_orders,
                COALESCE((SELECT SUM(total_amount) FROM orders WHERE talent_id = u.id AND status = 'completed'), 0) as total_revenue
            FROM users u
            LEFT JOIN talents t ON u.id = t.user_id
            WHERE u.role != 'member'
            ORDER BY u.created_at ASC
        `;

        db.all(staffSql, (sErr, staffList) => {
            res.render('staff', {
                user: currentUser || req.user,
                staffList: staffList || [],
                success: req.query.saved === '1'
            });
        });
    });
});

// 2. 單一員工 Discord 資訊同步
router.get('/sync/:id', ensureAuth, checkPerm('manage_staff'), async (req, res) => {
    const targetId = req.params.id;
    try {
        const dcUser = await client.users.fetch(targetId);
        if (dcUser) {
            db.run(
                'UPDATE users SET username = ?, global_name = ?, avatar = ? WHERE id = ?',
                [dcUser.username, dcUser.globalName || dcUser.username, dcUser.avatar, targetId],
                () => {
                    syncUsersJsonFromDb();
                    res.redirect('/management/staff?saved=1');
                }
            );
            return;
        }
    } catch (e) {}
    res.redirect('/management/staff');
});

// 3. 全體員工 Discord 資訊同步
router.get('/sync-all', ensureAuth, checkPerm('manage_staff'), (req, res) => {
    db.all("SELECT id FROM users WHERE role != 'member'", async (err, rows) => {
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
        res.redirect('/management/staff?saved=1');
    });
});

// 4. 更新員工身分組、狀態與專屬頻道 POST
router.post('/update/:id', ensureAuth, checkPerm('manage_staff'), (req, res) => {
    const targetId = req.params.id;
    const { role, status, commission_rate, staff_channel_id } = req.body;

    const parsedRate = (commission_rate !== undefined && commission_rate !== null && String(commission_rate).trim() !== '') 
        ? parseFloat(commission_rate) 
        : null;

    db.run('UPDATE users SET role = ? WHERE id = ?', [role, targetId], (uErr) => {
        if (uErr) return res.redirect('/management/staff?error=更新失敗');
        syncUsersJsonFromDb();

        db.get('SELECT user_id FROM talents WHERE user_id = ?', [targetId], (tErr, talentRow) => {
            if (!talentRow) {
                db.run(
                    'INSERT INTO talents (user_id, nickname, staff_channel_id, commission_rate, status) VALUES (?, ?, ?, ?, ?)',
                    [targetId, '', staff_channel_id || null, parsedRate, status || 'idle'],
                    () => {
                        syncTalentsJsonFromDb();
                        res.redirect('/management/staff?saved=1');
                    }
                );
            } else {
                db.run(
                    'UPDATE talents SET status = ?, commission_rate = ?, staff_channel_id = ? WHERE user_id = ?',
                    [status || 'idle', parsedRate, staff_channel_id || null, targetId],
                    () => {
                        syncTalentsJsonFromDb();
                        res.redirect('/management/staff?saved=1');
                    }
                );
            }
        });
    });
});

module.exports = router;