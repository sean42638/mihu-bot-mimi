const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../database');

function checkDiscordAdminPermission(interaction) {
    return Boolean(interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.Administrator));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announcement')
        .setNameLocalizations({ 'zh-TW': '公告' })
        .setDescription('發布工作室即時公告至 Web 後台首頁')
        .addStringOption(option => option.setName('item').setNameLocalizations({ 'zh-TW': '項目' }).setDescription('公告標籤項目').setRequired(true))
        .addStringOption(option => option.setName('content').setNameLocalizations({ 'zh-TW': '內容' }).setDescription('公告詳細內容').setRequired(true)),
    async execute(interaction) {
        try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch (e) { return; }
        if (!checkDiscordAdminPermission(interaction)) {
            return interaction.editReply({ content: '🚫 您沒有發布後台公告的權限。' });
        }
        const itemTag = interaction.options.getString('item');
        const contentText = interaction.options.getString('content');
        const formattedTitle = `[${itemTag}]`;

        db.run('INSERT INTO announcements (title, content) VALUES (?, ?)', [formattedTitle, contentText], (err) => {
            if (err) return interaction.editReply({ content: '❌ 公告發布失敗，請檢查資料庫狀態。' });
            interaction.editReply({ content: `✅ **後台首頁公告已即時發布！**\n📌 **項目標籤：** \`${itemTag}\` \n💬 **公告內容：** ${contentText}` });
        });
    }
};