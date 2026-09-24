const { EmbedBuilder } = require('discord.js');
const db = require('../database'); // 🚀 引入資料庫模組以寫入訂單

module.exports = {
    async handleDispatchModal(interaction) {
        // 1. 第一時間 Defer
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

            // 計算實收金額
            let finalPrice = session.pri;
            if (session.disc > 0) {
                if (session.disc < 1) {
                    finalPrice = Math.round(session.pri * session.disc);
                } else {
                    finalPrice = Math.max(0, session.pri - session.disc);
                }
            }

            // 抓取目標頻道與發送者（負責客服）
            const targetChannel = await interaction.guild.channels.fetch(session.cId).catch(() => null);
            if (!targetChannel) {
                return interaction.editReply({ content: '❌ 找不到目標發佈頻道，請檢查權限或頻道設定。' });
            }

            // 客服資訊
            const csUser = interaction.user;
            const csMention = `<@${csUser.id}>`;
            const csName = interaction.member?.nickname || csUser.globalName || csUser.username;

            // 🚀 2. 將訂單寫入資料庫 (包含 cs_id 與 cs_name)
            await new Promise((resolve, reject) => {
                const querySql = `
                    INSERT INTO orders (
                        order_no, boss_id, cs_id, cs_name, category, 
                        game, content_tier, duration, unit, total_amount, 
                        discount, extra, note, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', DATETIME('now', 'localtime'))
                `;
                db.run(querySql, [
                    orderNo,
                    session.bId,
                    csUser.id,
                    csName,
                    session.cat || '陪玩單',
                    game,
                    contentTier,
                    session.dur,
                    session.unit,
                    finalPrice,
                    session.disc,
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

            // 3. 發布至群組頻道的外層訊息
            const contentText = `${session.tag}\n/)/)\n( . .) ｡ o O (   +:｡.｡ ✦**新 單 快 報**✦ ｡.｡:+\n( づ♡`;

            // 4. 發布至群組頻道的派單 Embed 小卡
            const dispatchEmbed = new EmbedBuilder()
                .setColor('#f59e0b')
                .setTitle('⋆⋅☆⋅⋆')
                .addFields(
                    { name: '📌 訂單編號', value: `\`${orderNo}\``, inline: true },
                    { name: '🎧 負責客服', value: csMention, inline: true },
                    { name: ' \u200B', value: ' \u200B', inline: true },
                    { name: '🎮 項目', value: `**${game}**`, inline: true },
                    { name: '📝 內容', value: `\`${contentTier}\``, inline: true },
                    { name: '⏰ 時長', value: `**${session.dur} ${session.unit}**`, inline: true },
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

            // 5. 僅限發送者可見的私人簡短回報訊息
            await interaction.editReply({
                content: `✅ **已成功派單！**\n• 訂單編號：\`${orderNo}\`\n• 發布頻道：<#${session.cId}>`
            });

        } catch (error) {
            console.error('❌ 處理派單 Modal 出錯:', error);
            await interaction.editReply({ content: '⚠️ 發布派單訊息時發生錯誤：' + error.message }).catch(() => {});
        }
    }
};