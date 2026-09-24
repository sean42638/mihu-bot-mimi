require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, Collection, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./database'); // 🚀 引入資料庫供 Modal 提交更新使用
const { syncOrdersJsonFromDb } = require('./utils/dataSync');

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

    // 2. 處理 Modal 彈窗提交事件
    if (interaction.isModalSubmit()) {
        try {
            // 🚀 A. 處理 /派單 Modal 提交 (modal_disp_)
            if (interaction.customId.startsWith('modal_disp_')) {
                await handleDispatchModal(interaction);
                return;
            }

            // 🚀 B. 新增：處理【結束計時 · 留給闆闆的話】Modal 提交 (modal_talent_msg_)
            if (interaction.customId.startsWith('modal_talent_msg_')) {
                const orderNo = interaction.customId.replace('modal_talent_msg_', '');
                const talentMsg = interaction.fields.getTextInputValue('talent_message_input') || '尚無留言';
                const endTimeStr = new Date().toISOString();

                // 立即先 Defer，防止 3 秒逾時 10062 錯誤
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply({ flags: 64 });
                }

                // 寫入資料庫: 更新訂單狀態為已完成、結束時間與陪陪留言
                db.run(
                    'UPDATE orders SET status = "completed", end_time = ?, talent_message = ? WHERE order_no = ?',
                    [endTimeStr, talentMsg, orderNo],
                    async (upErr) => {
                        if (upErr) {
                            console.error('❌ 結束計時更新訂單失敗:', upErr);
                            return interaction.editReply({ content: '❌ 結束計時失敗，請稍後再試！' }).catch(() => {});
                        }

                        // 同步 JSON 檔
                        syncOrdersJsonFromDb();

                        // 嘗試更新原本原頻道的 Embed 訊息卡片（若存在）
                        if (interaction.message) {
                            try {
                                const oldEmbed = interaction.message.embeds[0];
                                if (oldEmbed) {
                                    const updatedEmbed = EmbedBuilder.from(oldEmbed)
                                        .setColor('#10b981')
                                        .addFields(
                                            { name: '⏱️ 結束計時時間', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
                                            { name: '💌 陪陪留給闆闆的話', value: talentMsg, inline: false }
                                        );

                                    await interaction.message.edit({
                                        content: `🏁 **訂單 \`${orderNo}\` 已結束服務！訂單狀態更新為：已完成**`,
                                        embeds: [updatedEmbed],
                                        components: [] // 移除控制按鈕
                                    }).catch(() => {});
                                }
                            } catch (e) {
                                console.warn('⚠️ 更新原始計時卡片訊息失敗 (可忽略):', e.message);
                            }
                        }

                        // 回覆給陪陪僅自己可見的送出成功通知
                        await interaction.editReply({
                            content: `✅ **訂單 \`${orderNo}\` 已成功結束計時並標記為已完成！**\n💌 **留言備註**：${talentMsg}`
                        }).catch(() => {});
                    }
                );
                return;
            }

        } catch (mErr) {
            console.error('❌ 處理 Modal 彈窗發生錯誤:', mErr);
            if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ content: '⚠️ 處理提交時發生錯誤：' + mErr.message }).catch(() => {});
            }
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