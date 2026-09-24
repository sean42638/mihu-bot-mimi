require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const handleButtonInteraction = require('./handlers/buttonHandler');

const botToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// 📂 動態加載 commands/ 資料夾下的所有指令模組
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

// ⚡ 熱重載與註冊全域斜線指令
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

// 🔀 全局事件分發 (Distributor)
client.on('interactionCreate', async (interaction) => {
    // 1. 優先交給按鈕 Handler 處理計時按鈕
    if (interaction.isButton()) {
        const handled = await handleButtonInteraction(interaction);
        if (handled) return;
    }

    // 2. 指令事件調度
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