const db = require('../database');
const { checkAndUpdateVipLevel } = require('./vipHelper');

/**
 * 💳 全後台統一帳務調整與資金處理核心
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

        // 1. 查詢當前帳務
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

            // 🚀 2. 實充餘額計算
            if (overrideBalance !== null && overrideBalance !== '' && !isNaN(Number(overrideBalance))) {
                newBalance = Number(overrideBalance);
            } else if (addAmount !== null && addAmount !== '' && !isNaN(Number(addAmount))) {
                const parsedAdd = Number(addAmount);
                newBalance = currBalance + parsedAdd;
                // 若充值為正數且未單獨覆蓋累積實充，自動累加實充
                if (parsedAdd > 0 && (overrideDeposited === null || overrideDeposited === '')) {
                    newDeposited = currDeposited + parsedAdd;
                }
            }

            // 🚀 3. 贈送金計算
            if (bonusChange !== null && bonusChange !== '' && !isNaN(Number(bonusChange))) {
                newBonus = currBonus + Number(bonusChange);
            }

            // 🚀 4. 累積消費與累積實充計算 (強轉 Number 寫入)
            if (overrideSpent !== null && overrideSpent !== '' && !isNaN(Number(overrideSpent))) {
                newSpent = Number(overrideSpent);
            }
            if (overrideDeposited !== null && overrideDeposited !== '' && !isNaN(Number(overrideDeposited))) {
                newDeposited = Number(overrideDeposited);
            }

            // 5. 嚴格負數阻擋鎖
            if (newBalance < 0) return reject(new Error(`計算後實充餘額小於 0 (最終為 $${newBalance})，數目不得為負數！`));
            if (newBonus < 0) return reject(new Error(`計算後贈送金小於 0 (最終為 $${newBonus})，數目不得為負數！`));
            if (newSpent < 0) return reject(new Error('累積消費不得設定為負數！'));
            if (newDeposited < 0) return reject(new Error('累積實充不得設定為負數！'));

            // 🚀 6. 寫入獨立資金表 user_wallets 並備份至 users 主表
            const upsertSql = `
                INSERT INTO user_wallets (user_id, balance, bonus_balance, manual_spent, manual_deposited, updated_at)
                VALUES (?, ?, ?, ?, ?, DATETIME('now', 'localtime'))
                ON CONFLICT(user_id) DO UPDATE SET
                    balance = excluded.balance,
                    bonus_balance = excluded.bonus_balance,
                    manual_spent = excluded.manual_spent,
                    manual_deposited = excluded.manual_deposited,
                    updated_at = DATETIME('now', 'localtime')
            `;

            db.run(upsertSql, [userId, newBalance, newBonus, newSpent, newDeposited], async function (uErr) {
                if (uErr) {
                    console.error('❌ 寫入 user_wallets 出錯:', uErr);
                    return reject(uErr);
                }

                // 備份至 users 主表
                db.run(`UPDATE users SET balance = ?, bonus_balance = ?, manual_spent = ?, manual_deposited = ? WHERE id = ?`,
                    [newBalance, newBonus, newSpent, newDeposited, userId], () => {});

                // 紀錄 Wallet Transaction 流水
                const logAmount = (newBalance - currBalance) + (newBonus - currBonus);
                if (logAmount !== 0) {
                    db.run(`
                        INSERT INTO wallet_transactions (user_id, type, amount, description, created_at)
                        VALUES (?, 'admin_adjust', ?, ?, DATETIME('now', 'localtime'))
                    `, [userId, logAmount, `後台帳務調整 - ${reason}`], () => {});
                }

                // 🚀 7. 即刻連動重算 VIP 等級！
                try {
                    await checkAndUpdateVipLevel(userId);
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