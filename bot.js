require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// 🚀 載入按鈕與彈窗模組化處理常式
const handleButtonInteraction = require('./handlers/buttonHandler');
// ✅ 修改為新的檔名與函數名稱匯入
const { handleDispatchModal } = require('./handlers/dispatchModalHandler');

const botToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    }
}

async function registerSlashCommands() {
    if (!botToken || !process.env.DISCORD_CLIENT_ID) return false;
    try {
        const rest = new REST({ version: '10' }).setToken(botToken);
        const commandDataList = client.commands.map(cmd => cmd.data.toJSON());

        if (process.env.GUILD_DEV_ID) {
            await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.GUILD_DEV_ID), { body: commandDataList });
        }
        await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commandDataList });
        console.log('✅ [Command Handler] 全域 Discord 斜線指令已成功動態同步！');
        return true;
    } catch (error) {
        console.error('❌ 斜線指令熱重載失敗:', error);
        return false;
    }
}

client.once('ready', () => {
    console.log(`🤖 米胡電競 Discord 機器人全新重構上線：${client.user.tag}`);
    registerSlashCommands();
});

// 🚀 全局事件極致分發器
client.on('interactionCreate', async (interaction) => {
    // 1. 處理按鈕點擊事件 (分發至 handlers/buttonHandler.js)
    if (interaction.isButton()) {
        try {
            const handled = await handleButtonInteraction(interaction);
            if (handled) return;
        } catch (bErr) {
            console.error('❌ 處理按鈕互動發生錯誤:', bErr);
        }
    }

    // 2. 處理 Modal 彈窗提交事件 (分發至 handlers/dispatchModalHandler.js)
    if (interaction.isModalSubmit()) {
        try {
            // 🚀 修正：對應上方匯入的 handleDispatchModal，並針對派單 CustomID 進行匹配
            if (interaction.customId.startsWith('modal_disp_')) {
                await handleDispatchModal(interaction);
                return;
            }
        } catch (mErr) {
            console.error('❌ 處理 Modal 彈窗發生錯誤:', mErr);
        }
    }

    // 3. 處理斜線指令事件 (分發至 commands/*.js)
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction, client, registerSlashCommands);
    } catch (error) {
        console.error(`❌ 執行指令 ${interaction.commandName} 發生錯誤:`, error);
    }
});

if (botToken) client.login(botToken);

module.exports = { client, registerSlashCommands };