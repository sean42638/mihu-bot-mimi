const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { createMihuEmbed, BRAND_COLORS } = require('../utils/embedBuilder');
const { syncOrdersJsonFromDb, syncUsersJsonFromDb } = require('../utils/dataSync');
const { getUserWallet, adjustUserWallet } = require('../utils/walletHelper');

// 🚀 本地安全折扣計算工具 (防範外部 Helper 匯出格式不符問題)
function calculateDiscount(rawPrice, inputDiscount) {
    const price = Math.max(0, Number(rawPrice || 0));
    const disc = Number(inputDiscount || 0);

    let finalAmount = price;
    let discountAmount = 0;
    let discountText = '';

    if (disc > 0) {
        if (disc >= 1) {
            // 直減金額 (例如 輸入 100 意為折抵 $100)
            discountAmount = disc;
            finalAmount = Math.max(0, price - discountAmount);
            discountText = `直減 $${discountAmount} NTD`;
        } else {
            // 折扣比例 (例如 輸入 0.8 意為 8 折 / 20% off)
            finalAmount = Math.round(price * disc);
            discountAmount = price - finalAmount;
            discountText = `${(disc * 10).toFixed(1).replace('.0', '')} 折`;
        }
    }

    return {
        finalAmount,
        discountAmount,
        discountText
    };
}

