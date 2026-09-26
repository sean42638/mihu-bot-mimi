const db = require('../database');

/**
 * 💡 預設 5 大類別工作室抽成率 (Studio Cut Rate)
 * 例如 0.20 代表工作室抽 20% (陪陪實得 80%)
 */
const DEFAULT_COMMISSION_RATES = {
    '陪玩單': 0.20, // 陪陪得 80%
    '禮物單': 0.15, // 陪陪得 85%
    '有獎單': 0.10, // 陪陪得 90%
    '冠名單': 0.15, // 陪陪得 85%
    '獎金':   0.00  // 陪陪得 100%
};

const CATEGORY_ALIASES = {
    '有獎': ['有獎單', '有獎'],
    '有獎單': ['有獎單', '有獎'],
    '冠名': ['冠名單', '冠名'],
    '冠名單': ['冠名單', '冠名']
};
const CANONICAL_CATEGORIES = { '有獎': '有獎單', '冠名': '冠名單' };

function normalizeTalentShareRate(value) {
    if (value === null || value === undefined) return null;

    let numericValue;
    if (typeof value === 'string') {
        const trimmedValue = value.trim();
        if (!trimmedValue || trimmedValue.toLowerCase() === 'null') return null;
        numericValue = trimmedValue.endsWith('%')
            ? Number(trimmedValue.slice(0, -1)) / 100
            : Number(trimmedValue);
    } else {
        numericValue = Number(value);
    }
    if (numericValue > 1 && numericValue <= 100) numericValue /= 100;

    return Number.isFinite(numericValue) && numericValue >= 0 && numericValue <= 1
        ? numericValue
        : null;
}

function getRow(sql, params = []) {
    return new Promise((resolve) => {
        db.get(sql, params, (err, row) => resolve(err ? null : row || null));
    });
}

function getCategoryAliases(category) {
    const canonicalCategory = CANONICAL_CATEGORIES[category] || category;
    return CATEGORY_ALIASES[canonicalCategory] || [canonicalCategory];
}

async function resolveServiceId(studioId, serviceName, category = '陪玩單') {
    const name = String(serviceName || '').trim();
    if (!name) return null;

    await new Promise((resolve) => {
        db.run(
            'INSERT OR IGNORE INTO studio_services (studio_id, name, category) VALUES (?, ?, ?)',
            [Number(studioId) || 1, name, category || '陪玩單'],
            () => resolve()
        );
    });

    const service = await getRow(
        'SELECT id FROM studio_services WHERE studio_id = ? AND name = ? AND is_active = 1',
        [Number(studioId) || 1, name]
    );
    return service ? Number(service.id) : null;
}

async function getStudioIdForUser(userId) {
    const user = await getRow('SELECT studio_id FROM users WHERE id = ?', [userId]);
    return Number(user && user.studio_id) || 1;
}

async function getPersonalTalentShareRate(userId) {
    const talent = await getRow('SELECT commission_rate FROM talents WHERE user_id = ?', [userId]);
    const rate = normalizeTalentShareRate(talent && talent.commission_rate);
    return rate > 0 ? rate : null;
}

/**
 * 🚀 全站統一抽傭計算函式
 * @param {string} category 訂單類別
 * @param {number} finalPrice 訂單折後實收金額
 * @param {number|null} originalPrice 訂單未折前原價 (若無傳入則預設以 finalPrice 計算)
 * @param {number|null} personalOverrideRate 陪陪個人專屬特例成數 (例如 0.85 代表陪陪拿 85%)
 */
async function calculateCommissionByCategory(category, finalPrice, originalPrice = null, personalOverrideRate = null, context = {}) {
    const actualFinalPrice = Math.max(0, Number(finalPrice || 0));
    const baseOriginalPrice = (originalPrice !== null && originalPrice !== undefined && Number(originalPrice) > 0)
        ? Number(originalPrice)
        : actualFinalPrice;
    const catKey = category || '陪玩單';
    const studioId = Number(context.studioId) || 1;
    const categoryAliases = getCategoryAliases(catKey);

    let studioShareRate = null;
    let itemShareRate = null;

    if (context.serviceId) {
        const item = await getRow(
            'SELECT talent_share_rate FROM studio_services WHERE id = ? AND studio_id = ? AND is_active = 1',
            [context.serviceId, studioId]
        );
        itemShareRate = normalizeTalentShareRate(item && item.talent_share_rate);
    } else if (context.serviceName) {
        const item = await getRow(
            'SELECT talent_share_rate FROM studio_services WHERE studio_id = ? AND name = ? AND is_active = 1',
            [studioId, String(context.serviceName).trim()]
        );
        itemShareRate = normalizeTalentShareRate(item && item.talent_share_rate);
    }

    if (itemShareRate === null) {
        const placeholders = categoryAliases.map(() => '?').join(',');
        const studioSetting = await getRow(
            `SELECT talent_share_rate FROM studio_commissions WHERE studio_id = ? AND category IN (${placeholders}) ORDER BY CASE category WHEN ? THEN 0 ELSE 1 END LIMIT 1`,
            [studioId, ...categoryAliases, catKey]
        );
        studioShareRate = normalizeTalentShareRate(studioSetting && studioSetting.talent_share_rate);
    }

    if (studioShareRate === null && itemShareRate === null) {
        const placeholders = categoryAliases.map(() => '?').join(',');
        const legacySetting = await getRow(
            `SELECT rate FROM commission_settings WHERE category IN (${placeholders}) ORDER BY CASE category WHEN ? THEN 0 ELSE 1 END LIMIT 1`,
            [...categoryAliases, catKey]
        );
        if (legacySetting && legacySetting.rate !== null && legacySetting.rate !== undefined) {
            let studioCutRate = Number(legacySetting.rate);
            if (studioCutRate > 1 && studioCutRate <= 100) studioCutRate /= 100;
            if (Number.isFinite(studioCutRate) && studioCutRate >= 0 && studioCutRate <= 1) {
                studioShareRate = 1 - studioCutRate;
            }
        }
    }

    if (studioShareRate === null && itemShareRate === null) {
        const canonicalCategory = CANONICAL_CATEGORIES[catKey] || catKey;
        const defaultCutRate = DEFAULT_COMMISSION_RATES[canonicalCategory] !== undefined
            ? DEFAULT_COMMISSION_RATES[canonicalCategory]
            : 0.20;
        studioShareRate = 1 - defaultCutRate;
    }

    const personalShareRate = normalizeTalentShareRate(personalOverrideRate);
    const talentShareRate = itemShareRate !== null
        ? itemShareRate
        : (personalShareRate > 0 ? personalShareRate : studioShareRate);
    const studioCutRate = 1 - talentShareRate;
    const talentNetEarning = Math.round(baseOriginalPrice * talentShareRate);
    const platformCommission = Math.max(0, actualFinalPrice - talentNetEarning);

    return {
        category: catKey,
        studioCutRate,
        talentShareRate,
        commissionRatePercent: `${Math.round(talentShareRate * 100)}%`,
        platformCommission,
        talentNetEarning
    };
}

module.exports = {
    calculateCommissionByCategory,
    DEFAULT_COMMISSION_RATES,
    normalizeTalentShareRate,
    resolveServiceId,
    getStudioIdForUser,
    getPersonalTalentShareRate
};