const express = require('express');
const router = express.Router();
const db = require('../database');
const { client, registerSlashCommands } = require('../bot');
const { 
    saveVipJsonFromDb, getRolesData, saveRolesData, 
    syncCommandsJsonFromDb
} = require('../utils/dataSync');
const { requireAuth: ensureAuth, requirePerm: checkPerm } = require('../middleware/auth');
const { normalizeTalentShareRate } = require('../utils/commissionHelper');
const { GUILD_LABELS, getCommandGuildKeys, getCommandGuildLabels, getMinimumExecutionRole } = require('../config/discordCommandPolicy');

const commissionCategories = ['陪玩單', '禮物單', '有獎單', '冠名單', '獎金'];
const legacyCategoryAliases = { '有獎單': '有獎', '冠名單': '冠名' };
const canonicalCategoryAliases = { '有獎': '有獎單', '冠名': '冠名單' };

function isCommissionAdministrator(req, res) {
    const userPerms = Array.isArray(res.locals.userPerms) ? res.locals.userPerms : [];
    return req.user && (req.user.id === '604610298581876746' || req.user.role === 'admin' || userPerms.includes('sys_commission'));
}

function requireStudioCommissionAccess(req, res, next) {
    if (!req.user) return res.redirect('/login');

    const requestedId = Number((req.body && req.body.studio_id) || req.query.studio_id || 1);
    if (requestedId !== 1) return res.status(400).send('米胡電競是系統唯一工作室');

    db.get('SELECT id, name, owner_user_id FROM studios WHERE id = ?', [requestedId], (err, studio) => {
        if (err || !studio) return res.status(404).send('找不到工作室');

        const canManage = isCommissionAdministrator(req, res) || studio.owner_user_id === req.user.id;
        if (!canManage) return res.status(403).send('無權管理此工作室的抽佣設定');

        req.commissionStudioId = requestedId;
        req.commissionStudio = studio;
        next();
    });
}

function queryAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

function runSql(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve({ changes: this.changes, lastID: this.lastID });
        });
    });
}

