const express = require('express');
const router = express.Router();
const db = require('../database');
const { 
    saveVipJsonFromDb, getRolesData, saveRolesData, 
    getCommissionData, saveCommissionData, syncCommandsJsonFromDb 
} = require('../utils/dataSync');
const { requireAuth: ensureAuth, requirePerm: checkPerm } = require('../middleware/auth');

// 機器人指令設定
router.get('/system/bot-settings', ensureAuth, checkPerm('sys_settings'), (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, currentUser) => {
        db.all('SELECT * FROM bot_commands ORDER BY id ASC', (cErr, commands) => {
            res.render('system_bot_settings', { user: currentUser || req.user, commands: commands || [], success: req.query.saved === '1' });
        });
    });
});

router.post('/system/bot-settings/add', ensureAuth, checkPerm('sys_settings'), (req, res) => {
    const { name, command_key, min_role, description } = req.body;
    db.run('INSERT INTO bot_commands (name, command_key, min_role, description, status) VALUES (?, ?, ?, ?, "enabled")',
        [name, command_key, min_role || 'member', description || ''], (err) => {
            if (!err) syncCommandsJsonFromDb();
            res.redirect('/system/bot-settings?saved=1');
        });
});

// VIP 設定
router.get('/system/vip', ensureAuth, checkPerm('sys_vip'), (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, currentUser) => {
        db.all('SELECT * FROM vip_tiers ORDER BY level ASC', (vErr, tiers) => {
            res.render('vip', { user: currentUser || req.user, vipTiers: tiers || [], success: req.query.saved === '1' });
        });
    });
});

router.post('/system/vip/update/:level', ensureAuth, checkPerm('sys_vip'), (req, res) => {
    const level = req.params.level;
    const { spent_threshold, deposit_threshold } = req.body;
    let rewards = req.body['rewards[]'] || req.body.rewards || [];
    if (!Array.isArray(rewards)) rewards = [rewards];
    rewards = rewards.map(r => r.trim()).filter(Boolean);

    db.run('UPDATE vip_tiers SET spent_threshold = ?, deposit_threshold = ?, rewards = ?, updated_at = CURRENT_TIMESTAMP WHERE level = ?',
        [spent_threshold, deposit_threshold, JSON.stringify(rewards), level], (err) => {
            if (err) return res.redirect('/system/vip?error=更新失敗');
            saveVipJsonFromDb();
            res.redirect('/system/vip?saved=1');
        });
});

router.post('/system/vip/add', ensureAuth, checkPerm('sys_vip'), (req, res) => {
    const { level, name, spent_threshold, deposit_threshold, initial_reward } = req.body;
    const rewards = initial_reward ? [initial_reward.trim()] : [];

    db.run('INSERT INTO vip_tiers (level, name, spent_threshold, deposit_threshold, rewards) VALUES (?, ?, ?, ?, ?)',
        [level, name, spent_threshold, deposit_threshold, JSON.stringify(rewards)], (err) => {
            if (err) return res.redirect('/system/vip?error=新增失敗');
            saveVipJsonFromDb();
            res.redirect('/system/vip?saved=1');
        });
});

// 全域抽佣設定
router.get('/system/commission', ensureAuth, checkPerm('sys_commission'), (req, res) => {
    res.render('commission', { user: req.user, activePage: 'commission', commission: getCommissionData(), success: req.query.saved === '1' });
});

router.post('/system/commission/update', ensureAuth, checkPerm('sys_commission'), (req, res) => {
    try {
        const { rates } = req.body;
        const currentData = getCommissionData();
        if (rates && typeof rates === 'object') {
            for (const key in rates) {
                const val = parseFloat(rates[key]);
                if (!isNaN(val)) currentData[key] = Math.min(1, Math.max(0, val));
            }
            saveCommissionData(currentData);
        }
        res.redirect('/system/commission?saved=1');
    } catch (err) {
        res.redirect('/system/commission?error=' + encodeURIComponent('更新失敗'));
    }
});

