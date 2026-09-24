// 🚀 米胡電競 MiHu Gaming · 獨立權限控管與身分限制中間件 (middleware/auth.js)
const fs = require('fs');
const path = require('path');

/**
 * 檢查使用者是否已登入 Express Session
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(401).json({ success: false, message: '未登入或 Session 已過期' });
    }
    return res.redirect('/auth/login');
}

/**
 * 依據權限 Key 檢查使用者是否具備存取權限 (動態讀取 data/roles.json)
 * @param {string} requiredPermission - 權限 Key (例: 'manage_members', 'sys_roles')
 */
function requirePerm(requiredPermission) {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.status(401).json({ success: false, message: '請先登入系統' });
            }
            return res.redirect('/auth/login');
        }

        const userRole = req.session.user.role || 'user';

        // 1. 最高管理員 admin 預設擁有全站通行權限
        if (userRole === 'admin') {
            return next();
        }

        // 2. 動態讀取 data/roles.json 比對授權
        try {
            const rolesJsonPath = path.join(__dirname, '..', 'data', 'roles.json');
            if (fs.existsSync(rolesJsonPath)) {
                const rolesData = JSON.parse(fs.readFileSync(rolesJsonPath, 'utf8'));
                const allowedPerms = rolesData[userRole] || [];

                if (allowedPerms.includes(requiredPermission)) {
                    return next();
                }
            }
        } catch (err) {
            console.error('⚠️ [Auth Middleware] 讀取 roles.json 失敗:', err);
        }

        // 3. 權限不足則擋下
        console.warn(`🚨 [Permission Denied] ${req.session.user.username} (${userRole}) 嘗試存取未授權路由 [${requiredPermission}]: ${req.originalUrl}`);

        if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(403).json({ success: false, message: '權限不足，無法執行此操作' });
        }

        return res.status(403).send(`
            <script>
                alert('⚠️ 您的帳號身分 (${userRole}) 無權限存取此功能！');
                window.location.href = '/dashboard';
            </script>
        `);
    };
}

module.exports = {
    requireAuth,
    requirePerm
};