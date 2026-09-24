require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const db = require('./database');
const { client } = require('./bot');
// 🚀 引入獨立權限控管中間件與檔案套件
const { requireAuth, requirePerm } = require('./middleware/auth');
const fs = require('fs');
const path = require('path');

// 🚀 引入獨立的管理路由 (包含斜線指令熱重載與訂單更新)
const managementRouter = require('./routes/management');

const app = express();
const PORT = process.env.PORT || 3000;

// 📂 JSON 外置檔案路徑定義
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const rolesFilePath = path.join(dataDir, 'roles.json');
const vipFilePath = path.join(dataDir, 'vip.json');
const usersFilePath = path.join(dataDir, 'users.json');
const talentsFilePath = path.join(dataDir, 'talents.json');
const commandsFilePath = path.join(dataDir, 'commands.json');
const topupsFilePath = path.join(dataDir, 'topups.json');
const commissionFilePath = path.join(dataDir, 'commission.json');


// 💾 輔助同步寫回 JSON 函式模組
function syncUsersJsonFromDb() {
    db.all('SELECT * FROM users ORDER BY created_at DESC', (err, rows) => {
        if (!err && rows) {
            try {
                fs.writeFileSync(usersFilePath, JSON.stringify(rows, null, 2), 'utf8');
                console.log('💾 已即時同步最新會員資料至 data/users.json');
            } catch (e) {
                console.error('❌ 寫入 data/users.json 失敗:', e);
            }
        }
    });
}

function syncTalentsJsonFromDb() {
    db.all('SELECT * FROM talents', (err, rows) => {
        if (!err && rows) {
            try {
                fs.writeFileSync(talentsFilePath, JSON.stringify(rows, null, 2), 'utf8');
                console.log('💾 已即時同步最新員工陪陪細節至 data/talents.json');
            } catch (e) {
                console.error('❌ 寫入 data/talents.json 失敗:', e);
            }
        }
    });
}

function saveVipJsonFromDb() {
    db.all('SELECT * FROM vip_tiers ORDER BY level ASC', (err, rows) => {
        if (!err && rows) {
            try {
                const formatted = rows.map(r => ({
                    level: Number(r.level),
                    name: r.name,
                    spent_threshold: Number(r.spent_threshold),
                    deposit_threshold: Number(r.deposit_threshold),
                    rewards: typeof r.rewards === 'string' ? JSON.parse(r.rewards) : (r.rewards || [])
                }));
                fs.writeFileSync(vipFilePath, JSON.stringify(formatted, null, 2), 'utf8');
                console.log('💾 已即時同步最新 VIP 設定至 data/vip.json');
            } catch (e) {
                console.error('❌ 寫入 data/vip.json 失敗:', e);
            }
        }
    });
}

function getRolesData() {
    try {
        if (!fs.existsSync(rolesFilePath)) return [];
        const raw = fs.readFileSync(rolesFilePath, 'utf8');
        return JSON.parse(raw || '[]');
    } catch (e) {
        console.error('❌ 讀取 roles.json 失敗:', e);
        return [];
    }
}

function saveRolesData(data) {
    try {
        fs.writeFileSync(rolesFilePath, JSON.stringify(data, null, 2), 'utf8');
        console.log('💾 已即時同步最新身分設定至 data/roles.json');
        return true;
    } catch (e) {
        console.error('❌ 寫入 roles.json 失敗:', e);
        return false;
    }
}

// 🚀 全域抽佣設定讀寫工具
function getCommissionData() {
    try {
        if (!fs.existsSync(commissionFilePath)) {
            const defaultRates = { "陪玩單": 0.7, "禮物單": 0.8, "有獎": 0.85, "冠名": 0.9, "獎金": 1.0 };
            fs.writeFileSync(commissionFilePath, JSON.stringify(defaultRates, null, 2), 'utf8');
            return defaultRates;
        }
        const raw = fs.readFileSync(commissionFilePath, 'utf8');
        return JSON.parse(raw || '{}');
    } catch (e) {
        console.error('❌ 讀取 commission.json 失敗:', e);
        return { "陪玩單": 0.7, "禮物單": 0.8, "有獎": 0.85, "冠名": 0.9, "獎金": 1.0 };
    }
}

