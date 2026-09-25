const db = require('../database');

/**
 * 💡 預設 5 大類別抽傭比例 (若資料庫尚無設定時的防呆備用值)
 */
const DEFAULT_COMMISSION_RATES = {
    '陪玩單': 0.20, // 20%
    '禮物單': 0.10, // 10%
    '有獎單': 0.05, // 5%
    '冠名單': 0.15, // 15%
    '活動單': 0.10  // 10%
};

/**
 * 🚀 1. 根據訂單類別 (category) 自動獲取傭金%數與計算金額
 * @param {string} category - 訂單類別 ('陪玩單' | '禮物單' | '有獎單' | '冠名單' | '活動單')
 * @param {number} totalAmount - 訂單實收總價
 * @returns {Promise<{ commissionRate: number, commissionRatePercent: string, platformCommission: number, talentNetEarning: number }>}
 */
async function calculateCommissionByCategory(category, totalAmount) {
    return new Promise((resolve) => {
        const amount = Math.max(0, Number(totalAmount || 0));

        // 讀取 SQLite 資料庫中的抽傭設定 (如果表不存在或沒設定則用預設值)
        db.get('SELECT rate FROM commission_settings WHERE category = ?', [category], (err, row) => {
            let rate = DEFAULT_COMMISSION_RATES[category] !== undefined ? DEFAULT_COMMISSION_RATES[category] : 0.20;

            if (!err && row && row.rate !== undefined && row.rate !== null) {
                rate = Number(row.rate);
            }

            // 計算平台傭金與陪陪淨收入
            const platformCommission = Math.round(amount * rate);
            const talentNetEarning = Math.max(0, amount - platformCommission);
            const commissionRatePercent = `${(rate * 100).toFixed(0)}%`;

            resolve({
                commissionRate: rate,                // 抽傭比例 (例如 0.20)
                commissionRatePercent,               // 顯示文字 (例如 '20%')
                platformCommission,                   // 平台抽成金額 (例如 $200)
                talentNetEarning                      // 陪陪實得金額 (例如 $800)
            });
        });
    });
}

/**
 * 💡 2. 初始化 SQLite 抽傭設定資料表 (確保 5 大類別存在)
 */
function initCommissionTable() {
    db.run(`
        CREATE TABLE IF NOT EXISTS commission_settings (
            category TEXT PRIMARY KEY,
            rate REAL NOT NULL,
            updated_at DATETIME DEFAULT (DATETIME('now', 'localtime'))
        )
    `, () => {
        // 預設寫入 5 個選項
        for (const [cat, rate] of Object.entries(DEFAULT_COMMISSION_RATES)) {
            db.run(`INSERT OR IGNORE INTO commission_settings (category, rate) VALUES (?, ?)`, [cat, rate]);
        }
    });
}

// 自動執行資料表初始化
initCommissionTable();

module.exports = {
    calculateCommissionByCategory,
    DEFAULT_COMMISSION_RATES
};