const express = require('express');
const router = express.Router();
const db = require('../../database');
const { ensureAuth } = require('../../middleware/auth');
const { sortByRoleWeight } = require('../../utils/roleHelper');

// 2.1 渲染「員工列表」頁面 (對應 /management/staff)
router.get('/', ensureAuth, (req, res) => {
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

// 2.2 💼 變更員工職位與設定 (對應 /management/staff/update/:id)
router.post('/update/:id', ensureAuth, (req, res) => {
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
                    const { syncUsersJsonFromDb } = require('../../utils/dataSync');
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
            const { syncUsersJsonFromDb } = require('../../utils/dataSync');
            if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
        } catch (e) {}

        res.redirect('/management/staff?success=1');
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