// 🤖 機器人指令設定 (載入資料庫，若無資料則自動提供 9 大核心指令預設值)
router.get('/system/bot-settings', ensureAuth, checkPerm('sys_settings'), (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, currentUser) => {
        db.all('SELECT * FROM bot_commands ORDER BY id ASC', (cErr, dbCommands) => {
            
            // 🚀 核心：若資料庫內尚未建置 bot_commands，自動帶入全系統 9 大預設指令
            const defaultCommands = [
                { id: 1, name: '會員充值調帳', command: '/topup (/充值)', command_key: '/topup', minRole: 'admin', min_role: 'admin', desc: '【管理員專用】彈窗輸入實充金額、贈送金與備註原因，自動寫入帳務與重算 VIP', description: '【管理員專用】彈窗輸入實充金額、贈送金與備註原因，自動寫入帳務與重算 VIP', status: 'enabled' },
                { id: 2, name: '發布派單卡片', command: '/dispatch (/派單)', command_key: '/dispatch', minRole: 'cs', min_role: 'cs', desc: '計算折扣金額，跳出彈窗填寫內容並自動進行闆闆錢包扣款與頻道發報', description: '計算折扣金額，跳出彈窗填寫內容並自動進行闆闆錢包扣款與頻道發報', status: 'enabled' },
                { id: 3, name: '玩家自主註冊', command: '/register', command_key: '/register', minRole: 'member', min_role: 'member', desc: '玩家於 Discord 自行綁定與註冊米胡電競會員帳號', description: '玩家於 Discord 自行綁定與註冊米胡電競會員帳號', status: 'enabled' },
                { id: 4, name: '管理員代註冊', command: '/register-for', command_key: '/register-for', minRole: 'cs', min_role: 'cs', desc: '管理員或客服協助特定 Discord 用戶強制建立帳號與資料綁定', description: '管理員或客服協助特定 Discord 用戶強制建立帳號與資料綁定', status: 'enabled' },
                { id: 5, name: '用戶帳號綁定', command: '/bind', command_key: '/bind', minRole: 'member', min_role: 'member', desc: '引導 Discord 用戶完成網站與 Discord 身分無縫對接', description: '引導 Discord 用戶完成網站與 Discord 身分無縫對接', status: 'enabled' },
                { id: 6, name: '管理員代綁定', command: '/bind-for', command_key: '/bind-for', minRole: 'cs', min_role: 'cs', desc: '管理員手動協助指定會員進行 Discord 與網站 ID 關聯', description: '管理員手動協助指定會員進行 Discord 與網站 ID 關聯', status: 'enabled' },
                { id: 7, name: '發布系統公告', command: '/announcement', command_key: '/announcement', minRole: 'admin', min_role: 'admin', desc: '發布工作室最新活動與頻道公告，同步於後台 Dashboard 顯示', description: '發布工作室最新活動與頻道公告，同步於後台 Dashboard 顯示', status: 'enabled' },
                { id: 8, name: '互動陪陪挑選', command: '/select', command_key: '/select', minRole: 'member', min_role: 'member', desc: '彈出互動式下拉選單，供闆闆進行特定項目陪陪篩選與點單', description: '彈出互動式下拉選單，供闆闆進行特定項目陪陪篩選與點單', status: 'enabled' },
                { id: 9, name: '熱重載指令模組', command: '/reload', command_key: '/reload', minRole: 'manager', min_role: 'manager', desc: '即時重新載入機器人斜線指令與內部參數設定，無需重啟伺服器', description: '即時重新載入機器人斜線指令與內部參數設定，無需重啟伺服器', status: 'enabled' }
            ];

            // 優先使用 DB 資料，若 DB 查無內容或為空陣列則使用 defaultCommands
            const savedCommands = new Map((dbCommands || []).map(command => [
                String(command.command_key || '').replace(/^\/+/, ''),
                command
            ]));
            const liveCommands = client.commands ? Array.from(client.commands.values()) : [];
            const commands = liveCommands.map(command => {
                const definition = command.data.toJSON();
                const commandKey = definition.name;
                const saved = savedCommands.get(commandKey) || {};
                const localizedName = definition.name_localizations && definition.name_localizations['zh-TW'];
                const registration = client.commandRegistration;
                const targetGuildKeys = getCommandGuildKeys(commandKey);
                const failedGuildKeys = targetGuildKeys.filter(guildKey => registration?.guildResults?.[guildKey]?.status === 'failed');
                const fullyRegistered = targetGuildKeys.every(guildKey => registration?.guildResults?.[guildKey]?.status === 'registered');
                const statusLabel = fullyRegistered
                    ? '啟用中'
                    : (failedGuildKeys.length > 0
                        ? `同步失敗：${failedGuildKeys.map(guildKey => GUILD_LABELS[guildKey]).join('、')}`
                        : '程式已載入（尚未同步）');

                return {
                    name: saved.name || localizedName || commandKey,
                    command: `/${commandKey}${localizedName ? ` (${localizedName})` : ''}`,
                    command_key: commandKey,
                    min_role: getMinimumExecutionRole(commandKey),
                    guilds: getCommandGuildLabels(commandKey),
                    description: definition.description || saved.description || '此指令目前沒有說明',
                    status: fullyRegistered ? 'enabled' : 'failed',
                    statusLabel
                };
            });

            res.render('system_bot_settings', { 
                user: currentUser || req.user, 
                commands: commands, 
                activePage: 'bot-settings',
                syncResult: req.query.sync || null,
                registration: client.commandRegistration || null,
                guildLabels: GUILD_LABELS
            });
        });
    });
});

