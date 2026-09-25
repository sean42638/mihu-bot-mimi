const { EmbedBuilder } = require('discord.js');
const db = require('../database'); // 🚀 引入資料庫模組以寫入訂單與更新錢包
const { getUserWallet, deductWallet } = require('../utils/walletHelper'); // 🚀 引入獨立錢包工具

module.exports = {
    async handleDispatchModal(interaction) {
        // 1. 第一時間 Defer，避免 Discord 3秒逾時
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: 64 });
            }
        } catch (deferErr) {
            return;
        }

        try {
            // 解析 sessionId
            const sessionId = interaction.customId.replace('modal_disp_', '');
            const session = global.dispatchSessions ? global.dispatchSessions.get(sessionId) : null;

            if (!session) {
                return interaction.editReply({ content: '❌ 派單 Session 已過期或不存在，請重新執行 `/派單` 指令。' }).catch(() => {});
            }

            // 從 Modal 取得輸入內容
            const game = interaction.fields.getTextInputValue('dispatch_game');
            const contentTier = interaction.fields.getTextInputValue('dispatch_content');
            const extra = interaction.fields.getTextInputValue('dispatch_extra') || '無特別條件';
            const note = interaction.fields.getTextInputValue('dispatch_note') || '無特別備註';

            // 產生隨機訂單編號 (MH-YYYYMMDD-XXXX)
            const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const randNum = Math.floor(1000 + Math.random() * 9000);
            const orderNo = `MH-${dateStr}-${randNum}`;

            // 計算實收總金額與單價
            const totalPrice = session.pri || 0; // 原價總額
            const duration = session.dur || 1;   // 時長/數量
            const unitPrice = duration > 0 ? (totalPrice / duration) : totalPrice; // 計算單價

            let finalPrice = totalPrice;
            if (session.disc > 0) {
                if (session.disc < 1) {
                    finalPrice = Math.round(totalPrice * session.disc);
                } else {
                    finalPrice = Math.max(0, totalPrice - session.disc);
                }
            }

            const bossId = session.bId;

            // 🚀 2. 核心檢查：使用獨立錢包模組查詢闆闆錢包金額
            let bossWallet;
            try {
                bossWallet = await getUserWallet(bossId);
            } catch (wErr) {
                // 降級防錯直接撈資料庫
                const bossUser = await new Promise((resolve) => {
                    db.get('SELECT * FROM users WHERE id = ?', [bossId], (err, row) => resolve(row || null));
                });
                if (!bossUser) {
                    return interaction.editReply({ content: `❌ 系統找不到 ID 為 \`${bossId}\` 的闆闆資料，無法進行派單扣款。` });
                }
                bossWallet = {
                    balance: Number(bossUser.balance || 0),
                    bonus_balance: Number(bossUser.bonus_balance || 0),
                    total_balance: Number(bossUser.balance || 0) + Number(bossUser.bonus_balance || 0)
                };
            }

            // ⚠️ 餘額不足判斷與攔截
            if (bossWallet.total_balance < finalPrice) {
                return interaction.editReply({
                    content: `⚠️ **闆闆帳戶餘額不足，無法完成派單！**\n` +
                             `• 闆闆名稱：<@${bossId}>\n` +
                             `• 當前總餘額：\`$${bossWallet.total_balance.toLocaleString()}\` NTD (實充 $${bossWallet.balance.toLocaleString()} + 贈送 $${bossWallet.bonus_balance.toLocaleString()})\n` +
                             `• 本次訂單金額：\`$${finalPrice.toLocaleString()}\` NTD\n` +
                             `• 缺少金額：\`$${(finalPrice - bossWallet.total_balance).toLocaleString()}\` NTD\n` +
                             `請先引導闆闆進行預存充值後再重新派單！`
                });
            }

            // 🚀 3. 執行扣款邏輯 (優先扣除贈送金 bonus_balance，剩餘再扣除實充金額 balance)
            let deductBonus = 0;
            let deductReal = 0;

            if (bossWallet.bonus_balance >= finalPrice) {
                deductBonus = finalPrice;
            } else {
                deductBonus = bossWallet.bonus_balance;
                deductReal = finalPrice - bossWallet.bonus_balance;
            }

            const newBonus = bossWallet.bonus_balance - deductBonus;
            const newReal = bossWallet.balance - deductReal;

            // 寫入錢包扣款更新
            await new Promise((resolve, reject) => {
                db.run(
                    'UPDATE users SET balance = ?, bonus_balance = ? WHERE id = ?',
                    [newReal, newBonus, bossId],
                    (err) => err ? reject(err) : resolve()
                );
            });

            // 寫入錢包流水紀錄 (wallet_transactions)
            db.run(`
                INSERT INTO wallet_transactions (user_id, type, amount, description, created_at)
                VALUES (?, 'order_deduct', ?, ?, DATETIME('now', 'localtime'))
            `, [bossId, -finalPrice, `派單扣款 - 訂單號: ${orderNo} (${game})`], () => {});

            // 抓取目標頻道與發送者（負責客服）
            const targetChannel = await interaction.guild.channels.fetch(session.cId).catch(() => null);
            if (!targetChannel) {
                return interaction.editReply({ content: '❌ 找不到目標發佈頻道，請檢查權限或頻道設定。' });
            }

            // 客服資訊
            const csUser = interaction.user;
            const csMention = `<@${csUser.id}>`;
            const csName = interaction.member?.nickname || csUser.globalName || csUser.username;

            // 🚀 4. 將訂單寫入資料庫
            await new Promise((resolve, reject) => {
                const querySql = `
                    INSERT INTO orders (
                        order_no, boss_id, cs_id, cs_name, category, 
                        game, content_tier, duration, unit, unit_price,
                        total_amount, discount, extra, note, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', DATETIME('now', 'localtime'))
                `;
                db.run(querySql, [
                    orderNo,
                    bossId,
                    csUser.id,
                    csName,
                    session.cat || '陪玩單',
                    game,
                    contentTier,
                    duration,
                    session.unit || '小時',
                    unitPrice,
                    finalPrice,
                    session.disc || 0,
                    extra,
                    note
                ], function(err) {
                    if (err) {
                        console.error('❌ 寫入訂單至資料庫失敗:', err);
                        reject(err);
                    } else {
                        resolve(this.lastID);
                    }
                });
            });

            // 5. 發布至群組頻道的外層訊息
            const contentText = `${session.tag}\n/)/)\n( . .) ｡ o O (   +:｡.｡ ✦**新 單 快 報**✦ ｡.｡:+\n( づ♡`;

            // 6. 發布至群組頻道的派單 Embed 小卡
            const dispatchEmbed = new EmbedBuilder()
                .setColor('#f59e0b')
                .setTitle('⋆⋅☆⋅⋆')
                .addFields(
                    { name: '📌 訂單編號', value: `\`${orderNo}\``, inline: true },
                    { name: '🎧 負責客服', value: csMention, inline: true },
                    { name: ' \u200B', value: ' \u200B', inline: true },
                    { name: '🎮 項目', value: `**${game}**`, inline: true },
                    { name: '📝 內容', value: `\`${contentTier}\``, inline: true },
                    { name: '⏰ 時長', value: `**${duration} ${session.unit}**`, inline: true },
                    { name: '✨ 附加', value: extra, inline: false },
                    { name: '💬 備註', value: note, inline: false }
                )
                .setFooter({ text: '米胡電競 MiHu Gaming · 派單服務' })
                .setTimestamp();

            // 發送派單公佈卡片
            await targetChannel.send({
                content: contentText,
                embeds: [dispatchEmbed]
            });

            // 清理 Session
            global.dispatchSessions.delete(sessionId);

            // 7. 僅限發送者可見的私人簡短回報訊息 (含扣款提示)
            await interaction.editReply({
                content: `✅ **已成功扣款並發布派單！**\n` +
                         `• 訂單編號：\`${orderNo}\`\n` +
                         `• 闆闆扣款：\`$${finalPrice.toLocaleString()}\` NTD (扣除贈送金 $${deductBonus} / 實充 $${deductReal})\n` +
                         `• 發布頻道：<#${session.cId}>`
            });

        } catch (error) {
            console.error('❌ 處理派單 Modal 出錯:', error);
            await interaction.editReply({ content: '⚠️ 發布派單訊息時發生錯誤：' + error.message }).catch(() => {});
        }
    }
};