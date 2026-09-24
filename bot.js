require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const db = require('./database');

// 自動讀取 DISCORD_BOT_TOKEN 或 DISCORD_TOKEN
const botToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// 🚀 1. 定義斜線指令結構
function getSlashCommands() {
    return [
        new SlashCommandBuilder()
            .setName('register')
            .setNameLocalizations({ 'zh-TW': '註冊' })
            .setDescription('玩家於 Discord 自行綁定與註冊米胡電競會員帳號'),

        new SlashCommandBuilder()
            .setName('register-for')
            .setNameLocalizations({ 'zh-TW': '代註冊' })
            .setDescription('管理員或客服協助特定 Discord 用戶強制建立帳號與資料綁定')
            .addUserOption(option => 
                option.setName('target')
                    .setNameLocalizations({ 'zh-TW': '目標成員' })
                    .setDescription('欲協助註冊的 Discord 成員')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('dispatch')
            .setNameLocalizations({ 'zh-TW': '派單' })
            .setDescription('發布工作室派單訊息至指定頻道')
            .addChannelOption(option =>
                option.setName('channel')
                    .setNameLocalizations({ 'zh-TW': '發佈頻道' })
                    .setDescription('派單卡片要發佈的 Discord 頻道')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('category')
                    .setNameLocalizations({ 'zh-TW': '類別' })
                    .setDescription('訂單類別 (派單時隱藏)')
                    .setRequired(true)
                    .addChoices(
                        { name: '陪玩單', value: '陪玩單' },
                        { name: '禮物單', value: '禮物單' },
                        { name: '有獎', value: '有獎' },
                        { name: '冠名', value: '冠名' },
                        { name: '獎金', value: '獎金' }
                    )
            )
            .addStringOption(option =>
                option.setName('game')
                    .setNameLocalizations({ 'zh-TW': '項目' })
                    .setDescription('遊戲或服務項目 (例如: 英雄聯盟, 聊天)')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('content')
                    .setNameLocalizations({ 'zh-TW': '內容' })
                    .setDescription('內容或規格細項 (例如: 娛樂, 排位, 歌單, 純聊天)')
                    .setRequired(true)
            )
            .addNumberOption(option =>
                option.setName('duration')
                    .setNameLocalizations({ 'zh-TW': '時長' })
                    .setDescription('服務時長/數量 (例如: 2)')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('unit')
                    .setNameLocalizations({ 'zh-TW': '單位' })
                    .setDescription('計費單位 (必填)')
                    .setRequired(true)
                    .addChoices(
                        { name: '小時', value: '小時' },
                        { name: '局', value: '局' },
                        { name: '首', value: '首' }
                    )
            )
            .addStringOption(option =>
                option.setName('tag')
                    .setNameLocalizations({ 'zh-TW': 'tag' })
                    .setDescription('欲 Tag 的身分組或成員 (可同時輸入多個，例如: @身分組1 @身分組2)')
                    .setRequired(true)
            )
            .addUserOption(option =>
                option.setName('boss')
                    .setNameLocalizations({ 'zh-TW': '老闆id' })
                    .setDescription('下單老闆 (派單時隱藏)')
                    .setRequired(true)
            )
            .addNumberOption(option =>
                option.setName('total_price')
                    .setNameLocalizations({ 'zh-TW': '總價' })
                    .setDescription('訂單總金額 (派單時隱藏)')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('extra')
                    .setNameLocalizations({ 'zh-TW': '附加' })
                    .setDescription('附加條件或說明 (純文字，無則不填)')
                    .setRequired(false)
            )
            .addNumberOption(option =>
                option.setName('discount')
                    .setNameLocalizations({ 'zh-TW': '折扣' })
                    .setDescription('折扣金額(例如 100) 或 折扣折數(例如 0.9 代表9折)')
                    .setRequired(false)
            )
            .addStringOption(option =>
                option.setName('note')
                    .setNameLocalizations({ 'zh-TW': '備註' })
                    .setDescription('內部或顧客備註說明 (無則不填)')
                    .setRequired(false)
            ),

        // 🚀 新增：/公告 斜線指令 (連動首頁質感公告)
        new SlashCommandBuilder()
            .setName('announcement')
            .setNameLocalizations({ 'zh-TW': '公告' })
            .setDescription('發布工作室即時公告至 Web 後台首頁')
            .addStringOption(option => 
                option.setName('item')
                    .setNameLocalizations({ 'zh-TW': '項目' })
                    .setDescription('公告標籤項目（例如：即時通知、維護公告、活動通知）')
                    .setRequired(true)
            )
            .addStringOption(option => 
                option.setName('content')
                    .setNameLocalizations({ 'zh-TW': '內容' })
                    .setDescription('公告詳細內容')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('reload')
            .setDescription('Hot reload and sync all Discord slash commands instantly')
    ].map(command => command.toJSON());
}

// ⚡ 2. 斜線指令熱重載同步
async function registerSlashCommands() {
    if (!botToken || !process.env.DISCORD_CLIENT_ID) {
        console.warn('⚠️ 尚未配置完整的 DISCORD_BOT_TOKEN 或 DISCORD_CLIENT_ID，跳過斜線指令註冊。');
        return false;
    }

    try {
        const rest = new REST({ version: '10' }).setToken(botToken);
        const commands = getSlashCommands();
        console.log('🔄 開始同步與熱重載 Discord 斜線指令 (Slash Commands)...');

        if (process.env.GUILD_DEV_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.GUILD_DEV_ID),
                { body: commands }
            );
            console.log(`⚡ 已成功即時熱重載指令至測試伺服器 (Guild: ${process.env.GUILD_DEV_ID})！`);
        }

        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands }
        );
        console.log('✅ 全域 Discord 斜線指令同步發佈完成！');
        return true;
    } catch (error) {
        console.error('❌ 註冊/熱重載 Discord 斜線指令時發生錯誤:', error);
        return false;
    }
}

