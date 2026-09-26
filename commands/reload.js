const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { GUILD_LABELS } = require('../config/discordCommandPolicy');

function checkDiscordAdminPermission(interaction) {
    return Boolean(interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.Administrator));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription('Hot reload and sync all Discord slash commands instantly'),
    async execute(interaction, client, registerSlashCommands) {
        try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch (e) { return; }
        if (!checkDiscordAdminPermission(interaction)) {
            return interaction.editReply({ content: '🚫 您沒有執行斜線指令熱重製的 Discord 管理權限。' });
        }
        const success = await registerSlashCommands();
        if (success) {
            interaction.editReply({ content: '⚡ **Slash commands reloaded successfully!**' });
        } else if (client.commandRegistration?.status === 'partial') {
            const failures = (client.commandRegistration.failedGuilds || [])
                .map(failure => `${GUILD_LABELS[failure.guildKey] || failure.guildKey}: Discord ${failure.errorCode || 'error'}`)
                .join('\n');
            interaction.editReply({ content: `⚠️ 部分 Guild 同步完成，其餘失敗：\n${failures || '請查看伺服器記錄。'}\n其他已成功 Guild 的指令仍可使用。` });
        } else {
            interaction.editReply({ content: `❌ Reload failed: ${client.commandRegistration?.error || 'please check server logs.'}` });
        }
    }
};