const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../database');
const { registerSlashCommands } = require('../bot');

const ordersJsonPath = path.join(__dirname, '..', 'data', 'orders.json');
const usersJsonPath = path.join(__dirname, '..', 'data', 'users.json');
const topupsJsonPath = path.join(__dirname, '..', 'data', 'topups.json');

// 💾 輔助寫回 JSON 函式
function syncOrdersJsonFromDb() {
    db.all('SELECT * FROM orders ORDER BY created_at DESC', (err, rows) => {
        if (!err && rows) {
            try {
                fs.writeFileSync(ordersJsonPath, JSON.stringify(rows, null, 2), 'utf8');
                console.log('💾 已即時同步最新訂單狀態至 data/orders.json');
            } catch (e) {
                console.error('❌ 寫入 data/orders.json 失敗:', e);
            }
        }
    });
}

function syncUsersJsonFromDb() {
    db.all('SELECT * FROM users ORDER BY created_at DESC', (err, rows) => {
        if (!err && rows) {
            try {
                fs.writeFileSync(usersJsonPath, JSON.stringify(rows, null, 2), 'utf8');
                console.log('💾 已即時同步最新會員資料至 data/users.json');
            } catch (e) {
                console.error('❌ 寫入 data/users.json 失敗:', e);
            }
        }
    });
}

function syncTopupsJsonFromDb() {
    db.all('SELECT * FROM topups ORDER BY created_at DESC', (err, rows) => {
        if (!err && rows) {
            try {
                fs.writeFileSync(topupsJsonPath, JSON.stringify(rows, null, 2), 'utf8');
                console.log('💾 已即時同步最新錢包紀錄至 data/topups.json');
            } catch (e) {
                console.error('❌ 寫入 data/topups.json 失敗:', e);
            }
        }
    });
}

// 1. 同步 Discord 斜線指令 API
router.post('/bot-settings/sync-commands', async (req, res) => {
    try {
        console.log('🔄 管理員發起 Discord 斜線指令同步...');
        const success = await registerSlashCommands();
        if (success) {
            return res.json({ success: true, message: 'Discord 斜線指令已成功即時同步發佈！' });
        } else {
            return res.json({ success: false, message: '同步失敗，請檢查 Token 與 Client ID。' });
        }
    } catch (error) {
        console.error('❌ 後台同步指令失敗:', error);
        return res.status(500).json({ success: false, message: '伺服器內部錯誤：' + error.message });
    }
});

// 2. 編輯 / 改派 / 物理刪除 / 點單消費驗證 API
router.post('/orders/update/:id', (req, res) => {
    const orderId = req.params.id;
    const {
        is_delete,
        category,
        game,
        content_tier,
        duration,
        unit,
        total_amount,
        talent_id,
        status,
        talent_message,
        note
    } = req.body;

    // 🚀 若觸發手動刪除（店長/管理員物理刪除權限），直接執行 SQL DELETE 並寫回 json
    if (is_delete === '1' || status === 'delete') {
        db.run('DELETE FROM orders WHERE id = ?', [orderId], (err) => {
            if (err) {
                console.error(`❌ 刪除訂單 ID #${orderId} 失敗:`, err);
                return res.status(500).send('刪除訂單失敗');
            }
            console.log(`🗑️ 訂單 ID #${orderId} 已成功物理刪除！`);
            syncOrdersJsonFromDb();
            return res.redirect('/management/orders?saved=1');
        });
        return;
    }

    // 取得舊訂單確認扣款狀態
    db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, oldOrder) => {
        if (err || !oldOrder) {
            return res.status(404).send('找不到該訂單');
        }

        const newTotalAmount = Number(total_amount || oldOrder.total_amount || 0);

        // 🛑 核心餘額檢查 Guardrail：成立或確認訂單扣款時，必須檢查老闆可用餘額 (實充 + 贈金)
        if (status === 'completed' && oldOrder.status !== 'completed') {
            db.get('SELECT id, balance, bonus_balance FROM users WHERE id = ?', [oldOrder.boss_id], (uErr, boss) => {
                if (uErr || !boss) {
                    return res.redirect('/management/orders?error=' + encodeURIComponent('點單失敗：找不到訂單所屬老闆會員'));
                }

                const currentBalance = Number(boss.balance || 0);
                const currentBonus = Number(boss.bonus_balance || 0);
                const totalAvailable = currentBalance + currentBonus;

                if (totalAvailable < newTotalAmount) {
                    return res.redirect('/management/orders?error=' + encodeURIComponent(`點單扣款失敗：該會員可用餘額不足 ($${totalAvailable})，無法支付訂單金額 ($${newTotalAmount})`));
                }

                // 優先扣除贈金，不足再扣實充餘額 (保證不低於 0)
                let remaining = newTotalAmount;
                let newBonus = currentBonus;
                let newBalance = currentBalance;

                if (newBonus >= remaining) {
                    newBonus -= remaining;
                    remaining = 0;
                } else {
                    remaining -= newBonus;
                    newBonus = 0;
                    newBalance = Math.max(0, newBalance - remaining);
                }

                // 執行扣款與訂單更新
                db.run('UPDATE users SET balance = ?, bonus_balance = ? WHERE id = ?', [newBalance, newBonus, boss.id], (upErr) => {
                    if (!upErr) {
                        db.run(
                            'INSERT INTO topups (user_id, amount, bonus, channel_type, note, operator_id) VALUES (?, ?, ?, "訂單扣款", ?, ?)',
                            [boss.id, -(currentBalance - newBalance), -(currentBonus - newBonus), `訂單 #${oldOrder.order_no} 結算扣款`, req.user ? req.user.id : null],
                            () => syncTopupsJsonFromDb()
                        );
                        syncUsersJsonFromDb();
                    }
                });
            });
        }

        // 正常更新訂單內容
        const updateSql = `
            UPDATE orders SET
                category = ?,
                game = ?,
                content_tier = ?,
                duration = ?,
                unit = ?,
                total_amount = ?,
                talent_id = ?,
                status = ?,
                talent_message = ?,
                note = ?
            WHERE id = ?
        `;

        db.run(updateSql, [
            category,
            game,
            content_tier,
            duration,
            unit,
            newTotalAmount,
            talent_id || null,
            status,
            talent_message,
            note,
            orderId
        ], function(uErr) {
            if (uErr) {
                console.error('更新訂單失敗:', uErr);
                return res.status(500).send('更新訂單資料庫失敗');
            }

            console.log(`✅ 訂單 ID #${orderId} 已成功更新！`);
            syncOrdersJsonFromDb();
            res.redirect('/management/orders?saved=1');
        });
    });
});

module.exports = router;