router.post('/system/bot-settings/sync', ensureAuth, checkPerm('sys_settings'), async (req, res) => {
    const synced = await registerSlashCommands();
    const syncResult = client.commandRegistration?.status === 'partial'
        ? 'partial'
        : (synced ? 'success' : 'failed');
    res.redirect(`/system/bot-settings?sync=${syncResult}`);
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

// 工作室抽佣設定與服務項目成數
router.get('/system/commission', ensureAuth, requireStudioCommissionAccess, async (req, res) => {
    try {
        const studioId = req.commissionStudioId;
        const [commissionRows, services] = await Promise.all([
            queryAll('SELECT category, talent_share_rate FROM studio_commissions WHERE studio_id = ?', [studioId]),
            queryAll('SELECT id, name, category, talent_share_rate, is_active FROM studio_services WHERE studio_id = ? ORDER BY name COLLATE NOCASE', [studioId])
        ]);
        const defaults = { '陪玩單': 0.80, '禮物單': 0.85, '有獎單': 0.90, '冠名單': 0.85, '獎金': 1.00 };
        const commission = { ...defaults };
        commissionRows.forEach(row => {
            const canonicalCategory = canonicalCategoryAliases[row.category] || row.category;
            const hasCanonicalRow = commissionRows.some(candidate => candidate.category === canonicalCategory);
            if (row.category !== canonicalCategory && hasCanonicalRow) return;
            commission[canonicalCategory] = Number(row.talent_share_rate);
        });

        res.render('commission', {
            user: req.user,
            activePage: 'commission',
            commission,
            services,
            studio: req.commissionStudio,
            selectedStudioId: studioId,
            success: req.query.saved === '1',
            error: req.query.error || null
        });
    } catch (err) {
        console.error('載入工作室抽佣設定失敗:', err);
        res.status(500).send('載入抽佣設定失敗');
    }
});

router.post('/system/commission/update', ensureAuth, requireStudioCommissionAccess, async (req, res) => {
    const studioId = req.commissionStudioId;
    let transactionStarted = false;
    try {
        const rates = req.body.rates || {};
        const categoryUpdates = [];
        for (const category of commissionCategories) {
            const submittedCategory = Object.prototype.hasOwnProperty.call(rates, category)
                ? category
                : legacyCategoryAliases[category];
            if (!submittedCategory || !Object.prototype.hasOwnProperty.call(rates, submittedCategory)) continue;
            const rate = normalizeTalentShareRate(rates[submittedCategory]);
            if (rate === null) throw new Error(`「${category}」分潤比例無效`);
            categoryUpdates.push([category, rate]);
        }

        const serviceUpdates = [];
        for (const [fieldName, rawRate] of Object.entries(req.body)) {
            const serviceMatch = /^service_rate_(\d+)$/.exec(fieldName);
            if (!serviceMatch) continue;
            const serviceId = Number(serviceMatch[1]);
            const rate = rawRate === '' ? null : normalizeTalentShareRate(rawRate);
            if (!Number.isInteger(serviceId) || serviceId < 1 || (rawRate !== '' && rate === null)) {
                throw new Error('服務項目分潤比例無效');
            }
            serviceUpdates.push([serviceId, rate]);
        }

        await runSql('BEGIN IMMEDIATE');
        transactionStarted = true;
        for (const [category, rate] of categoryUpdates) {
            await runSql(`
                INSERT INTO studio_commissions (studio_id, category, talent_share_rate)
                VALUES (?, ?, ?)
                ON CONFLICT(studio_id, category) DO UPDATE SET
                    talent_share_rate = excluded.talent_share_rate,
                    updated_at = CURRENT_TIMESTAMP
            `, [studioId, category, rate]);
        }
        for (const [serviceId, rate] of serviceUpdates) {
            const result = await runSql(
                'UPDATE studio_services SET talent_share_rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND studio_id = ?',
                [rate, serviceId, studioId]
            );
            if (result.changes !== 1) throw new Error('服務項目不存在或不屬於此工作室');
        }
        await runSql('COMMIT');
        transactionStarted = false;

        res.redirect(`/system/commission?studio_id=${studioId}&saved=1`);
    } catch (err) {
        if (transactionStarted) await runSql('ROLLBACK').catch(() => {});
        res.redirect(`/system/commission?studio_id=${studioId}&error=${encodeURIComponent(err.message || '更新失敗')}`);
    }
});

router.post('/system/commission/services', ensureAuth, requireStudioCommissionAccess, async (req, res) => {
    const studioId = req.commissionStudioId;
    const name = String(req.body.name || '').trim();
    const requestedCategory = req.body.category;
    const category = commissionCategories.includes(requestedCategory)
        ? requestedCategory
        : (canonicalCategoryAliases[requestedCategory] || '陪玩單');
    const rawRate = req.body.talent_share_rate;
    const rate = rawRate === '' || rawRate === undefined ? null : normalizeTalentShareRate(rawRate);

    if (!name || name.length > 100 || (rawRate !== '' && rawRate !== undefined && rate === null)) {
        return res.redirect(`/system/commission?studio_id=${studioId}&error=${encodeURIComponent('服務名稱或分潤比例無效')}`);
    }

    db.run(
        'INSERT INTO studio_services (studio_id, name, category, talent_share_rate) VALUES (?, ?, ?, ?)',
        [studioId, name, category, rate],
        (err) => res.redirect(`/system/commission?studio_id=${studioId}&${err ? 'error=' + encodeURIComponent('服務名稱已存在或新增失敗') : 'saved=1'}`)
    );
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