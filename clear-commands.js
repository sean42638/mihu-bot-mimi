require('dotenv').config();
const { REST, Routes, Client, GatewayIntentBits } = require('discord.js');

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

        // 2. 連線客戶端遍歷清除所有加入伺服器的伺服器指令 (Guild Commands)
        console.log('📡 [2/2] 正在檢查並清除所有伺服器內部指令 (Guild Commands)...');
        
        // 若 .env 有明確指定 GUILD_ID 則優先清理
        const envGuildId = process.env.DISCORD_GUILD_ID;
        if (envGuildId) {
            console.log(`🎯 正在清除指定伺服器 [${envGuildId}] 指令...`);
            await rest.put(
                Routes.applicationGuildCommands(clientId, envGuildId),
                { body: [] }
            );
            console.log(`✅ 伺服器 [${envGuildId}] 指令已清除！`);
        }

        // 啟動輕量 Client 遍歷清除機器人所在的所有伺服器指令
        const tempClient = new Client({
            intents: [GatewayIntentBits.Guilds]
        });

        tempClient.once('ready', async () => {
            const guilds = await tempClient.guilds.fetch();
            console.log(`🔍 偵測到機器人目前加入了 ${guilds.size} 個伺服器，正在逐一清空伺服器專屬指令...`);

            for (const [guildId, oauthGuild] of guilds) {
                try {
                    await rest.put(
                        Routes.applicationGuildCommands(clientId, guildId),
                        { body: [] }
                    );
                    console.log(`   └─ 已清除伺服器：${oauthGuild.name} (${guildId})`);
                } catch (err) {
                    console.warn(`   └─ 清除伺服器 ${oauthGuild.name} 失敗:`, err.message);
                }
            }

            console.log('==========================================');
            console.log('🎉 所有全域與伺服器舊指令已全數徹底清除完畢！');
            console.log('💡 提示：若 Discord 介面仍殘留舊指令，請在 Discord 按 Ctrl + R 重新載入快取。');
            console.log('==========================================');

            tempClient.destroy();
            process.exit(0);
        });

        await tempClient.login(token);

    } catch (error) {
        console.error('❌ 清除指令時發生錯誤：', error);
        process.exit(1);
    }
}

clearAllCommands();