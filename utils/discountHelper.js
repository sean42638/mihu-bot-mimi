const db = require('../database');
const { syncUsersJsonFromDb } = require('./dataSync');

/**
 * 💡 計算並自動更新指定使用者的 VIP 等級與點單折扣
 */
async function getUserVipInfo(userId) {
    return new Promise((resolve) => {
        // 1. 取得使用者與消費/預存統計
        const sql = `
            SELECT u.*,
                COALESCE((SELECT SUM(total_amount) FROM orders WHERE boss_id = u.id AND status != 'cancelled'), 0) + COALESCE(u.manual_spent, 0) as total_spent,
                COALESCE((SELECT SUM(amount) FROM topups WHERE user_id = u.id AND amount > 0), 0) + COALESCE(u.manual_deposited, 0) as total_deposited
            FROM users u WHERE u.id = ?
        `;

        db.get(sql, [userId], (err, user) => {
            if (err || !user) return resolve({ vip_level: 0, discountRate: 1.0, user: null });

            // 2. 撈取全部 VIP 階級門檻
            db.all('SELECT * FROM vip_tiers ORDER BY level ASC', (vErr, vipTiers) => {
                const tiers = vipTiers || [];
                const spent = Number(user.total_spent || 0);
                const deposited = Number(user.total_deposited || 0);

                let calculatedVip = 0;
                let currentDiscountRate = 1.0;

                // 取消費或預存達到最高的 VIP 等級
                for (const t of tiers) {
                    const spentPass = t.spent_threshold > 0 && spent >= t.spent_threshold;
                    const depositPass = t.deposit_threshold > 0 && deposited >= t.deposit_threshold;

                    if (spentPass || depositPass) {
                        if (Number(t.level) > calculatedVip) {
                            calculatedVip = Number(t.level);
                            if (t.discount_rate && Number(t.discount_rate) > 0) {
                                currentDiscountRate = Number(t.discount_rate);
                            }
                        }
                    }
                }

                const currentVipInDb = Number(user.vip_level || 0);
                const actualVip = Math.max(currentVipInDb, calculatedVip);

                // 自動升級寫入 DB
                if (calculatedVip > currentVipInDb) {
                    db.run('UPDATE users SET vip_level = ? WHERE id = ?', [calculatedVip, userId], () => {
                        syncUsersJsonFromDb();
                    });
                }

                resolve({
                    vip_level: actualVip,
                    discountRate: currentDiscountRate,
                    totalSpent: spent,
                    totalDeposited: deposited,
                    user: { ...user, vip_level: actualVip }
                });
            });
        });
    });
}

module.exports = { getUserVipInfo };