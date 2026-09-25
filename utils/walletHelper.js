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

            // 解析數值
            const parsedAdd = (addAmount !== null && addAmount !== undefined && String(addAmount).trim() !== '') ? Number(addAmount) : null;
            const parsedBonus = (bonusChange !== null && bonusChange !== undefined && String(bonusChange).trim() !== '') ? Number(bonusChange) : null;
            const parsedBalance = (overrideBalance !== null && overrideBalance !== undefined && String(overrideBalance).trim() !== '') ? Number(overrideBalance) : null;
            const parsedSpent = (overrideSpent !== null && overrideSpent !== undefined && String(overrideSpent).trim() !== '') ? Number(overrideSpent) : null;
            const parsedDeposited = (overrideDeposited !== null && overrideDeposited !== undefined && String(overrideDeposited).trim() !== '') ? Number(overrideDeposited) : null;

            // 🚀 1. 處理累積消費 (overrideSpent)
            if (parsedSpent !== null && !isNaN(parsedSpent)) {
                newSpent = parsedSpent;
            }

            // 🚀 2. 處理「本次充值 / 扣款 (addAmount)」與「目前餘額」
            if (parsedBalance !== null && !isNaN(parsedBalance)) {
                newBalance = parsedBalance;
            } else if (parsedAdd !== null && !isNaN(parsedAdd)) {
                newBalance = currBalance + parsedAdd;
                if (parsedAdd > 0) {
                    singleTopupAmount = parsedAdd;
                }
            }

            // 🚀 3. 關鍵連動：累積實充 (newDeposited) 計算
            // 規則 A：若有輸入「本次充值」(正數)，且沒有顯式指定一個「大於 0 的手動覆蓋值」，累積實充 100% 自動累加！
            if (singleTopupAmount > 0 && (parsedDeposited === null || isNaN(parsedDeposited) || parsedDeposited === 0)) {
                newDeposited = currDeposited + singleTopupAmount;
            } 
            // 規則 B：若單獨手動指定「調整累積實充」(包含輸入指定金額或歸零 0，且本次無充值)，以手動覆蓋值為準！
            else if (parsedDeposited !== null && !isNaN(parsedDeposited)) {
                newDeposited = parsedDeposited;
            }

            // 🚀 4. 處理贈送金 (計算至目前餘額)
            if (parsedBonus !== null && !isNaN(parsedBonus)) {
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

                // 備份至 users 主表
                db.run(`UPDATE users SET balance = ?, bonus_balance = ?, manual_spent = ?, manual_deposited = ? WHERE id = ?`,
                    [newBalance, newBonus, newSpent, newDeposited, userId], () => {});

                // 寫入 topups 流水紀錄
                if (singleTopupAmount > 0) {
                    db.run(`
                        INSERT INTO topups (user_id, amount, bonus, channel_type, note, operator_id, created_at)
                        VALUES (?, ?, ?, '後台手動充值', ?, ?, DATETIME('now', 'localtime'))
                    `, [userId, singleTopupAmount, bonusChange || 0, reason, operatorId], () => {});
                }

                // 7. 🚀 核心連動：即刻調用 VIP Helper 重算 (帶入單次充值額度)
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