function saveCommissionData(data) {
    try {
        fs.writeFileSync(commissionFilePath, JSON.stringify(data, null, 2), 'utf8');
        console.log('💾 已即時同步最新全域抽佣設定至 data/commission.json');
        return true;
    } catch (e) {
        console.error('❌ 寫入 commission.json 失敗:', e);
        return false;
    }
}

function syncCommandsJsonFromDb() {
    db.all('SELECT * FROM bot_commands ORDER BY id ASC', (err, rows) => {
        if (!err && rows) {
            try {
                fs.writeFileSync(commandsFilePath, JSON.stringify(rows, null, 2), 'utf8');
                console.log('💾 已即時同步最新機器人指令至 data/commands.json');
            } catch (e) {
                console.error('❌ 寫入 data/commands.json 失敗:', e);
            }
        }
    });
}

function syncTopupsJsonFromDb() {
    db.all('SELECT * FROM topups ORDER BY created_at DESC', (err, rows) => {
        if (!err && rows) {
            try {
                fs.writeFileSync(topupsFilePath, JSON.stringify(rows, null, 2), 'utf8');
                console.log('💾 已即時同步最新錢包紀錄至 data/topups.json');
            } catch (e) {
                console.error('❌ 寫入 data/topups.json 失敗:', e);
            }
        }
    });
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'mihu_gaming_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
        done(err, row);
    });
});

const scopes = ['identify', 'guilds'];
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback',
    scope: scopes
}, (accessToken, refreshToken, profile, done) => {
    const { id, username, global_name, avatar } = profile;

    db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
        if (err) return done(err);

        if (!user) {
            const stmt = db.prepare(`
                INSERT INTO users (id, username, global_name, custom_nickname, avatar, role)
                VALUES (?, ?, ?, ?, ?, 'member')
            `);
            stmt.run([id, username, global_name || username, global_name || username, avatar], (insertErr) => {
                if (insertErr) return done(insertErr);
                syncUsersJsonFromDb();
                return done(null, { 
                    id, 
                    username, 
                    global_name, 
                    custom_nickname: global_name || username, 
                    avatar, 
                    role: 'member' 
                });
            });
            stmt.finalize();
        } else {
            db.run(
                'UPDATE users SET username = ?, global_name = ?, avatar = ? WHERE id = ?',
                [username, global_name || username, avatar, id],
                () => syncUsersJsonFromDb()
            );
            return done(null, user);
        }
    });
}));

function ensureAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/login?error=請先登入後臺');
}

// 🚀 全局動態權限中間件 (畫面顯示真實職位，但保留 Admin ID 最高特權)
app.use((req, res, next) => {
    if (req.isAuthenticated() && req.user) {
        db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (uErr, freshUser) => {
            const currentUser = freshUser || req.user;
            const rolesData = getRolesData();
            const roleObj = rolesData.find(r => r.role_key === currentUser.role);

            let perms = [];
            // 防鎖機制：特定的 Discord ID 擁有全功能解鎖特權
            const myAdminId = "604610298581876746";
            const isSuperAdmin = (currentUser.id === myAdminId || currentUser.role === 'admin');

            if (isSuperAdmin) {
                perms = [
                    'home', 'home_banner', 'home_wallet_card', 'home_info',
                    'personal', 'profile', 'profile_discord', 'profile_nickname', 'my_wallet', 'my_income', 'my_orders',
                    'manage', 'manage_members', 'member_adjust_balance', 'member_adjust_vip', 'manage_staff', 'manage_orders',
                    'system', 'sys_commission', 'sys_vip', 'sys_roles', 'sys_settings', 'sys_logs'
                ];
            } else if (roleObj && roleObj.permissions) {
                perms = Array.isArray(roleObj.permissions) ? roleObj.permissions : [];
            } else {
                perms = ['home', 'home_wallet_card', 'home_info', 'personal', 'profile', 'my_wallet', 'my_orders'];
            }

            res.locals.userPerms = perms;
            res.locals.currentUser = currentUser;
            
            res.locals.hasPerm = (node) => isSuperAdmin || perms.includes(node);
            next();
        });
    } else {
        res.locals.userPerms = [];
        res.locals.currentUser = null;
        res.locals.hasPerm = () => false;
        next();
    }
});

