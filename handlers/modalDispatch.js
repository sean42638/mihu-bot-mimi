const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database'); // 🚀 引入資料庫以同步寫入
const { syncOrdersJsonFromDb } = require('../utils/dataSync');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        // 🚀 僅監聽由 /dispatch 發起的 Modal 提交事件
        if (!interaction.isModalSubmit() || !interaction.customId.startsWith('modal_disp_')) return;

        const sessionId = interaction.customId.replace('modal_disp_', '');
        const sessionData = global.dispatchSessions ? global.dispatchSessions.get(sessionId) : null;

        if (!sessionData) {
            return interaction.reply({ content: '❌ 派單 Session 已過期或不存在，請重新執行 `/派單` 指令。', flags: 64 });
        }

        try {
            // 1. 讀取 Modal 填寫內容
            const game = interaction.fields.getTextInputValue('dispatch_game');
            const contentTier = interaction.fields.getTextInputValue('dispatch_content');
            const extra = interaction.fields.getTextInputValue('dispatch_extra') || '無';
            const note = interaction.fields.getTextInputValue('dispatch_note') || '無';

            // 🚀 補強：確保 duration 與 unit 一定有預設值，防止未定義隱患
            const duration = sessionData.dur || 1;
            const unit = sessionData.unit || '小時';
            const totalPrice = sessionData.pri || 0;
            const unitPrice = duration > 0 ? (totalPrice / duration) : totalPrice; // 計算單價防錯

            let finalPrice = totalPrice;
            if (sessionData.disc > 0) {
                if (sessionData.disc < 1) {
                    finalPrice = Math.round(totalPrice * sessionData.disc);
                } else {
                    finalPrice = Math.max(0, totalPrice - sessionData.disc);
                }
            }

            // 2. 生成亂數單號 (例如: MH-20260925-8821)
            const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const randomNum = Math.floor(1000 + Math.random() * 9000);
            const orderNo = `MH-${dateStr}-${randomNum}`;

            // 客服資訊
            const csUser = interaction.user;
            const csName = interaction.member?.nickname || csUser.globalName || csUser.username;

            // 🚀 寫入 SQLite 資料庫 (防範 orders 欄位約束失敗)
            await new Promise((resolve, reject) => {
                const insertSql = `
                    INSERT INTO orders (
                        order_no, boss_id, cs_id, cs_name, category, 
                        game, content_tier, duration, unit, unit_price,
                        total_amount, discount, extra, note, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', DATETIME('now', 'localtime'))
                `;
                db.run(insertSql, [
                    orderNo,
                    sessionData.bId,
                    csUser.id,
                    csName,
                    sessionData.cat || '陪玩單',
                    game,
                    contentTier,
                    duration,
                    unit,
                    unitPrice,
                    finalPrice,
                    sessionData.disc || 0,
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

            // 同步 JSON 資料檔
            syncOrdersJsonFromDb();

            // 3. 處理身分組 Tag 格式
            const rawTag = (sessionData.tag || '').trim();
            const roleTag = (rawTag.startsWith('<@&') || rawTag.startsWith('<@')) 
                ? rawTag 
                : `<@&${rawTag}>`;

            // 4. 外層標題訊息：將 Tag 放置於兔子顏文字的最下方
            const contentText = `/)/)\n( . .) ｡ o O (   +:｡.｡ ✦**新 單 快 報**✦ ｡.｡:+\n( づ♡\n${roleTag}`;

            // 5. Embed 派單卡片：卡片內標題僅留點綴 ⋆⋅☆⋅⋆
            const dispatchEmbed = new EmbedBuilder()
                .setColor('#f59e0b') // 橘黃色金屬電競光邊
                .setTitle('⋆⋅☆⋅⋆') // 僅留精緻點綴
                .addFields(
                    { name: '📌 訂單編號', value: `\`${orderNo}\``, inline: false },
                    { name: '🎮 項目', value: `**${game}**`, inline: true },
                    { name: '📝 內容', value: `\`${contentTier}\``, inline: true },
                    { name: '⏰ 時長', value: `**${duration}${unit}**`, inline: true },
                    { name: '✨ 附加', value: extra, inline: false },
                    { name: '💬 備註', value: note, inline: false }
                )
                .setFooter({ text: `米胡電競 MiHu Gaming · 派單服務` })
                .setTimestamp();

            // 6. 搶單 / 接單按鈕
            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`accept_order_${orderNo}`)
                    .setLabel('🎯 立即搶單 / 接單')
                    .setStyle(ButtonStyle.Success)
            );

            // 7. 取得並發布至指定頻道
            const targetChannel = await interaction.guild.channels.fetch(sessionData.cId);
            if (!targetChannel) {
                return interaction.reply({ content: '❌ 找不到目標發布頻道。', flags: 64 });
            }

            await targetChannel.send({
                content: contentText,
                embeds: [dispatchEmbed],
                components: [actionRow]
            });

            // 8. 成功後清除快取與回覆
            global.dispatchSessions.delete(sessionId);
            await interaction.reply({ content: `✅ 派單訊息已成功發布至 <#${sessionData.cId}>！單號：\`${orderNo}\``, flags: 64 });

        } catch (error) {
            console.error('❌ 發布派單 Embed 時發生錯誤:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ 發布派單訊息失敗，請檢查權限與頻道設定。', flags: 64 });
            }
        }
    }
};