function checkDiscordAdminPermission(member, userId) {
    if (userId === "604610298581876746") return true;
    return member && member.permissions && member.permissions.has(PermissionFlagsBits.Administrator);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('select')
        .setNameLocalizations({ 'zh-TW': '選人' })
        .setDescription('客服指派陪陪接單，自動多退少補錢包金額，並推送詳細訂單卡片至陪陪專屬頻道')
        .addStringOption(o => o.setName('order_no').setNameLocalizations({ 'zh-TW': '訂單編號' }).setDescription('欲指派的訂單編號').setRequired(true))
        .addUserOption(o => o.setName('talent').setNameLocalizations({ 'zh-TW': '陪陪' }).setDescription('獲選接單的陪玩師').setRequired(true))
        .addNumberOption(o => o.setName('total_price').setNameLocalizations({ 'zh-TW': '原價' }).setDescription('覆蓋或設定訂單原價 (選填)').setRequired(false))
        .addNumberOption(o => o.setName('discount').setNameLocalizations({ 'zh-TW': '折扣' }).setDescription('覆蓋或設定折扣 (>=1直減, 0.1~0.99折數) (選填)').setRequired(false)),
    async execute(interaction, client) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: 64 });
            }
        } catch (e) {}

        if (!checkDiscordAdminPermission(interaction.member, interaction.user.id)) {
            return interaction.editReply({ content: '🚫 只有 Discord 客服與管理者身分能使用此指令。' });
        }

        const orderNo = interaction.options.getString('order_no').trim();
        const talentUser = interaction.options.getUser('talent');
        const inputPrice = interaction.options.getNumber('total_price');
        const inputDiscount = interaction.options.getNumber('discount');

        // 1. 查詢訂單資料
        db.get('SELECT * FROM orders WHERE order_no = ?', [orderNo], (err, order) => {
            if (err || !order) return interaction.editReply({ content: `❌ 找不到編號為 \`${orderNo}\` 的訂單！` });

            db.get('SELECT * FROM talents WHERE user_id = ?', [talentUser.id], async (tErr, talentRow) => {
                if (!talentRow || !talentRow.staff_channel_id) {
                    return interaction.editReply({ content: `⚠️ **指派失敗！** 陪陪 <@${talentUser.id}> 尚未綁定專屬頻道。` });
                }

                const targetStaffChannelId = talentRow.staff_channel_id;

                // 🚀 核心連動邏輯：有輸入則覆蓋，沒輸入則繼承 /dispatch 時設定的值
                const effectiveRawPrice = (inputPrice !== null && inputPrice !== undefined)
                    ? inputPrice
                    : Number(order.unit_price || order.total_amount || 0);

                const effectiveRawDiscount = (inputDiscount !== null && inputDiscount !== undefined)
                    ? inputDiscount
                    : Number(order.discount || 0);

                // 使用防錯計算函式計算新金額
                const { finalAmount, discountAmount, discountText } = calculateDiscount(effectiveRawPrice, effectiveRawDiscount);

                const oldFinalAmount = Number(order.total_amount || 0);
                const priceDiff = finalAmount - oldFinalAmount; // >0 代表變貴補扣； <0 代表變便宜退款
                const bossId = order.boss_id;
                let walletNoticeText = '';

                // 🚀 2. 錢包金額多退少補檢查與執行 (完全整合最新全後台統一帳務引擎)
                try {
                    if (priceDiff > 0) {
                        // 情況 A：價格變貴，需要補扣款
                        const bossWallet = await getUserWallet(bossId);

                        if (bossWallet.total_balance < priceDiff) {
                            return interaction.editReply({
                                content: `⚠️ **選人指派失敗：闆闆錢包餘額不足以支付改價差額！**\n` +
                                         `• 原派單金額：\`$${oldFinalAmount.toLocaleString()}\` NTD\n` +
                                         `• 新調整金額：\`$${finalAmount.toLocaleString()}\` NTD\n` +
                                         `• 需要補扣差額：\`$${priceDiff.toLocaleString()}\` NTD\n` +
                                         `• 闆闆當前總餘額：\`$${bossWallet.total_balance.toLocaleString()}\` NTD\n` +
                                         `請先引導闆闆充值預存後，再重新執行選人！`
                            });
                        }

                        // 執行補扣款 (調用全後台統一資金處理核心)
                        await adjustUserWallet({
                            userId: bossId,
                            addAmount: -priceDiff, // 帶入負數金額進行補扣
                            reason: `選人改價補扣 - 訂單號: ${orderNo}`,
                            operatorId: interaction.user.id
                        });

                        walletNoticeText = `\n💳 **錢包補扣**：\`$${priceDiff.toLocaleString()}\` NTD (已成功自闆闆錢包扣除)`;

                    } else if (priceDiff < 0) {
                        // 情況 B：價格變便宜，將差額退回闆闆錢包
                        const refundDiff = Math.abs(priceDiff);

                        await adjustUserWallet({
                            userId: bossId,
                            addAmount: refundDiff, // 帶入正數金額進行退款
                            reason: `選人降價退款 - 訂單號: ${orderNo}`,
                            operatorId: interaction.user.id
                        });

                        // 寫入錢包交易流水紀錄 (wallet_transactions)
                        db.run(`
                            INSERT INTO wallet_transactions (user_id, type, amount, description, created_at)
                            VALUES (?, 'order_refund', ?, ?, DATETIME('now', 'localtime'))
                        `, [bossId, refundDiff, `選人降價退款 - 訂單號: ${orderNo}`], () => {});

                        walletNoticeText = `\n💳 **錢包退款**：\`$${refundDiff.toLocaleString()}\` NTD (已退回闆闆錢包)`;
                    }
                } catch (walletError) {
                    console.error('❌ 選人錢包計算出錯:', walletError);
                    return interaction.editReply({ content: `❌ 處理錢包帳務時發生錯誤：${walletError.message}` });
                }

                // 🚀 3. 更新訂單資料庫
                const updateSql = `
                    UPDATE orders SET 
                        talent_id = ?, 
                        staff_id = ?, 
                        unit_price = ?, 
                        discount = ?, 
                        total_amount = ?, 
                        status = "accepted" 
                    WHERE order_no = ?
                `;

                db.run(updateSql, [talentUser.id, talentUser.id, effectiveRawPrice, discountAmount, finalAmount, orderNo], async (upErr) => {
                    if (upErr) return interaction.editReply({ content: '❌ 更新訂單指派資料失敗。' });
                    
                    // 同步 JSON 備份
                    try {
                        syncOrdersJsonFromDb();
                        if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
                    } catch (sErr) {}

                    try { await interaction.channel.send({ content: `🎉 **恭喜 <@${talentUser.id}> 接到單！**` }); } catch (e) {}

                    // 4. 推送詳細小卡至陪陪專屬頻道
                    try {
                        const staffChannel = await client.channels.fetch(targetStaffChannelId);
                        if (staffChannel) {
                            const detailEmbed = createMihuEmbed({
                                title: '📋 恭喜獲得派單！詳細訂單資料',
                                color: BRAND_COLORS.BLUE,
                                footerText: '米胡電競 MiHu Gaming · 服務計時卡片'
                            })
                            .addFields(
                                { name: '📌 訂單編號', value: `\`${order.order_no}\``, inline: true },
                                { name: '👤 闆闆 ID', value: `<@${order.boss_id}> (\`${order.boss_id}\`)`, inline: true },
                                { name: '🏷️ 訂單類別', value: `\`${order.category || '陪玩單'}\``, inline: true },
                                { name: '🎮 服務項目', value: `**${order.game}**`, inline: true },
                                { name: '📝 內容規格', value: `\`${order.content_tier || '標準'}\``, inline: true },
                                { name: '⏱️ 服務時長', value: `**${order.duration}${order.unit || '小時'}**`, inline: true },
                                { name: '💰 實收總價', value: `**$${finalAmount.toLocaleString()} NTD**`, inline: true }
                            );

                            // 若有折抵金額則顯示折扣資訊
                            if (discountAmount > 0) {
                                detailEmbed.addFields({ name: '🏷️ 折扣優惠', value: `**${discountText}**`, inline: true });
                            }

                            if (order.extra && order.extra.trim() !== '' && order.extra !== '無') {
                                detailEmbed.addFields({ name: '✨ 附加條件', value: order.extra, inline: false });
                            }

                            if (order.note && order.note.trim() !== '' && order.note !== '無') {
                                detailEmbed.addFields({ name: '💬 備註說明', value: order.note, inline: false });
                            }

                            const timerRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`timer_start_${order.order_no}`).setLabel('▶️ 開始計時').setStyle(ButtonStyle.Success)
                            );

                            await staffChannel.send({
                                content: `🔔 <@${talentUser.id}> 您有全新的服務訂單！請在開始服務時點擊下方計時按鈕：`,
                                embeds: [detailEmbed],
                                components: [timerRow]
                            });
                        }
                    } catch (chErr) {
                        console.error('❌ 推送陪陪專屬頻道訊息失敗:', chErr);
                    }

                    // 5. 回應客服訊息 (包含金額與錢包變動)
                    let replyText = `✅ **指派成功！**\n📌 **訂單編號**：\`${orderNo}\` \n🎧 **指派陪陪**：<@${talentUser.id}>\n💰 **實收總價**：$${finalAmount.toLocaleString()} NTD ${discountText ? `(${discountText})` : ''}`;
                    
                    if (inputPrice !== null || inputDiscount !== null) {
                        replyText += ` *(已手動調整價格/折扣)*`;
                    }

                    replyText += walletNoticeText;
                    replyText += `\n📢 已推送至頻道 <#${targetStaffChannelId}>！`;

                    interaction.editReply({ content: replyText });
                });
            });
        });
    }
};