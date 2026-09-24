const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { createMihuEmbed, BRAND_COLORS } = require('../utils/embedBuilder');
const { calculateDiscount } = require('../utils/discountHelper');
const { syncOrdersJsonFromDb } = require('../utils/dataSync');

function checkDiscordAdminPermission(member, userId) {
    if (userId === "604610298581876746") return true;
    return member && member.permissions && member.permissions.has(PermissionFlagsBits.Administrator);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('select')
        .setNameLocalizations({ 'zh-TW': '選人' })
        .setDescription('客服指派陪陪接單並推送詳細訂單卡片至陪陪專屬頻道')
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

                // 🚀 使用最終確定的原價與折扣重新演算
                const { finalAmount, discountAmount, discountText } = calculateDiscount(effectiveRawPrice, effectiveRawDiscount);

                // 更新資料庫 (包含 unit_price 原價、discount 折抵值、total_amount 實收金額)
                const updateSql = `
                    UPDATE orders SET 
                        talent_id = ?, 
                        unit_price = ?, 
                        discount = ?, 
                        total_amount = ?, 
                        status = "accepted" 
                    WHERE order_no = ?
                `;

                db.run(updateSql, [talentUser.id, effectiveRawPrice, discountAmount, finalAmount, orderNo], async (upErr) => {
                    if (upErr) return interaction.editReply({ content: '❌ 更新訂單指派資料失敗。' });
                    
                    syncOrdersJsonFromDb();

                    try { await interaction.channel.send({ content: `🎉 **恭喜 <@${talentUser.id}> 接到單！**` }); } catch (e) {}

                    // 推送詳細小卡至陪陪頻道
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

                    let replyText = `✅ **指派成功！**\n📌 **訂單編號**：\`${orderNo}\` \n🎧 **指派陪陪**：<@${talentUser.id}>\n💰 **實收總價**：$${finalAmount.toLocaleString()} NTD ${discountText ? `(${discountText})` : ''}`;
                    
                    if (inputPrice !== null || inputDiscount !== null) {
                        replyText += ` *(已調整價格/折扣)*`;
                    }
                    replyText += `\n📢 已推送至頻道 <#${targetStaffChannelId}>！`;

                    interaction.editReply({ content: replyText });
                });
            });
        });
    }
};