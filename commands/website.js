const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createMihuEmbed, BRAND_COLORS } = require('../utils/embedBuilder');

function checkDiscordAdminPermission(member, userId) {
    if (userId === "604610298581876746") return true;
    return member && member.permissions && member.permissions.has(PermissionFlagsBits.Administrator);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('website')
        .setNameLocalizations({ 'zh-TW': '網站' })
        .setDescription('獲取米胡電競 MiHu Gaming 後台管理系統網址')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: 64 }); // 僅本人可見 (Ephemeral)
            }
        } catch (e) {}

        if (!checkDiscordAdminPermission(interaction.member, interaction.user.id)) {
            return interaction.editReply({ content: '🚫 只有 Discord 客服與管理者身分能獲取後台網址。' });
        }

        // 後台系統網址 (預設為本機網址，可依實際域名調整)
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

        const websiteEmbed = createMihuEmbed({
            title: '🌐 米胡電競 MiHu Gaming · 後台管理系統',
            color: BRAND_COLORS.PURPLE,
            footerText: '米胡電競 MiHu Gaming · 後端權限控制網域'
        })
        .setDescription('點擊下方連結跳轉至後台管理系統控制台：')
        .addFields(
            { name: '🔗 後台控制台總覽', value: `[點我進入後台首頁](${baseUrl}/dashboard)`, inline: false },
            { name: '📋 訂單管理系統', value: `[進入訂單列表](${baseUrl}/management/orders)`, inline: true },
            { name: '👥 員工與陪陪管理', value: `[進入員工列表](${baseUrl}/management/staff)`, inline: true },
            { name: '💰 帳務與會員中心', value: `[進入會員清單](${baseUrl}/management/members)`, inline: true }
        );

        interaction.editReply({ embeds: [websiteEmbed] });
    }
};