const express = require('express');
const router = express.Router();
const db = require('../../database');
const { ensureAuth } = require('../../middleware/auth');
const { sortByRoleWeight } = require('../../utils/roleHelper');
const { normalizeTalentShareRate } = require('../../utils/commissionHelper');

// 2.1 渲染「員工列表」頁面 (對應 /management/staff)
router.get('/', ensureAuth, (req, res) => {
    const userPerms = Array.isArray(res.locals.userPerms) ? res.locals.userPerms : [];
    const canViewAllStudios = req.user.id === '604610298581876746' || req.user.role === 'admin' || userPerms.includes('sys_commission');
    const studioFilter = canViewAllStudios ? '' : 'AND u.studio_id = ?';
    const queryParams = canViewAllStudios ? [] : [Number(req.user.studio_id) || 1];
    const safeStaffSql = `
        SELECT u.*, t.commission_rate AS talent_commission_rate,
            COALESCE((SELECT COUNT(*) FROM orders WHERE (staff_id = u.id OR player_id = u.id) AND studio_id = u.studio_id AND status = 'completed'), 0) as total_orders,
            COALESCE((SELECT SUM(total_amount) FROM orders WHERE (staff_id = u.id OR player_id = u.id) AND studio_id = u.studio_id AND status = 'completed'), 0) as total_revenue
        FROM users u 
        LEFT JOIN talents t ON t.user_id = u.id
        WHERE (u.role IN ('admin', 'cfo', 'aftersales', 'after_sales', 'manager', 'cs_director', 'cs', 'staff', 'talent')
           OR u.role IS NULL
           OR u.role != 'member') ${studioFilter}
    `;

    db.all(safeStaffSql, queryParams, (err, staffList) => {
        if (err) {
            console.error('❌ 載入員工清單 SQL 錯誤:', err);
            const fallbackSql = `SELECT u.*, t.commission_rate AS talent_commission_rate FROM users u LEFT JOIN talents t ON t.user_id = u.id WHERE (u.role != 'member' OR u.role IS NULL) ${studioFilter}`;
            db.all(fallbackSql, queryParams, (fbErr, fbList) => {
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

// 2.2 💼 變更員工職位與設定 (對應 /management/staff/update/:id)
router.post('/update/:id', ensureAuth, (req, res) => {
    const targetStaffId = req.params.id;
    const { role, status, commission_rate, staff_channel_id } = req.body;
    const userPerms = Array.isArray(res.locals.userPerms) ? res.locals.userPerms : [];
    const isPlatformAdmin = req.user.id === '604610298581876746' || req.user.role === 'admin';
    const canManageStaff = isPlatformAdmin || userPerms.includes('manage_staff');
    const canEditCommission = isPlatformAdmin || userPerms.includes('staff_edit_role_commission');

    if (!canManageStaff) return res.status(403).send('無權管理員工');

    db.get('SELECT studio_id FROM users WHERE id = ?', [targetStaffId], (targetErr, targetUser) => {
        if (targetErr || !targetUser) return res.redirect('/management/staff?error=' + encodeURIComponent('找不到員工'));
        if (!isPlatformAdmin && Number(targetUser.studio_id) !== (Number(req.user.studio_id) || 1)) {
            return res.status(403).send('無權管理其他工作室員工');
        }

        const newRole = role || 'staff';
        const normalizedRate = canEditCommission ? normalizeTalentShareRate(commission_rate) : null;
        const parsedRate = canEditCommission && normalizedRate > 0 ? normalizedRate : null;
        const updateUserSql = canEditCommission
            ? 'UPDATE users SET role = ?, status = ?, commission_rate = ?, staff_channel_id = ? WHERE id = ?'
            : 'UPDATE users SET role = ?, status = ?, staff_channel_id = ? WHERE id = ?';
        const updateUserParams = canEditCommission
            ? [newRole, status || 'idle', parsedRate, staff_channel_id || null, targetStaffId]
            : [newRole, status || 'idle', staff_channel_id || null, targetStaffId];

        db.run(updateUserSql, updateUserParams, (err) => {
            if (err) return res.redirect('/management/staff?error=' + encodeURIComponent('員工更新失敗'));

            const updateTalentSql = canEditCommission
                ? 'UPDATE talents SET status = ?, commission_rate = ?, staff_channel_id = ? WHERE user_id = ?'
                : 'UPDATE talents SET status = ?, staff_channel_id = ? WHERE user_id = ?';
            const updateTalentParams = canEditCommission
                ? [status || 'idle', parsedRate, staff_channel_id || null, targetStaffId]
                : [status || 'idle', staff_channel_id || null, targetStaffId];
            db.run(updateTalentSql, updateTalentParams, () => {
                if (req.user && req.user.id === targetStaffId) req.user.role = newRole;
                try {
                    const { syncUsersJsonFromDb, syncTalentsJsonFromDb } = require('../../utils/dataSync');
                    syncUsersJsonFromDb();
                    syncTalentsJsonFromDb();
                } catch (e) {}
                res.redirect('/management/staff?success=1');
            });
        });
    });
});

// 2.3 單一員工 Discord 刷洗 (對應 /management/staff/sync/:id)
router.get('/sync/:id', ensureAuth, async (req, res) => {
    res.redirect('/management/staff?success=1');
});

// 2.4 全體員工 Discord 刷洗 (對應 /management/staff/sync-all)
router.get('/sync-all', ensureAuth, async (req, res) => {
    res.redirect('/management/staff?success=1');
});

module.exports = router;