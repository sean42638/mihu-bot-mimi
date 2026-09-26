const express = require('express');
const router = express.Router();
const db = require('../../database');
const { ensureAuth } = require('../../middleware/auth');
const { sortByRoleWeight } = require('../../utils/roleHelper');

// 渲染「薪轉管理」獨立主頁面 (對應 /management/payroll)
router.get('/', ensureAuth, (req, res) => {
    const userRole = req.user ? String(req.user.role || '').toLowerCase() : 'member';
    const isAllowed = ['admin', 'cfo', 'manager', 'owner', 'administrator'].includes(userRole) 
        || (req.user && req.user.permissions && req.user.permissions.includes('staff_view_payroll'));

    if (!isAllowed) {
        return res.redirect('/dashboard?error=' + encodeURIComponent('🚫 您的身分無權存取薪轉管理頁面。'));
    }

    const allStudios = req.user.id === '604610298581876746' || req.user.role === 'admin';
    const studioFilter = allStudios ? '' : 'AND u.studio_id = ?';
    const studioParams = allStudios ? [] : [Number(req.user.studio_id) || 1];

    // 優先累計訂單建立時保存的陪玩收益與成數快照。
    const payrollSql = `
        SELECT u.*,
            COALESCE((
                SELECT SUM(
                    ROUND(
                        COALESCE(o.talent_earning,
                            COALESCE(NULLIF(o.unit_price, 0) * COALESCE(o.duration, 1), o.total_amount + COALESCE(o.discount, 0), o.total_amount)
                            * COALESCE(
                                o.commission_rate_snapshot,
                                (SELECT s.talent_share_rate FROM studio_services s WHERE s.id = o.service_id AND s.studio_id = o.studio_id),
                                (SELECT sc.talent_share_rate FROM studio_commissions sc WHERE sc.studio_id = o.studio_id AND sc.category = o.category),
                                (SELECT 1.0 - cs.rate FROM commission_settings cs WHERE cs.category = o.category),
                                CASE o.category
                                    WHEN '陪玩單' THEN 0.80
                                    WHEN '禮物單' THEN 0.85
                                    WHEN '有獎' THEN 0.90
                                    WHEN '有獎單' THEN 0.90
                                    WHEN '冠名' THEN 0.85
                                    WHEN '冠名單' THEN 0.85
                                    WHEN '獎金' THEN 1.00
                                    WHEN '活動單' THEN 0.90
                                    ELSE 0.80
                                END
                            )
                        )
                    )
                ) 
                FROM orders o 
                WHERE (o.staff_id = u.id OR o.talent_id = u.id) 
                  AND o.studio_id = u.studio_id
                  AND o.status = 'completed'
            ), 0) as accumulated_payout
        FROM users u
        WHERE (u.role != 'member' OR u.role IS NULL) ${studioFilter}
    `;

    db.all(payrollSql, studioParams, (err, staffPayrollList) => {
        if (err) {
            console.error('❌ 載入薪轉清單失敗:', err);
            staffPayrollList = [];
        }

        const sortedPayroll = typeof sortByRoleWeight === 'function' 
            ? sortByRoleWeight(staffPayrollList || [])
            : staffPayrollList;

        res.render('payroll', {
            staffList: sortedPayroll,
            currentUser: req.user,
            userPerms: req.user ? (req.user.permissions || []) : [],
            activePage: 'payroll',
            successMsg: req.query.successMsg || null,
            errorMsg: req.query.error || null
        });
    });
});

// 🚀 匯出薪轉 Excel/CSV 檔案 (對應 /management/payroll/export)
router.get('/export', ensureAuth, (req, res) => {
    const userRole = req.user ? String(req.user.role || '').toLowerCase() : 'member';
    const isAllowed = ['admin', 'cfo', 'manager', 'owner', 'administrator'].includes(userRole) 
        || (req.user && req.user.permissions && req.user.permissions.includes('staff_view_payroll'));

    if (!isAllowed) {
        return res.status(403).send('🚫 無權匯出薪轉資料');
    }

    const allStudios = req.user.id === '604610298581876746' || req.user.role === 'admin';
    const studioFilter = allStudios ? '' : 'AND u.studio_id = ?';
    const studioParams = allStudios ? [] : [Number(req.user.studio_id) || 1];

    // CSV also uses the stored order earning/snapshot before current fallbacks.
    const payrollSql = `
        SELECT u.username, u.custom_nickname, u.global_name, u.real_name, u.bank_name, u.bank_code, u.bank_branch, u.bank_account,
            COALESCE((
                SELECT SUM(
                    ROUND(
                        COALESCE(o.talent_earning,
                            COALESCE(NULLIF(o.unit_price, 0) * COALESCE(o.duration, 1), o.total_amount + COALESCE(o.discount, 0), o.total_amount)
                            * COALESCE(
                                o.commission_rate_snapshot,
                                (SELECT s.talent_share_rate FROM studio_services s WHERE s.id = o.service_id AND s.studio_id = o.studio_id),
                                (SELECT sc.talent_share_rate FROM studio_commissions sc WHERE sc.studio_id = o.studio_id AND sc.category = o.category),
                                (SELECT 1.0 - cs.rate FROM commission_settings cs WHERE cs.category = o.category),
                                CASE o.category
                                    WHEN '陪玩單' THEN 0.80
                                    WHEN '禮物單' THEN 0.85
                                    WHEN '有獎' THEN 0.90
                                    WHEN '有獎單' THEN 0.90
                                    WHEN '冠名' THEN 0.85
                                    WHEN '冠名單' THEN 0.85
                                    WHEN '獎金' THEN 1.00
                                    WHEN '活動單' THEN 0.90
                                    ELSE 0.80
                                END
                            )
                        )
                    )
                ) 
                FROM orders o 
                WHERE (o.staff_id = u.id OR o.talent_id = u.id) 
                  AND o.studio_id = u.studio_id
                  AND o.status = 'completed'
            ), 0) as accumulated_payout
        FROM users u
        WHERE (u.role != 'member' OR u.role IS NULL) ${studioFilter}
    `;

    db.all(payrollSql, studioParams, (err, rows) => {
        if (err) {
            console.error('❌ 匯出薪轉 CSV 出錯:', err);
            return res.status(500).send('匯出薪轉資料失敗');
        }

        let csvContent = '\uFEFF';
        csvContent += 'Discord帳號,員工暱稱,本名,銀行名稱,機構代碼,分行名稱,銀行帳戶,已累積薪資(NTD)\n';

        (rows || []).forEach(r => {
            const nickname = (r.custom_nickname || r.global_name || r.username || '').replace(/"/g, '""');
            const realName = (r.real_name || '未填寫').replace(/"/g, '""');
            const bankName = (r.bank_name || '未填寫').replace(/"/g, '""');
            const bankCode = r.bank_code || '';
            const bankBranch = (r.bank_branch || '未填寫').replace(/"/g, '""');
            const bankAccount = r.bank_account ? `\t${r.bank_account}` : '未填寫';
            const payout = Number(r.accumulated_payout || 0);

            csvContent += `"${r.username}","${nickname}","${realName}","${bankName}","${bankCode}","${bankBranch}","${bankAccount}",${payout}\n`;
        });

        const dateStr = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=MiHu_Payroll_${dateStr}.csv`);
        res.status(200).send(csvContent);
    });
});

module.exports = router;