const { EmbedBuilder } = require('discord.js');
const db = require('../database');
const { syncOrdersJsonFromDb } = require('../utils/dataSync');
const { adjustUserWallet } = require('../utils/walletHelper');
const { calculateCommissionByCategory } = require('../utils/commissionHelper');
const { checkChannelPermissions } = require('../utils/permissionHelper');
const { createMihuEmbed, BRAND_COLORS } = require('../utils/embedBuilder');

async function handleDispatchModal(interaction) {
    // 🚀 1. 安全捕捉 deferReply，防止 Discord Interaction Token 逾時或過期 (10062) 導致崩潰
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ flags: 64 });
        }
    } catch (deferErr) {
        console.warn('⚠️ Dispatch Modal deferReply 逾時或 Token 已失效:', deferErr.message);
        return;
    }

    const sessionId = interaction.customId.replace('modal_dispatch_', '').replace('modal_disp_', '');
    const sessionData = global.dispatchSessions ? global.dispatchSessions.get(sessionId) : null;

    if (!sessionData) {
        return interaction.editReply({ content: '❌ 派單 Session 已過期，請重新執行 `/dispatch` 指令。' }).catch(() => {});
    }

    try {
        const bossId = sessionData.bId;
        const category = sessionData.cat || '陪玩單';
        const tagInput = sessionData.tag || ''; // 取出指定的 Tag 身分組
        const duration = sessionData.dur || 1;
        const totalPrice = sessionData.pri || 0;
        const csUserId = sessionData.csId || interaction.user.id; // 自動抓指令發送者 ID

        // 1. 計算折後金額
        let finalPrice = totalPrice;
        let discountAmount = 0;
        if (sessionData.disc > 0) {
            if (sessionData.disc < 1) {
                finalPrice = Math.round(totalPrice * sessionData.disc);
                discountAmount = totalPrice - finalPrice;
            } else {
                discountAmount = Math.min(totalPrice, sessionData.disc);
                finalPrice = Math.max(0, totalPrice - discountAmount);
            }
        }

        // 2. 自動連動抽傭計算 (背景紀錄與資料庫儲存)
        const { commissionRatePercent, platformCommission, talentNetEarning } = await calculateCommissionByCategory(category, finalPrice);

        // 3. 驗證闆闆會員與錢包餘額
        const walletRow = await new Promise((resolve) => {
            db.get('SELECT * FROM user_wallets WHERE user_id = ?', [bossId], (err, row) => {
                if (row) return resolve(row);
                db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [bossId], (uErr, uRow) => resolve(uRow || null));
            });
        });

        if (!walletRow) {
            return interaction.editReply({
                content: `🚫 **無法發布派單**：闆闆 <@${bossId}> 尚未在系統中註冊會員帳號！請先引導其使用 \`/register\` 完成註冊。`
            }).catch(() => {});
        }

        const currentBalance = Number(walletRow.balance || 0);
        const currentBonus = Number(walletRow.bonus_balance || 0);
        const totalAvailable = currentBalance + currentBonus;

        if (totalAvailable < finalPrice) {
            const shortAmount = finalPrice - totalAvailable;
            return interaction.editReply({
                content: `🚫 **闆闆錢包餘額不足**：\n` +
                         `• 闆闆：<@${bossId}>\n` +
                         `• 本次派單需扣款：\`$${finalPrice.toLocaleString()}\` NTD\n` +
                         `• 當前可用總餘額：\`$${totalAvailable.toLocaleString()}\` NTD (實充: $${currentBalance} / 贈送: $${currentBonus})\n` +
                         `• 尚缺金額：\`$${shortAmount.toLocaleString()}\` NTD\n` +
                         `請通知闆闆充值預存後再行派單！`
            }).catch(() => {});
        }

        // 4. 進行錢包扣款
        await adjustUserWallet({
            userId: bossId,
            addAmount: -finalPrice,
            bonusChange: 0,
            reason: `大廳派單扣款 (${category})`,
            operatorId: interaction.user.id
        });

        const game = interaction.fields.getTextInputValue('dispatch_game');
        const contentTier = interaction.fields.getTextInputValue('dispatch_content');
        const extra = interaction.fields.getTextInputValue('dispatch_extra') || '無';
        const note = interaction.fields.getTextInputValue('dispatch_note') || '無';

        const unit = sessionData.unit || '小時';
        const unitPrice = duration > 0 ? (totalPrice / duration) : totalPrice;

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const orderNo = `MH-${dateStr}-${randomNum}`;

        const csUser = interaction.user;
        const csName = sessionData.csName || interaction.member?.nickname || csUser.globalName || csUser.username;

        // 5. 寫入 orders 資料庫
        await new Promise((resolve, reject) => {
            const insertSql = `
                INSERT INTO orders (
                    order_no, boss_id, cs_id, cs_name, category, 
                    game, content_tier, duration, unit, unit_price,
                    total_amount, discount, extra, note, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', DATETIME('now', 'localtime'))
            `;
            db.run(insertSql, [
                orderNo, bossId, csUserId, csName, category,
                game, contentTier, duration, unit, unitPrice,
                finalPrice, discountAmount, extra, note
            ], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });

        syncOrdersJsonFromDb();

        // 6. 檢查發布頻道權限
        const targetChannel = await interaction.guild.channels.fetch(sessionData.cId).catch(() => null);
        const permCheck = checkChannelPermissions(targetChannel, interaction.client);
        if (!permCheck.hasAccess) {
            return interaction.editReply({ content: permCheck.errorMsg }).catch(() => {});
        }

        // 💡 構建指定標題與無 Emoji 的簡潔欄位小卡
        const dispatchEmbed = createMihuEmbed({
            title: 'MiHu Gaming',
            color: BRAND_COLORS.PURPLE || 0x8b5cf6,
            footerText: '米胡電競 MiHu Gaming · 派單服務系統'
        })
        // 第一排：訂單編號、負責客服 (無 Emoji)
        .addFields(
            { name: '📌 訂單編號', value: `\`${orderNo}\``, inline: true },
            { name: '負責客服', value: `<@${csUserId}>`, inline: true },
            { name: '\u200b', value: '\u200b', inline: true }
        )
        // 第二排：服務項目、內容規格 (無 Emoji)、服務時長 (無 Emoji)
        .addFields(
            { name: '🎮 服務項目', value: `**${game}**`, inline: true },
            { name: '內容規格', value: `\`${contentTier}\``, inline: true },
            { name: '服務時長', value: `**${duration}${unit}**`, inline: true }
        );

        // 第三排：附加條件 (單獨佔滿整行)
        if (extra && extra !== '無') {
            dispatchEmbed.addFields({ name: '✨ 附加條件', value: extra, inline: false });
        }

        // 第四排：備註說明 (單獨佔滿整行)
        if (note && note !== '無') {
            dispatchEmbed.addFields({ name: '💬 備註說明', value: note, inline: false });
        }

        // 🎯 構建頁面文字 (顏文字與 Tag 完美融入)
        const outerText = `/)/)\n` +
                          `( . .) ｡ o O (   +:｡.｡ ✦新 單 快 報✦ ｡.｡:+\n` +
                          `( づ♡. ${tagInput}`;

        // 🚀 發送至目標頻道：純文字 + 美化小卡
        await targetChannel.send({
            content: outerText,
            embeds: [dispatchEmbed]
        });

        global.dispatchSessions.delete(sessionId);
        await interaction.editReply({
            content: `✅ **派單發布成功！已自動扣除闆闆 $${finalPrice.toLocaleString()} NTD。**\n` +
                     `📌 **單號**：\`${orderNo}\``
        }).catch(() => {});

    } catch (err) {
        console.error('❌ 發布派單失敗:', err);
        await interaction.editReply({ content: `❌ **發布失敗**：${err.message}` }).catch(() => {});
    }
}

module.exports = {
    handleDispatchModal
};