client.once('ready', () => {
    console.log(`🤖 米胡電競 Discord 機器人已成功上線：${client.user.tag}`);
    registerSlashCommands();
});

// 處理互動指令 (Interaction)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user: discordUser } = interaction;

    // ==========================================
    // 0. /reload (熱重載指令)
    // ==========================================
    if (commandName === 'reload') {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (e) {
            return;
        }

        db.get('SELECT role FROM users WHERE id = ?', [discordUser.id], async (permErr, operator) => {
            const isAuthorized = (discordUser.id === "604610298581876746") || (operator && (operator.role === 'admin' || operator.role === 'manager' || operator.role === 'cs' || operator.role === 'cfo'));

            if (!isAuthorized) {
                return interaction.editReply({ content: '🚫 您沒有權限執行斜線指令熱重製。' }).catch(() => {});
            }

            const success = await registerSlashCommands();
            if (success) {
                interaction.editReply({ content: '⚡ **Slash commands reloaded successfully!** 所有最新選項與欄位已即時同步。' }).catch(() => {});
            } else {
                interaction.editReply({ content: '❌ Reload failed, please check server logs.' }).catch(() => {});
            }
        });
        return;
    }

    // ==========================================
    // 🚀 0-1. /公告 (發布即時公告至 Web 首頁)
    // ==========================================
    if (commandName === 'announcement' || commandName === '公告') {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Defer reply 失敗:', e);
            return;
        }

        db.get('SELECT role FROM users WHERE id = ?', [discordUser.id], (permErr, operator) => {
            const isAuthorized = (discordUser.id === "604610298581876746") || (operator && (operator.role === 'admin' || operator.role === 'manager' || operator.role === 'cs' || operator.role === 'cfo' || operator.role === 'aftersales'));

            if (!isAuthorized) {
                return interaction.editReply({ content: '🚫 您沒有發布後台公告的權限。' }).catch(() => {});
            }

            const itemTag = interaction.options.getString('item');
            const contentText = interaction.options.getString('content');
            const formattedTitle = `[${itemTag}]`;

            db.run(
                'INSERT INTO announcements (title, content) VALUES (?, ?)',
                [formattedTitle, contentText],
                function (err) {
                    if (err) {
                        console.error('❌ 發布公告至資料庫失敗:', err);
                        return interaction.editReply({ content: '❌ 公告發布失敗，請檢查資料庫狀態。' }).catch(() => {});
                    }

                    return interaction.editReply({
                        content: `✅ **後台首頁公告已即時發布！**\n📌 **項目標籤：** \`${itemTag}\` \n💬 **公告內容：** ${contentText}`
                    }).catch(() => {});
                }
            );
        });
        return;
    }

    // ==========================================
    // 1. /register (玩家自主註冊)
    // ==========================================
    if (commandName === 'register' || commandName === '註冊') {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Defer reply 失敗:', e);
            return;
        }

        const userId = discordUser.id;
        const username = discordUser.username;
        const globalName = discordUser.globalName || username;
        const avatar = discordUser.avatar || '';

        db.get('SELECT * FROM users WHERE id = ?', [userId], async (err, row) => {
            if (err) {
                console.error('資料庫查詢錯誤:', err);
                return interaction.editReply({ content: '❌ 資料庫查詢發生錯誤，請稍後再試。' }).catch(() => {});
            }

            const sendEmbedResponse = (userRecord) => {
                const vipLevel = Number(userRecord.vip_level || 0);
                const vipDisplay = vipLevel > 0 ? `VIP ${vipLevel}` : '一般會員';
                const totalBalance = Number(userRecord.balance || 0) + Number(userRecord.bonus_balance || 0);
                const avatarUrl = discordUser.displayAvatarURL({ dynamic: true });

                const embed = new EmbedBuilder()
                    .setColor('#9333ea')
                    .setTitle('您已經是米胡電競的會員囉！')
                    .setDescription(`歡迎回來，**${userRecord.custom_nickname || userRecord.global_name || userRecord.username}**！\n\n您可隨時登入後臺檢視個人錢包與檔案：\n👉 [米胡電競管理後臺](${process.env.WEBSITE_URL || 'http://localhost:3000'})`)
                    .addFields(
                        { name: '當前 VIP 等級', value: vipDisplay, inline: true },
                        { name: '總可用金額', value: `$${totalBalance.toLocaleString()} NTD`, inline: true }
                    )
                    .setThumbnail(avatarUrl)
                    .setFooter({ text: '米胡電競 MiHu Gaming · 尊榮服務' });

                return interaction.editReply({ embeds: [embed] }).catch((e) => console.error('發送 Embed 失敗:', e));
            };

            if (!row) {
                db.run(
                    `INSERT INTO users (id, username, global_name, custom_nickname, avatar, role, vip_level) VALUES (?, ?, ?, ?, ?, 'member', 0)`,
                    [userId, username, globalName, globalName, avatar],
                    (insertErr) => {
                        if (insertErr) {
                            console.error('新增會員失敗:', insertErr);
                            return interaction.editReply({ content: '❌ 註冊失敗，請重試或聯繫管理員。' }).catch(() => {});
                        }
                        sendEmbedResponse({
                            id: userId,
                            username,
                            global_name: globalName,
                            custom_nickname: globalName,
                            avatar,
                            role: 'member',
                            vip_level: 0,
                            balance: 0,
                            bonus_balance: 0
                        });
                    }
                );
            } else {
                db.run('UPDATE users SET username = ?, global_name = ?, avatar = ? WHERE id = ?', [username, globalName, avatar, userId]);
                sendEmbedResponse(row);
            }
        });
    }

    // ==========================================
    // 2. /register-for (管理員代註冊)
    // ==========================================
    if (commandName === 'register-for' || commandName === '代註冊') {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Defer reply 失敗:', e);
            return;
        }

        db.get('SELECT role FROM users WHERE id = ?', [discordUser.id], (permErr, operator) => {
            const isAuthorized = (discordUser.id === "604610298581876746") || (operator && (operator.role === 'admin' || operator.role === 'manager' || operator.role === 'cs' || operator.role === 'cfo'));

            if (!isAuthorized) {
                return interaction.editReply({ content: '🚫 您沒有執行代註冊指令的權限。' }).catch(() => {});
            }

            const targetUser = interaction.options.getUser('target');
            if (!targetUser) {
                return interaction.editReply({ content: '❌ 請指定有效的目標成員。' }).catch(() => {});
            }

            const tId = targetUser.id;
            const tUsername = targetUser.username;
            const tGlobalName = targetUser.globalName || tUsername;
            const tAvatar = targetUser.avatar || '';

            db.get('SELECT * FROM users WHERE id = ?', [tId], (err, row) => {
                if (!row) {
                    db.run(
                        `INSERT INTO users (id, username, global_name, custom_nickname, avatar, role, vip_level) VALUES (?, ?, ?, ?, ?, 'member', 0)`,
                        [tId, tUsername, tGlobalName, tGlobalName, tAvatar],
                        (insertErr) => {
                            if (insertErr) return interaction.editReply({ content: '❌ 代註冊失敗。' }).catch(() => {});
                            interaction.editReply({ content: `✅ 已成功為 <@${tId}> 建立米胡電競會員帳號！` }).catch(() => {});
                        }
                    );
                } else {
                    interaction.editReply({ content: `ℹ️ 成員 <@${tId}> 已經是會員，無須重複代註冊。` }).catch(() => {});
                }
            });
        });
    }

    // ==========================================
    // 3. /dispatch (/派單) 🚀 標題改為 ## ✧新單快報✧
    // ==========================================
    if (commandName === 'dispatch' || commandName === '派單') {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Defer reply 失敗:', e);
            return;
        }

        const targetChannel = interaction.options.getChannel('channel');
        const category = interaction.options.getString('category');
        const game = interaction.options.getString('game');
        const contentTier = interaction.options.getString('content');
        const duration = interaction.options.getNumber('duration');
        const unit = interaction.options.getString('unit');
        const tagInput = interaction.options.getString('tag');
        const bossUser = interaction.options.getUser('boss');
        const totalPrice = interaction.options.getNumber('total_price');
        
        // 選填
        const extra = interaction.options.getString('extra') || '';
        const rawDiscount = interaction.options.getNumber('discount');
        const note = interaction.options.getString('note') || '';

        // 解析折扣
        let discountDisplay = '無';
        let discountVal = 0;

        if (rawDiscount !== null && rawDiscount !== undefined && rawDiscount > 0) {
            discountVal = rawDiscount;
            if (rawDiscount > 0 && rawDiscount < 1) {
                const discountRatio = Math.round(rawDiscount * 100) / 10;
                discountDisplay = `${discountRatio} 折`;
            } else {
                discountDisplay = `折抵 $${rawDiscount} NTD`;
            }
        }

        const durationDisplay = `${duration}${unit}`;

        const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        const orderNo = `MH-${dateStr}-${randomNum}`;

        db.run(
            `INSERT OR IGNORE INTO users (id, username, global_name, custom_nickname, avatar, role) VALUES (?, ?, ?, ?, ?, 'member')`,
            [bossUser.id, bossUser.username, bossUser.globalName || bossUser.username, bossUser.globalName || bossUser.username, bossUser.avatar || '']
        );

        // 乾淨派單卡片
        const dispatchEmbed = new EmbedBuilder()
            .setColor('#f59e0b')
            .addFields(
                { name: '訂單編號', value: `\`${orderNo}\``, inline: true },
                { name: '派單客服', value: `<@${discordUser.id}>`, inline: true },
                { name: ' ', value: ' ', inline: false },
                { name: '項目', value: `**${game}**`, inline: true },
                { name: '內容', value: `\`${contentTier}\``, inline: true },
                { name: '時長', value: `**${durationDisplay}**`, inline: true }
            )
            .setFooter({ text: '米胡電競 MiHu Gaming · 派單服務' })
            .setTimestamp();

        if (extra && extra.trim() !== '') {
            dispatchEmbed.addFields({ name: '附加', value: extra, inline: false });
        }
        if (note && note.trim() !== '') {
            dispatchEmbed.addFields({ name: '備註', value: note, inline: false });
        }

        try {
            const sentMessage = await targetChannel.send({
                content: `## ✧新單快報✧\n\n${tagInput}`,
                embeds: [dispatchEmbed]
            });

            const insertSql = `
                INSERT INTO orders (
                    order_no, boss_id, category, game, content_tier, duration, 
                    unit, unit_price, headcount, tag, extra, discount, 
                    note, total_amount, status, channel_id, message_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'pending', ?, ?)
            `;

            db.run(insertSql, [
                orderNo, bossUser.id, category, game, contentTier, duration,
                unit, totalPrice, tagInput, extra, discountVal,
                note, totalPrice, sentMessage.channel.id, sentMessage.id
            ], (dbErr) => {
                if (dbErr) {
                    console.error('訂單寫入資料庫失敗:', dbErr);
                    return interaction.editReply({ content: '⚠️ 派單卡片已發送，但寫入後台資料庫時發生錯誤。' }).catch(() => {});
                }

                interaction.editReply({
                    content: `✅ **派單成功！**\n\n📌 **訂單編號**：\`${orderNo}\`
📢 **發佈頻道**：<#${targetChannel.id}>
🎧 **派單客服**：<@${discordUser.id}>
🔒 **已隱藏欄位**：
- **類別**：${category}
- **老闆**：<@${bossUser.id}> (${bossUser.username})
- **項目**：${game}
- **內容**：${contentTier}
- **時長**：${durationDisplay}
- **總價**：$${totalPrice} NTD
- **折扣**：${discountDisplay}`
                }).catch(() => {});
            });

        } catch (sendErr) {
            console.error('發送派單卡片至頻道失敗:', sendErr);
            interaction.editReply({ content: `❌ 無法發送訊息至頻道 <#${targetChannel.id}>，請檢查機器人頻道發言權限。` }).catch(() => {});
        }
    }
});

// 啟動與登入 Bot
if (botToken) {
    client.login(botToken);
} else {
    console.error('❌ 尚未在 .env 中填寫 DISCORD_BOT_TOKEN 或 DISCORD_TOKEN！');
}

module.exports = { client, registerSlashCommands };