function checkPerm(permNode) {
    return (req, res, next) => {
        if (!req.user) return res.redirect('/login');

        if (req.user.role === 'admin') {
            return next();
        }

        const perms = res.locals.userPerms || [];
        if (perms.includes(permNode)) {
            return next();
        }

        res.redirect('/dashboard?error=' + encodeURIComponent('您的身分組無權限訪問該功能模組'));
    };
}

// 🚀 掛載獨立的管理 API 路由
app.use('/management', managementRouter);

app.get('/login', (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/dashboard');
    res.render('login', { error: req.query.error || null });
});

app.get('/', (req, res) => {
    res.redirect(req.isAuthenticated() ? '/dashboard' : '/login');
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', 
    passport.authenticate('discord', { failureRedirect: '/login?error=Discord 授權失敗' }),
    (req, res) => {
        res.redirect('/dashboard');
    }
);

app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/login');
    });
});

// 1. 首頁 (讀取最新公告)
app.get('/dashboard', ensureAuth, checkPerm('home'), (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, currentUser) => {
        db.get('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 1', (aErr, latestAnnouncement) => {
            res.render('dashboard', {
                user: currentUser || req.user,
                announcement: latestAnnouncement || null,
                error: req.query.error || null
            });
        });
    });
});

// 2. 個人檔案
app.get('/profile', ensureAuth, checkPerm('profile'), (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, currentUser) => {
        res.render('profile', {
            user: currentUser || req.user,
            success: req.query.saved === '1'
        });
    });
});

app.post('/profile', ensureAuth, checkPerm('profile'), (req, res) => {
    const { 
        custom_nickname, birthday, gender, age, mbti, 
        real_name, bank_name, bank_code, bank_branch, bank_account 
    } = req.body;

    const query = `
        UPDATE users SET 
            custom_nickname = ?, birthday = ?, gender = ?, age = ?, mbti = ?, 
            real_name = ?, bank_name = ?, bank_code = ?, bank_branch = ?, bank_account = ?
        WHERE id = ?
    `;

    db.run(query, [
        custom_nickname || null, birthday || null, gender || null, age ? parseInt(age, 10) : null, mbti || null,
        real_name || null, bank_name || null, bank_code || null, bank_branch || null, bank_account || null,
        req.user.id
    ], (err) => {
        if (err) return res.redirect('/profile?error=更新失敗');
        syncUsersJsonFromDb();
        res.redirect('/profile?saved=1');
    });
});

