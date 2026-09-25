const db = require('../database');
const { checkAndUpdateVipLevel } = require('./vipHelper');

/**
 * 💳 全後台統一帳務調整與資金處理核心 (獨立資金表 user_wallets)
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

            // 🚀 1. 檢查是否有「手動輸入覆蓋累積實充」(框框有輸入字串才算)
            const isDepositedSet = overrideDeposited !== null && overrideDeposited !== undefined && String(overrideDeposited).trim() !== '';

            // 🚀 2. 檢查是否有「手動輸入覆蓋累積消費」(框框有輸入字串才算)
            const isSpentSet = overrideSpent !== null && overrideSpent !== undefined && String(overrideSpent).trim() !== '';
            if (isSpentSet) {
                newSpent = Number(overrideSpent);
            }

            // 🚀 3. 處理本次充值加減與餘額/累積實充連動
            const isBalanceSet = overrideBalance !== null && overrideBalance !== undefined && String(overrideBalance).trim() !== '';

            if (isBalanceSet) {
                // 直接覆蓋目前餘額
                newBalance = Number(overrideBalance);
            } else if (addAmount !== null && addAmount !== undefined && String(addAmount).trim() !== '' && !isNaN(Number(addAmount))) {
                const parsedAdd = Number(addAmount);
                newBalance = currBalance + parsedAdd; // 正數增加餘額，負數扣款

                // 🌟【關鍵連動】：充值正數且沒有手動輸入覆蓋累積實充時，100% 累加進累積實充！
                if (parsedAdd > 0) {
                    singleTopupAmount = parsedAdd;
                    if (!isDepositedSet) {
                        newDeposited = currDeposited + parsedAdd;
                    }
                }
            }

            // 🚀 4. 如果管理員有「主動手動輸入」累積實充（包含輸入 0），手動指定優先！
            if (isDepositedSet) {
                newDeposited = Number(overrideDeposited);
            }

            // 🚀 5. 處理贈送金 (計算至目前餘額)
            if (bonusChange !== null && bonusChange !== undefined && String(bonusChange).trim() !== '' && !isNaN(Number(bonusChange))) {
                const parsedBonus = Number(bonusChange);
                newBonus = currBonus + parsedBonus;
                newBalance = newBalance + parsedBonus;
            }

            // 6. 零負數防護驗證
            if (newBalance < 0) return reject(new Error(`計算後實充餘額小於 0 (最終為 $${newBalance})，數目不得為負數！`));
            if (newBonus < 0) return reject(new Error(`計算後贈送金小於 0 (最終為 $${newBonus})，數目不得為負數！`));
            if (newSpent < 0) return reject(new Error('累積消費不得設定為負數！'));
            if (newDeposited < 0) return reject(new Error('累積實充不得設定為負數！'));

            // 7. UPSERT 寫入獨立資金表 user_wallets，並同步備份至 users 表
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

                // 備份至 users 主表
                db.run(`UPDATE users SET balance = ?, bonus_balance = ?, manual_spent = ?, manual_deposited = ? WHERE id = ?`,
                    [newBalance, newBonus, newSpent, newDeposited, userId], () => {});

                // 寫入 topups 充值流水紀錄
                if (singleTopupAmount > 0) {
                    db.run(`
                        INSERT INTO topups (user_id, amount, bonus, channel_type, note, operator_id, created_at)
                        VALUES (?, ?, ?, '後台手動充值', ?, ?, DATETIME('now', 'localtime'))
                    `, [userId, singleTopupAmount, bonusChange || 0, reason, operatorId], () => {});
                }

                // 8. 🚀 核心連動：即刻調用 VIP Helper (帶入單次充值金額)
                try {
                    await checkAndUpdateVipLevel(userId, singleTopupAmount);
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
}

module.exports = {
    adjustUserWallet
};