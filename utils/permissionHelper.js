const { PermissionsBitField } = require('discord.js');

/**
 * 🚀 檢查機器人在目標頻道是否有必要的發言與 Embed 權限
 * @param {import('discord.js').GuildChannel} channel - 目標頻道物件
 * @param {import('discord.js').Client} client - Discord Client
 * @returns {{ hasAccess: boolean, missingPerms: string[], errorMsg: string }}
 */
function checkChannelPermissions(channel, client) {
    if (!channel) {
        return {
            hasAccess: false,
            missingPerms: ['Channel_Not_Found'],
            errorMsg: '❌ 找不到目標發布頻道，請確認頻道是否存在。'
        };
    }

    const botMember = channel.guild.members.me;
    const permissions = channel.permissionsFor(botMember);

    if (!permissions) {
        return {
            hasAccess: false,
            missingPerms: ['ViewChannel'],
            errorMsg: `❌ **Missing Access (50001)**：機器人無法讀取 <#${channel.id}> 頻道設定，請確認頻道權限中有放行機器人身分組！`
        };
    }

    const requiredPermissions = [
        { flag: PermissionsBitField.Flags.ViewChannel, name: '檢視頻道 (View Channel)' },
        { flag: PermissionsBitField.Flags.SendMessages, name: '發送訊息 (Send Messages)' },
        { flag: PermissionsBitField.Flags.EmbedLinks, name: '嵌入連結 (Embed Links)' }
    ];

    const missingPerms = [];

    for (const perm of requiredPermissions) {
        if (!permissions.has(perm.flag)) {
            missingPerms.push(perm.name);
        }
    }

    if (missingPerms.length > 0) {
        return {
            hasAccess: false,
            missingPerms,
            errorMsg: `❌ ** Missing Access**：機器人在 <#${channel.id}> 缺少以下權限：\n` +
                      missingPerms.map(p => `• \`${p}\``).join('\n') +
                      '\n請至頻道設定將機器人身分組拉入並開啟上述權限！'
        };
    }

    return {
        hasAccess: true,
        missingPerms: [],
        errorMsg: ''
    };
}

// 🎯 關鍵：必須匯出包含 checkChannelPermissions 的物件
module.exports = {
    checkChannelPermissions
};