// 3. 我的錢包
app.get('/wallet', ensureAuth, checkPerm('my_wallet'), (req, res) => {
    const userId = req.user.id;

    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, currentUser) => {
        if (err || !currentUser) {
            return res.redirect('/dashboard?error=讀取使用者資料失敗');
        }

        const statsSql = `
            SELECT 
                COALESCE((SELECT SUM(total_amount) FROM orders WHERE boss_id = ? AND status != 'cancelled'), 0) + COALESCE(?, 0) as total_spent,
                COALESCE((SELECT SUM(amount) FROM topups WHERE user_id = ? AND amount > 0), 0) + COALESCE(?, 0) as total_deposited
        `;

        db.get(statsSql, [userId, currentUser.manual_spent || 0, userId, currentUser.manual_deposited || 0], (sErr, stats) => {
            db.all('SELECT * FROM vip_tiers ORDER BY level ASC', (vErr, vipTiers) => {
                const tiers = vipTiers || [];
                const spent = stats ? Number(stats.total_spent || 0) : 0;
                const deposited = stats ? Number(stats.total_deposited || 0) : 0;

                let calculatedVip = 0;
                for (const t of tiers) {
                    const spentPass = t.spent_threshold > 0 && spent >= t.spent_threshold;
                    const depositPass = t.deposit_threshold > 0 && deposited >= t.deposit_threshold;
                    if (spentPass || depositPass) {
                        calculatedVip = Math.max(calculatedVip, Number(t.level));
                    }
                }

                const currentVipInDb = Number(currentUser.vip_level || 0);
                const actualVip = Math.max(currentVipInDb, calculatedVip);

                if (calculatedVip > currentVipInDb) {
                    db.run('UPDATE users SET vip_level = ? WHERE id = ?', [calculatedVip, userId], () => syncUsersJsonFromDb());
                }

                const nextTier = tiers.find(t => Number(t.level) === actualVip + 1);

                let progressPercent = 0;
                let vipGapText = '尚無更高 VIP 門檻設定';

                if (nextTier) {
                    const spentPct = nextTier.spent_threshold > 0 ? (spent / nextTier.spent_threshold) * 100 : 0;
                    const depositPct = nextTier.deposit_threshold > 0 ? (deposited / nextTier.deposit_threshold) * 100 : 0;
                    progressPercent = Math.min(100, Math.max(0, Math.max(spentPct, depositPct)));

                    const gapSpent = Math.max(0, nextTier.spent_threshold - spent);
                    const gapDeposit = Math.max(0, nextTier.deposit_threshold - deposited);
                    
                    if (nextTier.spent_threshold > 0 && nextTier.deposit_threshold > 0) {
                        vipGapText = `距離 ${nextTier.name || 'VIP ' + nextTier.level} 尚需消費 $${gapSpent.toLocaleString()} 或 預存 $${gapDeposit.toLocaleString()}`;
                    } else if (nextTier.spent_threshold > 0) {
                        vipGapText = `距離 ${nextTier.name || 'VIP ' + nextTier.level} 尚需消費 $${gapSpent.toLocaleString()}`;
                    } else {
                        vipGapText = `距離 ${nextTier.name || 'VIP ' + nextTier.level} 尚需預存 $${gapDeposit.toLocaleString()}`;
                    }
                } else if (tiers.length === 0) {
                    const gapSpent = Math.max(0, 1000 - spent);
                    progressPercent = Math.min(100, (spent / 1000) * 100);
                    vipGapText = `距離 VIP 1 尚需消費 $${gapSpent.toLocaleString()}`;
                } else {
                    progressPercent = 100;
                    vipGapText = '🎉 您已達到最高尊榮 VIP 等級！';
                }

                db.all('SELECT * FROM topups WHERE user_id = ? ORDER BY created_at DESC', [userId], (tErr, topups) => {
                    res.render('wallet', {
                        user: { ...currentUser, vip_level: actualVip },
                        stats: stats || { total_spent: 0, total_deposited: 0 },
                        progressPercent: progressPercent.toFixed(1),
                        vipGapText: vipGapText,
                        topups: topups || []
                    });
                });
            });
        });
    });
});

