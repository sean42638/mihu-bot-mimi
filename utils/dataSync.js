const fs = require('fs');
const path = require('path');
const db = require('../database');

const dataDir = path.join(__dirname, '..', 'data');
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
const payoutsFilePath = path.join(dataDir, 'payouts.json');
const ordersFilePath = path.join(dataDir, 'orders.json'); // 🚀 獨立訂單數據 JSON 檔

function syncUsersJsonFromDb() {
    db.all('SELECT * FROM users ORDER BY created_at DESC', (err, rows) => {
        if (!err && rows) {
            try { fs.writeFileSync(usersFilePath, JSON.stringify(rows, null, 2), 'utf8'); } catch (e) {}
        }
    });
}

function syncTalentsJsonFromDb() {
    db.all('SELECT * FROM talents', (err, rows) => {
        if (!err && rows) {
            try { fs.writeFileSync(talentsFilePath, JSON.stringify(rows, null, 2), 'utf8'); } catch (e) {}
        }
    });
}

// 🚀 獨立訂單數據（orders.json）同步函式
function syncOrdersJsonFromDb() {
    db.all('SELECT * FROM orders ORDER BY created_at DESC', (err, rows) => {
        if (!err && rows) {
            try {
                fs.writeFileSync(ordersFilePath, JSON.stringify(rows, null, 2), 'utf8');
                console.log('💾 [DataSync] 已即時同步最新全量訂單數據至 data/orders.json');
            } catch (e) {
                console.error('❌ 寫入 data/orders.json 失敗:', e);
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
            } catch (e) {}
        }
    });
}

function getRolesData() {
    try {
        if (!fs.existsSync(rolesFilePath)) return [];
        return JSON.parse(fs.readFileSync(rolesFilePath, 'utf8') || '[]');
    } catch (e) { return []; }
}

function saveRolesData(data) {
    try {
        fs.writeFileSync(rolesFilePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) { return false; }
}

function getCommissionData() {
    try {
        if (!fs.existsSync(commissionFilePath)) {
            const defaultRates = { "陪玩單": 0.7, "禮物單": 0.8, "有獎": 0.85, "冠名": 0.9, "獎金": 1.0 };
            fs.writeFileSync(commissionFilePath, JSON.stringify(defaultRates, null, 2), 'utf8');
            return defaultRates;
        }
        return JSON.parse(fs.readFileSync(commissionFilePath, 'utf8') || '{}');
    } catch (e) {
        return { "陪玩單": 0.7, "禮物單": 0.8, "有獎": 0.85, "冠名": 0.9, "獎金": 1.0 };
    }
}

function saveCommissionData(data) {
    try {
        fs.writeFileSync(commissionFilePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) { return false; }
}

// 🚀 從 SQLite 資料庫寫回 data/commands.json 檔
function syncCommandsJsonFromDb() {
    db.all('SELECT * FROM bot_commands ORDER BY id ASC', (err, rows) => {
        if (!err && rows) {
            try {
                fs.writeFileSync(commandsFilePath, JSON.stringify(rows, null, 2), 'utf8');
                console.log('💾 [DataSync] 已即時同步最新機器人指令至 data/commands.json');
            } catch (e) {
                console.error('❌ 寫入 data/commands.json 失敗:', e);
            }
        }
    });
}
// 🚀 從 JSON 同步至資料庫時使用 INSERT OR IGNORE 防範 ID 衝突
function syncCommandsToDb(commandsData) {
    if (!Array.isArray(commandsData)) return;

    db.serialize(() => {
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO bot_commands (id, name, command_key, min_role, description, status)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        commandsData.forEach(cmd => {
            stmt.run([
                cmd.id,
                cmd.name,
                cmd.command_key,
                cmd.min_role || 'member',
                cmd.description || '',
                cmd.status || 'enabled'
            ]);
        });

        stmt.finalize((err) => {
            if (err) {
                console.error('❌ 同步指令至資料庫失敗:', err.message);
            } else {
                console.log('✅ 已成功安全同步 9 大指令至 SQLite bot_commands 資料表！');
            }
        });
    });
}

function syncTopupsJsonFromDb() {
    db.all('SELECT * FROM topups ORDER BY created_at DESC', (err, rows) => {
        if (!err && rows) {
            try { fs.writeFileSync(topupsFilePath, JSON.stringify(rows, null, 2), 'utf8'); } catch (e) {}
        }
    });
}

function syncPayoutsJsonFromDb() {
    db.all('SELECT * FROM payouts ORDER BY created_at DESC', (err, rows) => {
        if (!err && rows) {
            try { fs.writeFileSync(payoutsFilePath, JSON.stringify(rows, null, 2), 'utf8'); } catch (e) {}
        }
    });
}

module.exports = {
    syncUsersJsonFromDb,
    syncTalentsJsonFromDb,
    syncOrdersJsonFromDb,
    saveVipJsonFromDb,
    getRolesData,
    saveRolesData,
    getCommissionData,
    saveCommissionData,
    syncCommandsJsonFromDb,
    syncCommandsToDb,
    syncTopupsJsonFromDb,
    syncPayoutsJsonFromDb
};