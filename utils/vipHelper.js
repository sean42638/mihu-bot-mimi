const db = require('../database');

/**
 * 👑 全後台 VIP 自動試算與連動核心 Helper (對接獨立 user_wallets 資金表)
 * @param {string} userId - 目標會員 ID
 * @param {number} [lastSingleTopup=0] - 本次單次正數充值金額 (供單次預存升級條件比對)
 */
async function checkAndUpdateVipLevel(userId, lastSingleTopup = 0) {
    return new Promise((resolve) => {
        if (!userId) return resolve(0);

        // 1. 讀取獨立資金表 user_wallets
        const userSql = `
            SELECT u.id, u.vip_level,
                   w.manual_spent,
                   w.manual_deposited
            FROM users u
            LEFT JOIN user_wallets w ON u.id = w.user_id
            WHERE u.id = ?
        `;

        db.get(userSql, [userId], (err, user) => {
            if (err || !user) return resolve(0);

            // 2. 獨立查詢系統完成訂單與歷史儲值
            const systemStatsSql = `
                SELECT 
                    COALESCE((SELECT SUM(total_amount) FROM orders WHERE boss_id = ? AND status = 'completed'), 0) as sys_spent,
                    COALESCE((SELECT SUM(amount) FROM topups WHERE user_id = ? AND amount > 0), 0) as sys_deposited
            `;

            db.get(systemStatsSql, [userId, userId], (sErr, stats) => {
                const sysSpent = Number(stats?.sys_spent || 0);
                const sysDeposited = Number(stats?.sys_deposited || 0);

                // 🚀 最高優先權：若手動/連動累加欄位 (manual) 有值，以該最新數值為主！
                const totalSpent = (user.manual_spent !== null && user.manual_spent !== undefined) 
                    ? Number(user.manual_spent) 
                    : sysSpent;

                const totalDeposited = (user.manual_deposited !== null && user.manual_deposited !== undefined) 
                    ? Number(user.manual_deposited) 
                    : sysDeposited;

                // 3. 撈取 VIP 門檻設定檔 (按 level 升序)
                db.all('SELECT * FROM vip_tiers ORDER BY CAST(level AS INTEGER) ASC', [], (vErr, tiers) => {
                    if (vErr || !tiers || tiers.length === 0) {
                        return resolve(Number(user.vip_level || 0));
                    }

                    let calculatedVip = 0; // 未達標預設為 VIP 0 (非 VIP)

                    // 4. 比對雙軌門檻：
                    //    計算方式 1：累積消費 (totalSpent) >= 門檻消費額
                    //    計算方式 2：預存/單次充值 (lastSingleTopup 或 totalDeposited) >= 門檻實充額
                    for (const tier of tiers) {
                        const reqSpent = Number(tier.spent_threshold ?? tier.min_spent ?? tier.spent ?? 0);
                        const reqDeposit = Number(tier.deposit_threshold ?? tier.min_deposit ?? tier.deposit ?? 0);
                        const tierLevel = Number(tier.level ?? tier.vip_level ?? 0);

                        const passSpent = reqSpent > 0 && totalSpent >= reqSpent;
                        const passDeposit = reqDeposit > 0 && (totalDeposited >= reqDeposit || Number(lastSingleTopup) >= reqDeposit);

                        if (passSpent || passDeposit) {
                            calculatedVip = Math.max(calculatedVip, tierLevel);
                        }
                    }

                    console.log(`👑 [VIP雙軌連動日誌] 會員 [${userId}] ➔ 總累積消費: $${totalSpent} | 總累積實充: $${totalDeposited} | 本次單次充值: $${lastSingleTopup} ➔ 判定 VIP: VIP ${calculatedVip}`);

                    // 5. 寫回 users 資料庫中的 vip_level
                    db.run('UPDATE users SET vip_level = ? WHERE id = ?', [calculatedVip, userId], (uErr) => {
                        if (uErr) console.error('❌ 更新 users 表 vip_level 失敗:', uErr);
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