// 3-1. 我的收入 (優先採用個人特例抽佣，次採全域類別抽佣)
app.get('/income', ensureAuth, checkPerm('my_income'), (req, res) => {
    const userId = req.user.id;

    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, currentUser) => {
        db.get('SELECT commission_rate FROM talents WHERE user_id = ?', [userId], (tErr, talentRow) => {
            const globalCommissions = getCommissionData();
            
            const personalRate = (talentRow && talentRow.commission_rate !== null && talentRow.commission_rate !== undefined && talentRow.commission_rate > 0) 
                ? Number(talentRow.commission_rate) 
                : null;

            if (!talentRow && currentUser) {
                db.run('INSERT OR IGNORE INTO talents (user_id, nickname, commission_rate, status) VALUES (?, ?, NULL, "idle")', [userId, currentUser.custom_nickname || currentUser.username], () => syncTalentsJsonFromDb());
            }

            const orderSql = `
                SELECT 
                    o.*,
                    b.username as boss_username,
                    b.global_name as boss_global_name,
                    b.custom_nickname as boss_nickname,
                    b.avatar as boss_avatar
                FROM orders o
                LEFT JOIN users b ON o.boss_id = b.id
                WHERE o.talent_id = ?
                ORDER BY o.created_at DESC
            `;

            db.all(orderSql, [userId], (oErr, orders) => {
                const orderList = orders || [];
                const completedOrders = orderList.filter(o => o.status === 'completed');

                const totalIncome = completedOrders.reduce((sum, o) => {
                    const cat = o.category || '陪玩單';
                    const rate = (personalRate !== null && personalRate > 0) ? personalRate : (globalCommissions[cat] || 0.7);
                    return sum + Math.round(Number(o.total_amount || 0) * rate);
                }, 0);

                const currentMonthPrefix = new Date().toISOString().slice(0, 7);
                const monthlyOrders = completedOrders.filter(o => {
                    const dateStr = o.end_time || o.created_at || '';
                    return dateStr.startsWith(currentMonthPrefix);
                });
                
                const monthlyIncome = monthlyOrders.reduce((sum, o) => {
                    const cat = o.category || '陪玩單';
                    const rate = (personalRate !== null && personalRate > 0) ? personalRate : (globalCommissions[cat] || 0.7);
                    return sum + Math.round(Number(o.total_amount || 0) * rate);
                }, 0);

                db.get('SELECT COALESCE(SUM(amount), 0) as total_withdrawn FROM payouts WHERE user_id = ? AND status = "completed"', [userId], (pErr, payoutStats) => {
                    const totalWithdrawn = payoutStats ? Number(payoutStats.total_withdrawn) : 0;
                    const availableToWithdraw = Math.max(0, totalIncome - totalWithdrawn);

                    res.render('income', {
                        user: currentUser || req.user,
                        commissionRate: personalRate || globalCommissions['陪玩單'] || 0.7,
                        stats: {
                            totalIncome: totalIncome,
                            monthlyIncome: monthlyIncome,
                            totalWithdrawn: totalWithdrawn,
                            availableToWithdraw: availableToWithdraw
                        },
                        orders: orderList
                    });
                });
            });
        });
    });
});

// 3-2. 我的訂單 (My Orders)
app.get('/my-orders', ensureAuth, checkPerm('my_orders'), (req, res) => {
    const userId = req.user.id;

    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, currentUser) => {
        const orderSql = `
            SELECT 
                o.*,
                b.username as boss_username,
                b.global_name as boss_global_name,
                b.custom_nickname as boss_nickname,
                b.avatar as boss_avatar,
                t.username as talent_username,
                t.global_name as talent_global_name,
                t.custom_nickname as talent_nickname,
                t.avatar as talent_avatar
            FROM orders o
            LEFT JOIN users b ON o.boss_id = b.id
            LEFT JOIN users t ON o.talent_id = t.id
            WHERE o.boss_id = ? OR o.talent_id = ?
            ORDER BY o.created_at DESC
        `;

        db.all(orderSql, [userId, userId], (oErr, orders) => {
            res.render('my_orders', {
                user: currentUser || req.user,
                orders: orders || []
            });
        });
    });
});

// 4. 機器人設定與指令管理
app.get('/system/bot-settings', ensureAuth, checkPerm('sys_settings'), (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, currentUser) => {
        db.all('SELECT * FROM bot_commands ORDER BY id ASC', (cErr, commands) => {
            res.render('system_bot_settings', {
                user: currentUser || req.user,
                commands: commands || [],
                success: req.query.saved === '1'
            });
        });
    });
});

