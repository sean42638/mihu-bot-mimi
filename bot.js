require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// 🚀 載入獨立模組 Handlers
const handleButtonInteraction = require('./handlers/buttonHandler');
const { handleDispatchModal } = require('./handlers/dispatchModalHandler'); // A. 派單
const { handleTalentMsgModal } = require('./handlers/talentMsgModalHandler'); // B. 結束計時
const { handleTopupModal } = require('./handlers/topupModalHandler');       // C. 充值
const { handleReviewModal } = require('./handlers/reviewModalHandler');       // D. 好評
const { handleAssignModal } = require('./handlers/assignModalHandler');       // E. 指定陪玩
const { handleCreateOrderModal } = require('./handlers/createOrderModalHandler'); // F. 建立訂單

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
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '⚠️ 處理按鈕時發生錯誤：' + bErr.message, flags: 64 }).catch(() => {});
            }
        }
        return;
    }

    // 2. 處理 Modal 彈窗提交事件 (完美六大分發)
    if (interaction.isModalSubmit()) {
        try {
            // A. /派單 Modal (修正前綴為 modal_dispatch_)
            if (interaction.customId.startsWith('modal_dispatch_') || interaction.customId.startsWith('modal_disp_')) {
                return await handleDispatchModal(interaction);
            }

            // B. 結束計時 Modal (modal_talent_msg_)
            if (interaction.customId.startsWith('modal_talent_msg_')) {
                return await handleTalentMsgModal(interaction);
            }

            // C. /充值 Modal (topup_modal_)
            if (interaction.customId.startsWith('topup_modal_')) {
                return await handleTopupModal(interaction);
            }

            // D. /好評 Modal (modal_review_)
            if (interaction.customId.startsWith('modal_review_')) {
                return await handleReviewModal(interaction);
            }

            // E. /指定陪玩 Modal (modal_assign_)
            if (interaction.customId.startsWith('modal_assign_')) {
                return await handleAssignModal(interaction);
            }

            // F. /建立訂單 Modal (modal_create_order_)
            if (interaction.customId.startsWith('modal_create_order_')) {
                return await handleCreateOrderModal(interaction);
            }

        } catch (mErr) {
            console.error('❌ 處理 Modal 彈窗發生錯誤:', mErr);
            if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ content: '⚠️ 處理提交時發生錯誤：' + mErr.message }).catch(() => {});
            }
        }
        return;
    }

    // 3. 處理斜線指令事件 (分發至 commands/*.js)
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction, client, registerSlashCommands);
    } catch (error) {
        console.error(`❌ 執行指令 ${interaction.commandName} 發生錯誤:`, error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '⚠️ 執行指令時發生錯誤！', flags: 64 }).catch(() => {});
        }
    }
});

// 🛡️ 全域 Unhandled Error 防崩潰護盾
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [捕獲未處理的 Rejection]:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('💥 [捕獲未處置的 Exception]:', err);
});

client.on('error', (error) => {
    console.error('❌ [Discord Client 錯誤]:', error);
});

if (botToken) client.login(botToken);

module.exports = { client, registerSlashCommands };