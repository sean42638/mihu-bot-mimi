require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { getConfiguredGuilds, getMissingGuildVariables } = require('./config/discordCommandPolicy');

const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
    console.error('❌ 錯誤：請確認 .env 中已正確配置 DISCORD_BOT_TOKEN (或 DISCORD_TOKEN) 與 DISCORD_CLIENT_ID！');
    process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function clearAllCommands() {
    console.log('==========================================');
    console.log('🧹 開始徹底清除米胡電競機器人所有舊指令...');
    console.log('==========================================');

    try {
        // 1. 清除全域斜線指令 (Global Commands)
        console.log('🌍 [1/2] 正在清除所有全域指令 (Global Commands)...');
        await rest.put(
            Routes.applicationCommands(clientId),
            { body: [] }
        );
        console.log('✅ 全域斜線指令已清空！');

        const missingVariables = getMissingGuildVariables();
        if (missingVariables.length > 0) {
            throw new Error(`Missing Discord Guild configuration: ${missingVariables.join(', ')}`);
        }

        const guilds = getConfiguredGuilds();
        for (const [guildKey, guildId] of Object.entries(guilds)) {
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: [] }
            );
            console.log(`✅ 已清除 ${guildKey} Guild 的伺服器指令。`);
        }

        console.log('🎉 已清除 Global 與四個設定 Guild 的舊指令。');

    } catch (error) {
        console.error('❌ 清除指令時發生錯誤：', error);
        process.exit(1);
    }
}

clearAllCommands();