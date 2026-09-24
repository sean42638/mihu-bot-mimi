const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { createMihuEmbed, BRAND_COLORS } = require('../utils/embedBuilder');
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
        .addUserOption(o => o.setName('talent').setNameLocalizations({ 'zh-TW': '陪陪' }).setDescription('獲選接單的陪玩師').setRequired(true)),
    async execute(interaction, client) {
        try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch (e) { return; }
        if (!checkDiscordAdminPermission(interaction.member, interaction.user.id)) {
            return interaction.editReply({ content: '🚫 只有 Discord 客服與管理者身分能使用此指令。' });
        }

        const orderNo = interaction.options.getString('order_no').trim();
        const talentUser = interaction.options.getUser('talent');

        db.get('SELECT * FROM orders WHERE order_no = ?', [orderNo], (err, order) => {
            if (err || !order) return interaction.editReply({ content: `❌ 找不到編號為 \`${orderNo}\` 的訂單！` });

            db.get('SELECT * FROM talents WHERE user_id = ?', [talentUser.id], async (tErr, talentRow) => {
                if (!talentRow || !talentRow.staff_channel_id) {
                    return interaction.editReply({ content: `⚠️ **指派失敗！** 陪陪 <@${talentUser.id}> 尚未綁定專屬頻道。` });
                }

                const targetStaffChannelId = talentRow.staff_channel_id;
                db.run('UPDATE orders SET talent_id = ?, status = "accepted" WHERE order_no = ?', [talentUser.id, orderNo], async (upErr) => {
                    if (upErr) return interaction.editReply({ content: '❌ 更新訂單指派資料失敗。' });
                    syncOrdersJsonFromDb();

                    try { await interaction.channel.send({ content: `🎉 **恭喜 <@${talentUser.id}> 接到單！**` }); } catch (e) {}

                    try {
                        const staffChannel = await client.channels.fetch(targetStaffChannelId);
                        if (staffChannel) {
                            // 🚀 使用模板建立美觀藍色小卡
                            const detailEmbed = createMihuEmbed({
                                title: '📋 恭喜您獲得派單派派！詳細訂單資料',
                                color: BRAND_COLORS.BLUE,
                                footerText: '米胡電競 MiHu Gaming · 服務計時卡片'
                            })
                            .addFields(
                                { name: '訂單編號', value: `\`${order.order_no}\``, inline: true },
                                { name: '訂單類別', value: `\`${order.category || '陪玩單'}\``, inline: true },
                                { name: '服務項目', value: `**${order.game}**`, inline: true },
                                { name: '內容規格', value: `\`${order.content_tier || '標準'}\``, inline: true },
                                { name: '服務時長', value: `**${order.duration}${order.unit || '小時'}**`, inline: true },
                                { name: '總計金額', value: `**$${order.total_amount} NTD**`, inline: true }
                            );

                            if (order.extra) detailEmbed.addFields({ name: '附加條件', value: order.extra, inline: false });
                            if (order.note) detailEmbed.addFields({ name: '顧客備註', value: order.note, inline: false });

                            const timerRow = new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId(`timer_start_${order.order_no}`).setLabel('▶️ 開始計時').setStyle(ButtonStyle.Success)
                            );

                            await staffChannel.send({
                                content: `🔔 <@${talentUser.id}> 您有全新的服務訂單！請在開始服務時點擊下方計時按鈕：`,
                                embeds: [detailEmbed],
                                components: [timerRow]
                            });
                        }
                    } catch (chErr) {}

                    interaction.editReply({ content: `✅ **指派成功！**\n📌 **訂單編號**：\`${orderNo}\` \n🎧 **指派陪陪**：<@${talentUser.id}>\n📢 已推送至頻道 <#${targetStaffChannelId}>！` });
                });
            });
        });
    }
};