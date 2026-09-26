const db = require('../database');

/**
 * 💡 預設 5 大類別抽傭比例 (工作室留存/抽成比率)
 * 例如 0.20 代表工作室抽 20% (陪陪實得 80%)
 */
const DEFAULT_COMMISSION_RATES = {
    '陪玩單': 0.20, // 工作室抽 20% -> 陪陪得 80%
    '禮物單': 0.15, // 工作室抽 15% -> 陪陪得 85%
    '有獎':   0.10, // 工作室抽 10% -> 陪陪得 90%
    '冠名':   0.15, // 工作室抽 15% -> 陪陪得 85%
    '獎金':   0.00  // 工作室抽 0%  -> 陪陪得 100%
};

/**
 * 🚀 核心模組化連動函式 (支援「以原價計算陪陪分潤，不承擔折扣」)
 * @param {string} category 訂單類別 (例: '陪玩單', '禮物單', '有獎', '冠名', '獎金')
 * @param {number} finalPrice 訂單折後實收總價
 * @param {number} originalPrice 訂單原總價 (未折前原價，若無傳入則預設等於 finalPrice)
 * @param {number|null} personalOverrideRate 個人專屬特例分潤率 (例如 0.8 代表陪陪拿 80%)
 */
async function calculateCommissionByCategory(category, finalPrice, originalPrice = null, personalOverrideRate = null) {
    return new Promise((resolve) => {
        const actualFinalPrice = Math.max(0, Number(finalPrice || 0));
        // 若未傳入原價，則預設以折後實收價格為原價
        const baseOriginalPrice = (originalPrice !== null && originalPrice !== undefined && Number(originalPrice) > 0) 
            ? Number(originalPrice) 
            : actualFinalPrice;

        db.get('SELECT rate FROM commission_settings WHERE category = ?', [category], (err, row) => {
            // 工作室抽成比率 (Studio Cut)
            let studioCutRate = DEFAULT_COMMISSION_RATES[category] !== undefined ? DEFAULT_COMMISSION_RATES[category] : 0.20;

            if (!err && row && row.rate !== undefined && row.rate !== null) {
                studioCutRate = Number(row.rate);
            }

            // 陪陪分潤成數 (Talent Share Rate)
            let talentShareRate = (1 - studioCutRate);

            // 若該陪陪有個人專屬特例抽傭 (例如 0.85)，優先採用個人特例
            if (personalOverrideRate !== null && personalOverrideRate !== undefined && Number(personalOverrideRate) > 0) {
                talentShareRate = Number(personalOverrideRate);
                studioCutRate = 1 - talentShareRate;
            }

            // 🚀 關鍵核心算式：陪陪分潤以「原價 (baseOriginalPrice)」計算，完全不吃折扣損耗！
            const talentNetEarning = Math.round(baseOriginalPrice * talentShareRate);
            
            // 平台實際留存金額 = 折後實收金額 - 陪陪實得 (所有折扣由工作室折抵)
            const platformCommission = Math.max(0, actualFinalPrice - talentNetEarning);
            
            const commissionRatePercent = `${(talentShareRate * 100).toFixed(0)}%`;

            resolve({
                studioCutRate,                                   // 工作室抽成率 (例如 0.20)
                talentShareRate,                                 // 陪陪分潤率 (例如 0.80)
                commissionRatePercent,                           // 陪陪分潤%顯示 (例如 '80%')
                platformCommission,                               // 平台最終淨抽成
                talentNetEarning                                  // 陪陪原價實得分潤
            });
        });
    });
}

module.exports = {
    calculateCommissionByCategory,
    DEFAULT_COMMISSION_RATES
};