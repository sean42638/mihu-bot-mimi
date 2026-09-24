const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // 1. 使用者資料表 (自動與 data/users.json 雙向同步)
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            global_name TEXT,
            custom_nickname TEXT,
            avatar TEXT,
            role TEXT DEFAULT 'member',
            balance REAL DEFAULT 0,
            bonus_balance REAL DEFAULT 0,
            manual_spent REAL DEFAULT 0,
            manual_deposited REAL DEFAULT 0,
            vip_level INTEGER DEFAULT 0,
            birthday TEXT,
            gender TEXT,
            age INTEGER,
            mbti TEXT,
            real_name TEXT,
            bank_name TEXT,
            bank_code TEXT,
            bank_branch TEXT,
            bank_account TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, () => {
        const usersJsonPath = path.join(__dirname, 'data', 'users.json');
        if (fs.existsSync(usersJsonPath)) {
            try {
                const raw = fs.readFileSync(usersJsonPath, 'utf8');
                const jsonUsers = JSON.parse(raw || '[]');
                if (jsonUsers.length > 0) {
                    const stmt = db.prepare(`
                        INSERT INTO users (
                            id, username, global_name, custom_nickname, avatar, role,
                            balance, bonus_balance, manual_spent, manual_deposited,
                            vip_level, birthday, gender, age, mbti, real_name,
                            bank_name, bank_code, bank_branch, bank_account, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            username = excluded.username,
                            global_name = excluded.global_name,
                            custom_nickname = excluded.custom_nickname,
                            avatar = excluded.avatar,
                            role = excluded.role,
                            balance = excluded.balance,
                            bonus_balance = excluded.bonus_balance,
                            manual_spent = excluded.manual_spent,
                            manual_deposited = excluded.manual_deposited,
                            vip_level = excluded.vip_level,
                            birthday = excluded.birthday,
                            gender = excluded.gender,
                            age = excluded.age,
                            mbti = excluded.mbti,
                            real_name = excluded.real_name,
                            bank_name = excluded.bank_name,
                            bank_code = excluded.bank_code,
                            bank_branch = excluded.bank_branch,
                            bank_account = excluded.bank_account
                    `);

                    jsonUsers.forEach(u => {
                        stmt.run(
                            u.id, u.username, u.global_name || null, u.custom_nickname || null,
                            u.avatar || null, u.role || 'member', u.balance || 0, u.bonus_balance || 0,
                            u.manual_spent || 0, u.manual_deposited || 0, u.vip_level || 0,
                            u.birthday || null, u.gender || null, u.age || null, u.mbti || null,
                            u.real_name || null, u.bank_name || null, u.bank_code || null,
                            u.bank_branch || null, u.bank_account || null, u.created_at || new Date().toISOString()
                        );
                    });
                    stmt.finalize(() => {
                        console.log('✅ 成功從 data/users.json 同步會員資料至資料庫！');
                    });
                }
            } catch (e) {
                console.error('❌ 同步 users.json 至資料庫失敗:', e);
            }
        }
    });

    // 2. 陪玩師資產/細節資料表 (自動與 data/talents.json 雙向同步)
    db.run(`
        CREATE TABLE IF NOT EXISTS talents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT UNIQUE NOT NULL,
            nickname TEXT,
            staff_channel_id TEXT,
            commission_rate REAL DEFAULT 0.7,
            status TEXT DEFAULT 'idle',
            skill_permissions TEXT DEFAULT '[]',
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `, () => {
        const talentsJsonPath = path.join(__dirname, 'data', 'talents.json');
        if (fs.existsSync(talentsJsonPath)) {
            try {
                const raw = fs.readFileSync(talentsJsonPath, 'utf8');
                const jsonTalents = JSON.parse(raw || '[]');
                if (jsonTalents.length > 0) {
                    const stmt = db.prepare(`
                        INSERT INTO talents (id, user_id, nickname, staff_channel_id, commission_rate, status, skill_permissions)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(user_id) DO UPDATE SET
                            nickname = excluded.nickname,
                            staff_channel_id = excluded.staff_channel_id,
                            commission_rate = excluded.commission_rate,
                            status = excluded.status,
                            skill_permissions = excluded.skill_permissions
                    `);

                    jsonTalents.forEach(t => {
                        stmt.run(
                            t.id || null,
                            t.user_id,
                            t.nickname || '',
                            t.staff_channel_id || null,
                            t.commission_rate || 0.7,
                            t.status || 'idle',
                            typeof t.skill_permissions === 'string' ? t.skill_permissions : JSON.stringify(t.skill_permissions || [])
                        );
                    });
                    stmt.finalize(() => {
                        console.log('✅ 成功從 data/talents.json 同步員工陪陪細節資料至資料庫！');
                    });
                }
            } catch (e) {
                console.error('❌ 同步 talents.json 至資料庫失敗:', e);
            }
        }
    });

    // 3. 訂單紀錄資料表 (自動與 data/orders.json 雙向同步)
    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_no TEXT UNIQUE NOT NULL,
            boss_id TEXT NOT NULL,
            category TEXT DEFAULT '陪玩單',
            game TEXT NOT NULL,
            content_tier TEXT,
            duration REAL NOT NULL,
            unit TEXT DEFAULT '小時',
            unit_price REAL NOT NULL,
            headcount INTEGER DEFAULT 1,
            tag TEXT,
            extra TEXT,
            discount REAL DEFAULT 0,
            note TEXT,
            talent_message TEXT,
            talent_id TEXT,
            channel_id TEXT,
            message_id TEXT,
            total_amount REAL NOT NULL,
            status TEXT DEFAULT 'pending',
            start_time DATETIME,
            end_time DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (talent_id) REFERENCES users (id)
        )
    `, () => {
        const ordersJsonPath = path.join(__dirname, 'data', 'orders.json');
        if (fs.existsSync(ordersJsonPath)) {
            try {
                const raw = fs.readFileSync(ordersJsonPath, 'utf8');
                const jsonOrders = JSON.parse(raw || '[]');
                if (jsonOrders.length > 0) {
                    const stmt = db.prepare(`
                        INSERT INTO orders (
                            id, order_no, boss_id, category, game, content_tier, 
                            duration, unit, unit_price, headcount, tag, extra, 
                            discount, note, talent_message, talent_id, channel_id, 
                            message_id, total_amount, status, start_time, end_time, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(order_no) DO UPDATE SET
                            category = excluded.category,
                            game = excluded.game,
                            content_tier = excluded.content_tier,
                            duration = excluded.duration,
                            unit = excluded.unit,
                            unit_price = excluded.unit_price,
                            headcount = excluded.headcount,
                            tag = excluded.tag,
                            extra = excluded.extra,
                            discount = excluded.discount,
                            note = excluded.note,
                            talent_message = excluded.talent_message,
                            talent_id = excluded.talent_id,
                            channel_id = excluded.channel_id,
                            message_id = excluded.message_id,
                            total_amount = excluded.total_amount,
                            status = excluded.status,
                            start_time = excluded.start_time,
                            end_time = excluded.end_time
                    `);

                    jsonOrders.forEach(o => {
                        stmt.run(
                            o.id || null, o.order_no, o.boss_id, o.category || '陪玩單',
                            o.game, o.content_tier || null, o.duration || 1, o.unit || '小時',
                            o.unit_price || 0, o.headcount || 1, o.tag || null, o.extra || null,
                            o.discount || 0, o.note || null, o.talent_message || null,
                            o.talent_id || null, o.channel_id || null, o.message_id || null,
                            o.total_amount, o.status || 'pending', o.start_time || null,
                            o.end_time || null, o.created_at || new Date().toISOString()
                        );
                    });
                    stmt.finalize(() => {
                        console.log('✅ 成功從 data/orders.json 同步訂單資料至資料庫！');
                    });
                }
            } catch (e) {
                console.error('❌ 同步 orders.json 至資料庫失敗:', e);
            }
        }
    });

    // 4. 加值儲值紀錄表 (自動與 data/topups.json 雙向同步)
    db.run(`
        CREATE TABLE IF NOT EXISTS topups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            amount REAL NOT NULL,
            bonus REAL DEFAULT 0,
            channel_type TEXT DEFAULT '一般加值',
            note TEXT,
            operator_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, () => {
        const topupsJsonPath = path.join(__dirname, 'data', 'topups.json');
        if (fs.existsSync(topupsJsonPath)) {
            try {
                const raw = fs.readFileSync(topupsJsonPath, 'utf8');
                const jsonTopups = JSON.parse(raw || '[]');
                if (jsonTopups.length > 0) {
                    const stmt = db.prepare(`
                        INSERT INTO topups (id, user_id, amount, bonus, channel_type, note, operator_id, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET
                            user_id = excluded.user_id,
                            amount = excluded.amount,
                            bonus = excluded.bonus,
                            channel_type = excluded.channel_type,
                            note = excluded.note,
                            operator_id = excluded.operator_id
                    `);

                    jsonTopups.forEach(t => {
                        stmt.run(
                            t.id || null,
                            t.user_id,
                            t.amount || 0,
                            t.bonus || 0,
                            t.channel_type || '一般加值',
                            t.note || '',
                            t.operator_id || null,
                            t.created_at || new Date().toISOString()
                        );
                    });
                    stmt.finalize(() => {
                        console.log('✅ 成功從 data/topups.json 同步錢包帳務紀錄至資料庫！');
                    });
                }
            } catch (e) {
                console.error('❌ 同步 topups.json 至資料庫失敗:', e);
            }
        }
    });

    // 5. VIP 階級設定表 (自動與 data/vip.json 同步)
    db.run(`
        CREATE TABLE IF NOT EXISTS vip_tiers (
            level INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            spent_threshold REAL NOT NULL,
            deposit_threshold REAL NOT NULL,
            rewards TEXT DEFAULT '[]',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, () => {
        const vipJsonPath = path.join(__dirname, 'data', 'vip.json');
        if (fs.existsSync(vipJsonPath)) {
            try {
                const jsonVip = JSON.parse(fs.readFileSync(vipJsonPath, 'utf8'));
                const stmt = db.prepare(`
                    INSERT INTO vip_tiers (level, name, spent_threshold, deposit_threshold, rewards)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(level) DO UPDATE SET
                        name = excluded.name,
                        spent_threshold = excluded.spent_threshold,
                        deposit_threshold = excluded.deposit_threshold,
                        rewards = excluded.rewards,
                        updated_at = CURRENT_TIMESTAMP
                `);

                jsonVip.forEach(v => {
                    stmt.run(
                        v.level,
                        v.name,
                        v.spent_threshold,
                        v.deposit_threshold,
                        JSON.stringify(v.rewards)
                    );
                });
                stmt.finalize(() => {
                    console.log('✅ 成功從 data/vip.json 同步 VIP 1 ~ 7 設定至資料庫！');
                });
            } catch (e) {
                console.error('❌ 同步 vip.json 至資料庫失敗:', e);
            }
        }
    });

    // 6. 系統權限與角色表 (自動與 data/roles.json 同步)
    db.run(`
        CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role_key TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            category TEXT DEFAULT '一般職位',
            tier_level INTEGER DEFAULT 1,
            color_badge TEXT DEFAULT 'primary',
            description TEXT,
            permissions TEXT DEFAULT '[]',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, () => {
        const rolesJsonPath = path.join(__dirname, 'data', 'roles.json');
        if (fs.existsSync(rolesJsonPath)) {
            try {
                const jsonRoles = JSON.parse(fs.readFileSync(rolesJsonPath, 'utf8'));
                const stmt = db.prepare(`
                    INSERT INTO roles (role_key, name, category, tier_level, color_badge, description, permissions)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(role_key) DO UPDATE SET
                        name = excluded.name,
                        category = excluded.category,
                        tier_level = excluded.tier_level,
                        color_badge = excluded.color_badge,
                        description = excluded.description,
                        permissions = excluded.permissions,
                        updated_at = CURRENT_TIMESTAMP
                `);

                jsonRoles.forEach(r => {
                    stmt.run(
                        r.role_key,
                        r.name,
                        r.category,
                        r.tier_level,
                        r.color_badge,
                        r.description,
                        JSON.stringify(r.permissions)
                    );
                });
                stmt.finalize(() => {
                    console.log('✅ 成功從 data/roles.json 同步身分組資料至資料庫！');
                });
            } catch (e) {
                console.error('❌ 同步 roles.json 至資料庫失敗:', e);
            }
        }
    });

    // 7. 公告資料表
    db.run(`
        CREATE TABLE IF NOT EXISTS announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 8. 提領薪資紀錄表
    db.run(`
        CREATE TABLE IF NOT EXISTS payouts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            amount REAL NOT NULL,
            status TEXT DEFAULT 'completed',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 9. Discord 機器人指令設定表 (自動與 data/commands.json 同步)
    db.run(`
        CREATE TABLE IF NOT EXISTS bot_commands (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            command_key TEXT UNIQUE NOT NULL,
            min_role TEXT DEFAULT 'member',
            description TEXT,
            status TEXT DEFAULT 'enabled',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, () => {
        const commandsJsonPath = path.join(__dirname, 'data', 'commands.json');
        if (fs.existsSync(commandsJsonPath)) {
            try {
                const raw = fs.readFileSync(commandsJsonPath, 'utf8');
                const jsonCommands = JSON.parse(raw || '[]');
                if (jsonCommands.length > 0) {
                    const stmt = db.prepare(`
                        INSERT INTO bot_commands (id, name, command_key, min_role, description, status)
                        VALUES (?, ?, ?, ?, ?, ?)
                        ON CONFLICT(command_key) DO UPDATE SET
                            name = excluded.name,
                            min_role = excluded.min_role,
                            description = excluded.description,
                            status = excluded.status
                    `);

                    jsonCommands.forEach(c => {
                        stmt.run(
                            c.id || null,
                            c.name,
                            c.command_key,
                            c.min_role || 'member',
                            c.description || '',
                            c.status || 'enabled'
                        );
                    });
                    stmt.finalize(() => {
                        console.log('✅ 成功從 data/commands.json 同步機器人指令設定至資料庫！');
                    });
                }
            } catch (e) {
                console.error('❌ 同步 commands.json 至資料庫失敗:', e);
            }
        }
    });

    // 🚀 10. 角色權限關聯表 (防止未建表導致 SQL 查詢拋出 no such table 崩潰)
    db.run(`
        CREATE TABLE IF NOT EXISTS role_permissions (
            role_key TEXT PRIMARY KEY,
            permissions TEXT DEFAULT '[]',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

module.exports = db;