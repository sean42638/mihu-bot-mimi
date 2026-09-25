const db = require('../database');
const { checkAndUpdateVipLevel } = require('./vipHelper');

/**
 * 💳 全後台統一帳務調整與資金處理核心 (獨立資金表 user_wallets 100% 整合)
 */
async function adjustUserWallet({
    userId,
    addAmount = null,
    bonusChange = null,
    overrideBalance = null,
    overrideSpent = null,
    overrideDeposited = null,
    reason = '後台手動調帳',
    operatorId = null
}) {
    return new Promise((resolve, reject) => {
        if (!userId) return reject(new Error('缺少目標會員 ID'));

        // 1. 從獨立資金表 user_wallets 讀取最新帳務
        const getWalletSql = `
            SELECT 
                COALESCE(w.balance, u.balance, 0) as balance,
                COALESCE(w.bonus_balance, u.bonus_balance, 0) as bonus_balance,
                COALESCE(w.manual_spent, u.manual_spent, 0) as manual_spent,
                COALESCE(w.manual_deposited, u.manual_deposited, 0) as manual_deposited
            FROM users u
            LEFT JOIN user_wallets w ON u.id = w.user_id
            WHERE u.id = ?
        `;

        db.get(getWalletSql, [userId], async (err, currentWallet) => {
            if (err || !currentWallet) {
                return reject(new Error('找不到目標會員帳務資料'));
            }

            const currBalance = Number(currentWallet.balance || 0);
            const currBonus = Number(currentWallet.bonus_balance || 0);
            const currSpent = Number(currentWallet.manual_spent || 0);
            const currDeposited = Number(currentWallet.manual_deposited || 0);

            let newBalance = currBalance;
            let newBonus = currBonus;
            let newSpent = currSpent;
            let newDeposited = currDeposited;

            let singleTopupAmount = 0; // 本次正數充值金額

            // 解析手動輸入 (非 null、非 undefined、非空字串才視為手動覆蓋)
            const hasManualDeposited = overrideDeposited !== null && overrideDeposited !== undefined && String(overrideDeposited).trim() !== '';
            const hasManualSpent = overrideSpent !== null && overrideSpent !== undefined && String(overrideSpent).trim() !== '';
            const hasManualBalance = overrideBalance !== null && overrideBalance !== undefined && String(overrideBalance).trim() !== '';

            // 🚀 A. 處理「累積消費」覆蓋
            if (hasManualSpent) {
                newSpent = Number(overrideSpent);
            }

            // 🚀 B. 處理「本次充值 / 扣款 (addAmount)」與「目前餘額 / 累積實充」
            if (hasManualBalance) {
                newBalance = Number(overrideBalance);
            } else if (addAmount !== null && addAmount !== undefined && String(addAmount).trim() !== '' && !isNaN(Number(addAmount))) {
                const parsedAdd = Number(addAmount);
                newBalance = currBalance + parsedAdd; // 正數加餘額，負數扣款

                // 🌟 本次充值 > 0 時，100% 自動加進「累積實充」 (除非管理員有單獨輸入「調整累積實充」)
                if (parsedAdd > 0) {
                    singleTopupAmount = parsedAdd;
                    if (!hasManualDeposited) {
                        newDeposited = currDeposited + parsedAdd;
                    }
                }
            }

            // 🚀 C. 若管理員有手動在「調整累積實充」框框填寫數字 (包含填 0)，手動覆蓋值優先！
            if (hasManualDeposited) {
                newDeposited = Number(overrideDeposited);
            }

            // 🚀 D. 處理「贈送金」(計算至目前餘額)
            if (bonusChange !== null && bonusChange !== undefined && String(bonusChange).trim() !== '' && !isNaN(Number(bonusChange))) {
                const parsedBonus = Number(bonusChange);
                newBonus = currBonus + parsedBonus;
                newBalance = newBalance + parsedBonus;
            }

            // 5. 零負數防護驗證
            if (newBalance < 0) return reject(new Error(`計算後實充餘額小於 0 (最終為 $${newBalance})，數目不得為負數！`));
            if (newBonus < 0) return reject(new Error(`計算後贈送金小於 0 (最終為 $${newBonus})，數目不得為負數！`));
            if (newSpent < 0) return reject(new Error('累積消費不得設定為負數！'));
            if (newDeposited < 0) return reject(new Error('累積實充不得設定為負數！'));

            // 6. UPSERT 寫入獨立資金表 user_wallets，並同步備份至 users 表
            const upsertWalletSql = `
                INSERT INTO user_wallets (user_id, balance, bonus_balance, manual_spent, manual_deposited, updated_at)
                VALUES (?, ?, ?, ?, ?, DATETIME('now', 'localtime'))
                ON CONFLICT(user_id) DO UPDATE SET
                    balance = excluded.balance,
                    bonus_balance = excluded.bonus_balance,
                    manual_spent = excluded.manual_spent,
                    manual_deposited = excluded.manual_deposited,
                    updated_at = DATETIME('now', 'localtime')
            `;

            db.run(upsertWalletSql, [userId, newBalance, newBonus, newSpent, newDeposited], async function (uErr) {
                if (uErr) return reject(uErr);

                // 同步寫回 users 主表，確保資料庫一致
                db.run(`UPDATE users SET balance = ?, bonus_balance = ?, manual_spent = ?, manual_deposited = ? WHERE id = ?`,
                    [newBalance, newBonus, newSpent, newDeposited, userId], () => {

                    // 7. 寫入 topups 流水紀錄並即刻重算 VIP
                    if (singleTopupAmount > 0) {
                        db.run(`
                            INSERT INTO topups (user_id, amount, bonus, channel_type, note, operator_id, created_at)
                            VALUES (?, ?, ?, '後台手動充值', ?, ?, DATETIME('now', 'localtime'))
                        `, [userId, singleTopupAmount, bonusChange || 0, reason, operatorId], () => {});
                    }

                    try {
                        checkAndUpdateVipLevel(userId, singleTopupAmount);
                    } catch (vErr) {
                        console.error('❌ VIP 重算失敗:', vErr);
                    }

                    resolve({
                        success: true,
                        newBalance,
                        newBonus,
                        newSpent,
                        newDeposited
                    });
                });
            });
        });
    });
}

module.exports = {
    adjustUserWallet
};