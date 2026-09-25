const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

function checkDiscordAdminPermission(member, userId) {
    if (userId === "604610298581876746") return true;
    return member && member.permissions && member.permissions.has(PermissionFlagsBits.Administrator);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription('Hot reload and sync all Discord slash commands instantly'),
    async execute(interaction, client, registerSlashCommands) {
        try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch (e) { return; }
        if (!checkDiscordAdminPermission(interaction.member, interaction.user.id)) {
            return interaction.editReply({ content: '🚫 您沒有執行斜線指令熱重製的 Discord 管理權限。' });
        }
        const success = await registerSlashCommands();
        if (success) {
            interaction.editReply({ content: '⚡ **Slash commands reloaded successfully!**' });
        } else {
            interaction.editReply({ content: '❌ Reload failed, please check server logs.' });
        }
    }
};