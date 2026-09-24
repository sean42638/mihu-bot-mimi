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

function syncCommandsJsonFromDb() {
    db.all('SELECT * FROM bot_commands ORDER BY id ASC', (err, rows) => {
        if (!err && rows) {
            try { fs.writeFileSync(commandsFilePath, JSON.stringify(rows, null, 2), 'utf8'); } catch (e) {}
        }
    });
}

function syncTopupsJsonFromDb() {
    db.all('SELECT * FROM topups ORDER BY created_at DESC', (err, rows) => {
        if (!err && rows) {
            try { fs.writeFileSync(topupsFilePath, JSON.stringify(rows, null, 2), 'utf8'); } catch (e) {}
        }
    });
}

module.exports = {
    syncUsersJsonFromDb,
    syncTalentsJsonFromDb,
    saveVipJsonFromDb,
    getRolesData,
    saveRolesData,
    getCommissionData,
    saveCommissionData,
    syncCommandsJsonFromDb,
    syncTopupsJsonFromDb
};