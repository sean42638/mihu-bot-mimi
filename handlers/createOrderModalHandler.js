const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database');
const { syncOrdersJsonFromDb } = require('../utils/dataSync');
const { adjustUserWallet } = require('../utils/walletHelper');
const { calculateCommissionByCategory } = require('../utils/commissionHelper'); // 👈 引用連動 Helper
const { createMihuEmbed, BRAND_COLORS } = require('../utils/embedBuilder');

async function handleCreateOrderModal(interaction) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: 64 });
    }

    const sessionId = interaction.customId.replace('modal_create_order_', '');
    const sessionData = global.createOrderSessions ? global.createOrderSessions.get(sessionId) : null;

    if (!sessionData) {
        return interaction.editReply({ content: '❌ 建立訂單 Session 已過期，請重新執行 `/建立訂單` 指令。' });
    }

    try {
        const bossId = sessionData.bId;
        const talentId = sessionData.tId;
        const category = sessionData.cat; // 5 大類別選項之一
        const duration = sessionData.dur || 1;
        const totalPrice = sessionData.pri || 0;

        // 1. 計算折後總價
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

        // 🚀 2. 自動根據類別 (category) 連動計算抽傭 % 數與實得金額
        const { commissionRatePercent, platformCommission, talentNetEarning } = await calculateCommissionByCategory(category, finalPrice);

        // 3. 檢核老闆會員與錢包餘額
        const walletRow = await new Promise((resolve) => {
            db.get('SELECT * FROM user_wallets WHERE user_id = ?', [bossId], (err, row) => {
                if (row) return resolve(row);
                db.get('SELECT balance, bonus_balance FROM users WHERE id = ?', [bossId], (uErr, uRow) => resolve(uRow || null));
            });
        });

        if (!walletRow) {
            return interaction.editReply({ content: `🚫 **無法建立訂單**：老闆 <@${bossId}> 尚未在系統中註冊會員帳號！` });
        }

        const currentBalance = Number(walletRow.balance || 0);
        const currentBonus = Number(walletRow.bonus_balance || 0);
        const totalAvailable = currentBalance + currentBonus;

        if (totalAvailable < finalPrice) {
            const shortAmount = finalPrice - totalAvailable;
            return interaction.editReply({
                content: `🚫 **老闆錢包餘額不足**：\n` +
                         `• 老闆：<@${bossId}>\n` +
                         `• 本次訂單需扣款：\`$${finalPrice.toLocaleString()}\` NTD\n` +
                         `• 當前可用總餘額：\`$${totalAvailable.toLocaleString()}\` NTD\n` +
                         `• 尚缺金額：\`$${shortAmount.toLocaleString()}\` NTD`
            });
        }

        // 4. 查詢陪玩師專屬工單頻道
        const talentRow = await new Promise((resolve) => {
            db.get('SELECT * FROM talents WHERE user_id = ?', [talentId], (err, row) => resolve(row || null));
        });

        if (!talentRow || !talentRow.staff_channel_id) {
            return interaction.editReply({ content: `⚠️ **建立失敗！** 陪玩師 <@${talentId}> 尚未綁定專屬工單頻道。` });
        }

        // 5. 執行老闆錢包扣款
        await adjustUserWallet({
            userId: bossId,
            addAmount: -finalPrice,
            bonusChange: 0,
            reason: `手動建立訂單扣款 (${category})`,
            operatorId: interaction.user.id
        });

        const game = interaction.fields.getTextInputValue('order_game');
        const contentTier = interaction.fields.getTextInputValue('order_content') || '標準規格';
        const extra = interaction.fields.getTextInputValue('order_extra') || '無';
        const note = interaction.fields.getTextInputValue('order_note') || '無';

        const unit = sessionData.unit || '小時';
        const unitPrice = duration > 0 ? (totalPrice / duration) : totalPrice;

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const orderNo = `MH-${dateStr}-${randomNum}`;

        const csUser = interaction.user;
        const csName = interaction.member?.nickname || csUser.globalName || csUser.username;

        // 6. 寫入 orders 資料庫 (含平台傭金與陪陪實得)
        await new Promise((resolve, reject) => {
            const insertSql = `
                INSERT INTO orders (
                    order_no, boss_id, talent_id, cs_id, cs_name, category, 
                    game, content_tier, duration, unit, unit_price,
                    total_amount, discount, extra, note, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', DATETIME('now', 'localtime'))
            `;
            db.run(insertSql, [
                orderNo, bossId, talentId, csUser.id, csName, category,
                game, contentTier, duration, unit, unitPrice,
                finalPrice, discountAmount, extra, note
            ], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });

        syncOrdersJsonFromDb();

        // 7. 推送至陪陪專屬工單頻道 (顯示實收總價、抽傭 % 數與陪陪實得)
        const staffChannel = await interaction.client.channels.fetch(talentRow.staff_channel_id).catch(() => null);
        if (staffChannel) {
            const detailEmbed = createMihuEmbed({
                title: '📋 管理員為您建立了全新的訂單！',
                color: BRAND_COLORS.BLUE || 0x3b82f6,
                footerText: '米胡電競 MiHu Gaming · 手動建立訂單'
            })
            .addFields(
                { name: '📌 訂單編號', value: `\`${orderNo}\``, inline: true },
                { name: '👤 老闆 ID', value: `<@${bossId}> (\`${bossId}\`)`, inline: true },
                { name: '🏷️ 訂單類別', value: `\`${category}\` *(抽傭 ${commissionRatePercent})*`, inline: true },
                { name: '🎮 服務項目', value: `**${game}**`, inline: true },
                { name: '📝 內容規格', value: `\`${contentTier}\``, inline: true },
                { name: '⏱️ 數量/時長', value: `**${duration}${unit}**`, inline: true },
                { name: '💰 訂單總價', value: `\`$${finalPrice.toLocaleString()}\` NTD`, inline: true },
                { name: '💵 預計實得', value: `**$${talentNetEarning.toLocaleString()} NTD** *(已扣抽傭 $${platformCommission})*`, inline: true }
            );

            if (extra && extra !== '無') detailEmbed.addFields({ name: '✨ 附加條件', value: extra, inline: false });
            if (note && note !== '無') detailEmbed.addFields({ name: '💬 備註說明', value: note, inline: false });

            const confirmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`order_confirm_${orderNo}`)
                    .setLabel('✅ 確認完成訂單')
                    .setStyle(ButtonStyle.Success)
            );

            await staffChannel.send({
                content: `🔔 <@${talentId}> 您有一筆由管理員發布的新訂單！請在服務完成後點擊下方按鈕確認：`,
                embeds: [detailEmbed],
                components: [confirmRow]
            });
        }

        global.createOrderSessions.delete(sessionId);

        // 8. 僅限管理員可見的回報
        await interaction.editReply({
            content: `✅ **訂單已建立完成，已派送至陪陪專屬工單！**\n` +
                     `📌 **單號**：\`${orderNo}\` \n` +
                     `🏷️ **類別抽傭**：\`${category}\` (${commissionRatePercent} 抽成 $${platformCommission} NTD / 陪陪實得 $${talentNetEarning} NTD)`
        });

    } catch (err) {
        console.error('❌ 手動建立訂單失敗:', err);
        await interaction.editReply({ content: `❌ **建立失敗**：${err.message}` }).catch(() => {});
    }
}

module.exports = {
    handleCreateOrderModal
};