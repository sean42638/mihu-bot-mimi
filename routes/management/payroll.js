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

    const payrollSql = `
        SELECT u.*,
            COALESCE((
                SELECT SUM(
                    ROUND(
                        o.total_amount * COALESCE(
                            u.commission_rate,
                            CASE o.category 
                                WHEN '陪玩單' THEN 0.8
                                WHEN '禮物單' THEN 0.85
                                WHEN '有獎' THEN 0.9
                                WHEN '冠名' THEN 0.85
                                ELSE 0.8
                            END
                        )
                    )
                ) 
                FROM orders o 
                WHERE (o.staff_id = u.id OR o.talent_id = u.id) 
                  AND o.status = 'completed'
            ), 0) as accumulated_payout
        FROM users u
        WHERE u.role != 'member' OR u.role IS NULL
    `;

    db.all(payrollSql, [], (err, staffPayrollList) => {
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

    const payrollSql = `
        SELECT u.username, u.custom_nickname, u.global_name, u.real_name, u.bank_name, u.bank_code, u.bank_branch, u.bank_account,
            COALESCE((
                SELECT SUM(
                    ROUND(
                        o.total_amount * COALESCE(
                            u.commission_rate,
                            CASE o.category 
                                WHEN '陪玩單' THEN 0.8
                                WHEN '禮物單' THEN 0.85
                                WHEN '有獎' THEN 0.9
                                WHEN '冠名' THEN 0.85
                                ELSE 0.8
                            END
                        )
                    )
                ) 
                FROM orders o 
                WHERE (o.staff_id = u.id OR o.talent_id = u.id) 
                  AND o.status = 'completed'
            ), 0) as accumulated_payout
        FROM users u
        WHERE u.role != 'member' OR u.role IS NULL
    `;

    db.all(payrollSql, [], (err, rows) => {
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