app.post('/system/bot-settings/add', ensureAuth, checkPerm('sys_settings'), (req, res) => {
    const { name, command_key, min_role, description } = req.body;
    db.run(
        'INSERT INTO bot_commands (name, command_key, min_role, description, status) VALUES (?, ?, ?, ?, "enabled")',
        [name, command_key, min_role || 'member', description || ''],
        (err) => {
            if (!err) syncCommandsJsonFromDb();
            res.redirect('/system/bot-settings?saved=1');
        }
    );
});

// 5. VIP 設定 (同步 data/vip.json)
app.get('/system/vip', ensureAuth, checkPerm('sys_vip'), (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, currentUser) => {
        db.all('SELECT * FROM vip_tiers ORDER BY level ASC', (vErr, tiers) => {
            res.render('vip', {
                user: currentUser || req.user,
                vipTiers: tiers || [],
                success: req.query.saved === '1'
            });
        });
    });
});

app.post('/system/vip/update/:level', ensureAuth, checkPerm('sys_vip'), (req, res) => {
    const level = req.params.level;
    const { spent_threshold, deposit_threshold } = req.body;
    let rewards = req.body['rewards[]'] || req.body.rewards || [];

    if (!Array.isArray(rewards)) rewards = [rewards];
    rewards = rewards.map(r => r.trim()).filter(Boolean);

    db.run(
        'UPDATE vip_tiers SET spent_threshold = ?, deposit_threshold = ?, rewards = ?, updated_at = CURRENT_TIMESTAMP WHERE level = ?',
        [spent_threshold, deposit_threshold, JSON.stringify(rewards), level],
        (err) => {
            if (err) return res.redirect('/system/vip?error=更新失敗');
            saveVipJsonFromDb();
            res.redirect('/system/vip?saved=1');
        }
    );
});

app.post('/system/vip/add', ensureAuth, checkPerm('sys_vip'), (req, res) => {
    const { level, name, spent_threshold, deposit_threshold, initial_reward } = req.body;
    const rewards = initial_reward ? [initial_reward.trim()] : [];

    db.run(
        'INSERT INTO vip_tiers (level, name, spent_threshold, deposit_threshold, rewards) VALUES (?, ?, ?, ?, ?)',
        [level, name, spent_threshold, deposit_threshold, JSON.stringify(rewards)],
        (err) => {
            if (err) return res.redirect('/system/vip?error=新增失敗');
            saveVipJsonFromDb();
            res.redirect('/system/vip?saved=1');
        }
    );
});

// =========================================================================
// 🚀 5-1. 全域抽佣設定 (同步 data/commission.json，連動訂單類別)
// =========================================================================
app.get('/system/commission', ensureAuth, checkPerm('sys_commission'), (req, res) => {
    const commissionData = getCommissionData();
    res.render('commission', {
        user: req.user,
        activePage: 'commission',
        commission: commissionData,
        success: req.query.saved === '1'
    });
});

app.post('/system/commission/update', ensureAuth, checkPerm('sys_commission'), (req, res) => {
    try {
        const { rates } = req.body;
        const currentData = getCommissionData();

        if (rates && typeof rates === 'object') {
            for (const key in rates) {
                const val = parseFloat(rates[key]);
                if (!isNaN(val)) {
                    currentData[key] = Math.min(1, Math.max(0, val));
                }
            }
            saveCommissionData(currentData);
        }
        res.redirect('/system/commission?saved=1');
    } catch (err) {
        console.error('❌ 更新全域抽佣設定失敗:', err);
        res.redirect('/system/commission?error=' + encodeURIComponent('更新失敗'));
    }
});

// =========================================================================
// 🚀 6. 身分權限管理 (純 JSON 雙向同步，絕不崩潰)
// =========================================================================

// 6-1. GET: 渲染身分權限管理頁面
app.get('/system/roles', ensureAuth, checkPerm('sys_roles'), (req, res) => {
    const rolesData = getRolesData();
    res.render('roles', {
        user: req.user,
        activePage: 'roles',
        roles: rolesData,
        rolesData: rolesData,
        saved: req.query.saved === '1'
    });
});

