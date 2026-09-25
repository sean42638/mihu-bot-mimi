const db = require('../database');

/**
 * 👑 全後台 VIP 自動計算與連動核心 Helper (含排查與極速寫回)
 * @param {string} userId - 目標會員 ID
 * @returns {Promise<number>} 最新試算出的 VIP 等級
 */
async function checkAndUpdateVipLevel(userId) {
    return new Promise((resolve) => {
        if (!userId) return resolve(0);

        // 1. 優先從 user_wallets 或 users 讀取手動累積金額
        const userSql = `
            SELECT u.id, u.vip_level,
                   COALESCE(w.manual_spent, u.manual_spent, 0) as manual_spent,
                   COALESCE(w.manual_deposited, u.manual_deposited, 0) as manual_deposited
            FROM users u
            LEFT JOIN user_wallets w ON u.id = w.user_id
            WHERE u.id = ?
        `;

        db.get(userSql, [userId], (err, user) => {
            if (err || !user) {
                console.error('❌ [VIP Helper] 找不到會員:', err);
                return resolve(0);
            }

            const manualSpent = Number(user.manual_spent || 0);
            const manualDeposited = Number(user.manual_deposited || 0);

            // 2. 算式：總消費 = 訂單累計 + 手動累積 ; 總實充 = 儲值累計 + 手動累積
            const statsSql = `
                SELECT 
                    (COALESCE((SELECT SUM(total_amount) FROM orders WHERE boss_id = ? AND status != 'cancelled'), 0) + ?) as total_spent,
                    (COALESCE((SELECT SUM(amount) FROM topups WHERE user_id = ? AND amount > 0), 0) + ?) as total_deposited
            `;

            db.get(statsSql, [userId, manualSpent, userId, manualDeposited], (sErr, stats) => {
                if (sErr || !stats) {
                    console.error('❌ [VIP Helper] 統計金額失敗:', sErr);
                    return resolve(Number(user.vip_level || 0));
                }

                const totalSpent = Number(stats.total_spent || 0);
                const totalDeposited = Number(stats.total_deposited || 0);

                // 3. 撈取 VIP 門檻階級
                db.all('SELECT * FROM vip_tiers ORDER BY CAST(level AS INTEGER) ASC', [], (vErr, tiers) => {
                    if (vErr) {
                        console.error('❌ [VIP Helper] 撈取 vip_tiers 失敗:', vErr);
                        return resolve(Number(user.vip_level || 0));
                    }

                    // 🚨 斷點排查：如果資料庫完全沒有 VIP 門檻，印出警示！
                    if (!tiers || tiers.length === 0) {
                        console.warn('⚠️ [VIP Helper 警示] vip_tiers 資料表中完全沒有任何 VIP 階級資料！請確認資料庫是否有建立 VIP 門檻。');
                        return resolve(Number(user.vip_level || 0));
                    }

                    let calculatedVip = 0;

                    // 4. 門檻比對 (向下相容所有可能出現的門檻欄位名稱)
                    for (const tier of tiers) {
                        const reqSpent = Number(tier.spent_threshold ?? tier.min_spent ?? tier.spent ?? 0);
                        const reqDeposit = Number(tier.deposit_threshold ?? tier.min_deposit ?? tier.deposit ?? 0);
                        const tierLevel = Number(tier.level ?? tier.vip_level ?? 0);

                        const passSpent = reqSpent > 0 && totalSpent >= reqSpent;
                        const passDeposit = reqDeposit > 0 && totalDeposited >= reqDeposit;

                        if (passSpent || passDeposit) {
                            calculatedVip = Math.max(calculatedVip, tierLevel);
                        }
                    }

                    console.log(`🔍 [VIP Helper 除錯] 會員[${userId}] -> 手動消費:$${manualSpent}, 手動實充:$${manualDeposited} | 總算:消$${totalSpent}/存$${totalDeposited} | 算出的VIP: VIP ${calculatedVip}`);

                    // 5. 強制將計算結果寫回 users 與 user_wallets (避免覆蓋無效)
                    db.run('UPDATE users SET vip_level = ? WHERE id = ?', [calculatedVip, userId], (uErr) => {
                        if (uErr) console.error('❌ [VIP Helper] 更新 users 表 vip_level 失敗:', uErr);
                        
                        // 雙重保險：如果 user_wallets 表有該欄位也一併更新 (防聯表讀取蓋掉)
                        db.run('UPDATE user_wallets SET vip_level = ? WHERE user_id = ?', [calculatedVip, userId], () => {});

                        resolve(calculatedVip);
                    });
                });
            });
        });
    });
}

module.exports = {
    checkAndUpdateVipLevel
};