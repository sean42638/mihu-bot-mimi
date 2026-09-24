const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { syncOrdersJsonFromDb } = require('../utils/dataSync');

function checkDiscordAdminPermission(member, userId) {
    if (userId === "604610298581876746") return true;
    return member && member.permissions && member.permissions.has(PermissionFlagsBits.Administrator);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('abandon_order')
        .setNameLocalizations({ 'zh-TW': '棄單' })
        .setDescription('暫棄現有訂單，於原頻道通知陪陪並直接自後台刪除紀錄')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName('order_no').setNameLocalizations({ 'zh-TW': '訂單編號' }).setDescription('欲放棄的訂單編號').setRequired(true)),
    async execute(interaction, client) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: 64 });
            }
        } catch (e) {}

        if (!checkDiscordAdminPermission(interaction.member, interaction.user.id)) {
            return interaction.editReply({ content: '🚫 只有 Discord 客服與管理者身分能使用棄單指令。' });
        }

        const orderNo = interaction.options.getString('order_no').trim();

        // 1. 查詢訂單資料以取得原發佈頻道
        db.get('SELECT * FROM orders WHERE order_no = ?', [orderNo], async (err, order) => {
            if (err || !order) return interaction.editReply({ content: `❌ 找不到編號為 \`${orderNo}\` 的訂單！` });

            const targetChannelId = order.channel_id || interaction.channelId;

            // 2. 於原派單頻道發布棄單通知 (不顯示單號)
            try {
                const targetChannel = await client.channels.fetch(targetChannelId);
                if (targetChannel) {
                    await targetChannel.send({ content: '辛苦各位陪陪 本單暫棄' });
                }
            } catch (chErr) {
                console.error('❌ 推送原頻道棄單訊息失敗:', chErr);
            }

            // 3. 後台 SQLite 資料庫直接刪除該筆訂單
            db.run('DELETE FROM orders WHERE order_no = ?', [orderNo], (delErr) => {
                if (delErr) {
                    return interaction.editReply({ content: `⚠️ 已於頻道發布通知，但後台資料庫刪除失敗：${delErr.message}` });
                }

                // 4. 觸發 orders.json 異動同步，保持後台資料庫與 JSON 乾淨
                syncOrdersJsonFromDb();

                interaction.editReply({ content: `✅ **訂單 \`${orderNo}\` 已成功棄單並自後台資料庫完全清除！**` });
            });
        });
    }
};