// 6-2. POST: 變更身分組存取權限矩陣 (防崩潰修復版：純寫入 data/roles.json)
app.post('/system/roles/update-permissions', ensureAuth, checkPerm('sys_roles'), (req, res) => {
    try {
        const { role, permissions } = req.body;
        if (!role) {
            return res.status(400).send('<script>alert("目標身分組不可為空！"); history.back();</script>');
        }

        const permsArray = Array.isArray(permissions) ? permissions : (permissions ? [permissions] : []);
        let rolesArray = getRolesData();
        if (!Array.isArray(rolesArray)) rolesArray = [];

        const roleIndex = rolesArray.findIndex(r => r.role_key === role);
        if (roleIndex !== -1) {
            rolesArray[roleIndex].permissions = permsArray;
            saveRolesData(rolesArray);
            console.log(`✅ [Roles JSON Saved] 身分組 [${role}] 權限更新成功！現有權限數量: ${permsArray.length}`);
        } else {
            console.warn(`⚠️ [Roles Update Warning] 找不到身分組: ${role}`);
        }

        return res.redirect('/system/roles?saved=1');
    } catch (err) {
        console.error('❌ [Roles Update Critical Error] 寫入 roles.json 失敗:', err);
        return res.redirect('/system/roles?error=' + encodeURIComponent('權限更新失敗'));
    }
});

// 6-3. POST: 編輯身分基本資訊
app.post('/system/roles/update-info/:id', ensureAuth, checkPerm('sys_roles'), (req, res) => {
    const roleId = Number(req.params.id);
    const { name, category, tier_level, description } = req.body;

    const badgeMap = {
        '最高權限': 'danger',
        '主管職位': 'warning',
        '客服職位': 'info',
        '一般職位': 'primary',
        '會員': 'secondary'
    };

    let roles = getRolesData();
    const idx = roles.findIndex(r => r.id === roleId);
    if (idx !== -1) {
        roles[idx].name = name;
        roles[idx].category = category;
        roles[idx].tier_level = Number(tier_level);
        roles[idx].color_badge = badgeMap[category] || 'primary';
        roles[idx].description = description;
        saveRolesData(roles);

        db.run(
            'UPDATE roles SET name = ?, category = ?, tier_level = ?, color_badge = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [name, category, tier_level, badgeMap[category] || 'primary', description, roleId]
        );
    }
    res.redirect('/system/roles?saved=1');
});

// 6-4. POST: 直接更新身分權限 (帶 ID 陣列)
app.post('/system/roles/update-perms/:id', ensureAuth, checkPerm('sys_roles'), (req, res) => {
    const roleId = Number(req.params.id);
    let permissions = req.body['perms[]'] || req.body.perms || [];
    if (!Array.isArray(permissions)) permissions = [permissions];

    let roles = getRolesData();
    const idx = roles.findIndex(r => r.id === roleId);
    if (idx !== -1) {
        roles[idx].permissions = permissions;
        saveRolesData(roles);

        db.run(
            'UPDATE roles SET permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [JSON.stringify(permissions), roleId]
        );
    }
    res.redirect('/system/roles?saved=1');
});

// 6-5. POST: 新增全新身分組
app.post('/system/roles/add', ensureAuth, checkPerm('sys_roles'), (req, res) => {
    const { name, category, tier_level, description } = req.body;
    let permissions = req.body['perms[]'] || req.body.perms || [];
    if (!Array.isArray(permissions)) permissions = [permissions];

    const keyMap = {
        '售後管理': 'aftersales',
        '財務長': 'cfo',
        '客服主管': 'manager',
        '店長': 'admin',
        '總召': 'leader',
        '客服': 'cs',
        '陪陪': 'talent',
        '會員': 'member'
    };

    let role_key = keyMap[name.trim()];
    if (!role_key) {
        role_key = 'role_' + Math.random().toString(36).substring(2, 8);
    }

    const badgeMap = {
        '最高權限': 'danger',
        '主管職位': 'warning',
        '客服職位': 'info',
        '一般職位': 'primary',
        '會員': 'secondary'
    };

    let roles = getRolesData();
    const newId = roles.length > 0 ? Math.max(...roles.map(r => r.id || 0)) + 1 : 1;

    const newRole = {
        id: newId,
        role_key,
        name,
        category,
        tier_level: Number(tier_level),
        color_badge: badgeMap[category] || 'primary',
        description,
        permissions
    };

    roles.push(newRole);
    saveRolesData(roles);

    db.run(
        'INSERT INTO roles (role_key, name, category, tier_level, color_badge, description, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [role_key, name, category, tier_level, badgeMap[category] || 'primary', description, JSON.stringify(permissions)],
        () => res.redirect('/system/roles?saved=1')
    );
});