// 身分權限管理
router.get('/system/roles', ensureAuth, checkPerm('sys_roles'), (req, res) => {
    const rolesData = getRolesData();
    res.render('roles', { user: req.user, activePage: 'roles', roles: rolesData, rolesData, saved: req.query.saved === '1' });
});

router.post('/system/roles/update-permissions', ensureAuth, checkPerm('sys_roles'), (req, res) => {
    try {
        const { role, permissions } = req.body;
        if (!role) return res.status(400).send('<script>alert("目標身分組不可為空！"); history.back();</script>');
        const permsArray = Array.isArray(permissions) ? permissions : (permissions ? [permissions] : []);
        let rolesArray = getRolesData();
        if (!Array.isArray(rolesArray)) rolesArray = [];

        const roleIndex = rolesArray.findIndex(r => r.role_key === role);
        if (roleIndex !== -1) {
            rolesArray[roleIndex].permissions = permsArray;
            saveRolesData(rolesArray);
        }
        return res.redirect('/system/roles?saved=1');
    } catch (err) {
        return res.redirect('/system/roles?error=' + encodeURIComponent('權限更新失敗'));
    }
});

router.post('/system/roles/update-info/:id', ensureAuth, checkPerm('sys_roles'), (req, res) => {
    const roleId = Number(req.params.id);
    const { name, category, tier_level, description } = req.body;
    const badgeMap = { '最高權限': 'danger', '主管職位': 'warning', '客服職位': 'info', '一般職位': 'primary', '會員': 'secondary' };

    let roles = getRolesData();
    const idx = roles.findIndex(r => r.id === roleId);
    if (idx !== -1) {
        roles[idx] = { ...roles[idx], name, category, tier_level: Number(tier_level), color_badge: badgeMap[category] || 'primary', description };
        saveRolesData(roles);
        db.run('UPDATE roles SET name = ?, category = ?, tier_level = ?, color_badge = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [name, category, tier_level, badgeMap[category] || 'primary', description, roleId]);
    }
    res.redirect('/system/roles?saved=1');
});

router.post('/system/roles/update-perms/:id', ensureAuth, checkPerm('sys_roles'), (req, res) => {
    const roleId = Number(req.params.id);
    let permissions = req.body['perms[]'] || req.body.perms || [];
    if (!Array.isArray(permissions)) permissions = [permissions];

    let roles = getRolesData();
    const idx = roles.findIndex(r => r.id === roleId);
    if (idx !== -1) {
        roles[idx].permissions = permissions;
        saveRolesData(roles);
        db.run('UPDATE roles SET permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(permissions), roleId]);
    }
    res.redirect('/system/roles?saved=1');
});

router.post('/system/roles/add', ensureAuth, checkPerm('sys_roles'), (req, res) => {
    const { name, category, tier_level, description } = req.body;
    let permissions = req.body['perms[]'] || req.body.perms || [];
    if (!Array.isArray(permissions)) permissions = [permissions];

    const keyMap = { '售後管理': 'aftersales', '財務長': 'cfo', '客服主管': 'manager', '店長': 'admin', '總召': 'leader', '客服': 'cs', '陪陪': 'talent', '會員': 'member' };
    let role_key = keyMap[name.trim()] || ('role_' + Math.random().toString(36).substring(2, 8));
    const badgeMap = { '最高權限': 'danger', '主管職位': 'warning', '客服職位': 'info', '一般職位': 'primary', '會員': 'secondary' };

    let roles = getRolesData();
    const newId = roles.length > 0 ? Math.max(...roles.map(r => r.id || 0)) + 1 : 1;
    roles.push({ id: newId, role_key, name, category, tier_level: Number(tier_level), color_badge: badgeMap[category] || 'primary', description, permissions });
    saveRolesData(roles);

    db.run('INSERT INTO roles (role_key, name, category, tier_level, color_badge, description, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [role_key, name, category, tier_level, badgeMap[category] || 'primary', description, JSON.stringify(permissions)],
        () => res.redirect('/system/roles?saved=1'));
});

module.exports = router;