// 7. 會員管理
app.get('/management/members', ensureAuth, checkPerm('manage_members'), (req, res) => {
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

app.get('/management/members/sync/:id', ensureAuth, checkPerm('manage_members'), async (req, res) => {
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

app.get('/management/members/sync-all', ensureAuth, checkPerm('manage_members'), (req, res) => {
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

// 💡 零負數 Guardrail 解析函式：保證計算後不小於 0
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

// 7-1. 獨立【帳務調整】 (支援本次充值金額、調整累積消費與實充)
app.post('/management/members/update-balance/:id', ensureAuth, checkPerm('member_adjust_balance'), (req, res) => {
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
                            [targetId, diffAmount, diffBonus, note || '後台帳務校正', req.user.id],
                            () => syncTopupsJsonFromDb()
                        );
                    }
                    syncUsersJsonFromDb();
                    res.redirect('/management/members?saved=1');
                });
            });
        });
    });
});

// 7-2. 獨立【VIP調整】
app.post('/management/members/update-vip/:id', ensureAuth, checkPerm('member_adjust_vip'), (req, res) => {
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
                [targetId, note || `手動調整VIP等級為 VIP ${newVip}`, req.user.id],
                () => syncTopupsJsonFromDb()
            );

            syncUsersJsonFromDb();
            res.redirect('/management/members?saved=1');
        });
    });
});

// 8. 員工管理
app.get('/management/staff', ensureAuth, checkPerm('manage_staff'), (req, res) => {
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

app.get('/management/staff/sync/:id', ensureAuth, checkPerm('manage_staff'), async (req, res) => {
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

app.get('/management/staff/sync-all', ensureAuth, checkPerm('manage_staff'), (req, res) => {
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

// 🚀 員工更新：若 commission_rate 為空白，正確存入 null 代表採用工作室全域預設
app.post('/management/staff/update/:id', ensureAuth, checkPerm('manage_staff'), (req, res) => {
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

// 9. 訂單管理
app.get('/management/orders', ensureAuth, checkPerm('manage_orders'), (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, currentUser) => {
        const orderSql = `
            SELECT 
                o.*,
                b.username as boss_username,
                b.global_name as boss_global_name,
                b.custom_nickname as boss_nickname,
                b.avatar as boss_avatar,
                t.username as talent_username,
                t.global_name as talent_global_name,
                t.custom_nickname as talent_nickname,
                t.avatar as talent_avatar
            FROM orders o
            LEFT JOIN users b ON o.boss_id = b.id
            LEFT JOIN users t ON o.talent_id = t.id
            ORDER BY o.created_at DESC
        `;

        db.all(orderSql, (oErr, orders) => {
            db.all("SELECT id, username, global_name, custom_nickname FROM users WHERE role IN ('staff', 'manager', 'admin', 'cs', 'cfo', 'aftersales', 'talent')", (tErr, talents) => {
                res.render('orders', {
                    user: currentUser || req.user,
                    orders: orders || [],
                    talents: talents || [],
                    success: req.query.saved === '1'
                });
            });
        });
    });
});

app.listen(PORT, () => {
    console.log(`✨ 米胡電競管理系統全新啟動：http://localhost:${PORT}`);
});