require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

const commands = [
    // ==========================================
    // 大群 - 所有人可用
    // ==========================================
    new SlashCommandBuilder()
        .setName('註冊')
        .setDescription('連動後台 成為米胡電競會員'),

    new SlashCommandBuilder()
        .setName('我的錢包')
        .setDescription('查看個人錢包餘額及 VIP 等級'),

    // ==========================================
    // 大群 - 客服 / 管理專用
    // ==========================================
    new SlashCommandBuilder()
        .setName('公告')
        .setDescription('【管理專用】發布即時公告並連動後台浮動列')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(opt => opt.setName('項目').setDescription('公告項目/類別（例如：維護、活動、重要）').setRequired(true))
        .addStringOption(opt => opt.setName('內容').setDescription('公告內容').setRequired(true)),

    new SlashCommandBuilder()
        .setName('代為註冊')
        .setDescription('【客服專用】幫闆闆註冊成為會員')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(opt => opt.setName('目標用戶').setDescription('要註冊的闆闆').setRequired(true)),

    new SlashCommandBuilder()
        .setName('加值')
        .setDescription('【客服專用】為闆闆加值點數')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(opt => opt.setName('目標用戶').setDescription('加值的用戶').setRequired(true))
        .addNumberOption(opt => opt.setName('實充金額').setDescription('實際支付金額').setRequired(true))
        .addNumberOption(opt => opt.setName('贈送金額').setDescription('額外贈送金額').setRequired(true))
        .addStringOption(opt => opt.setName('管道').setDescription('支付管道').setRequired(true))
        .addStringOption(opt => opt.setName('備註').setDescription('備註事項 (選填)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('派單')
        .setDescription('【客服專用】發布公開派單（敏感資料將自動隱藏）')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addChannelOption(opt => opt.setName('發布頻道').setDescription('發布派單的公開頻道').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addStringOption(opt => opt.setName('項目').setDescription('遊戲或服務項目').setRequired(true))
        .addNumberOption(opt => opt.setName('時間').setDescription('時長（小時或局數）').setRequired(true))
        .addIntegerOption(opt => opt.setName('人數').setDescription('需求陪玩師人數').setRequired(true))
        .addRoleOption(opt => opt.setName('tag').setDescription('Tag 身分組').setRequired(true))
        .addUserOption(opt => opt.setName('老闆id').setDescription('點單的老闆 (派單時公開大廳隱藏)').setRequired(true))
        .addNumberOption(opt => opt.setName('單價').setDescription('單價 (派單時公開大廳隱藏)').setRequired(true))
        .addStringOption(opt => opt.setName('附加').setDescription('例如：甜蜜單 (選填)').setRequired(false))
        .addNumberOption(opt => opt.setName('折扣').setDescription('折扣 (派單時隱藏，選填)').setRequired(false))
        .addStringOption(opt => opt.setName('備註').setDescription('其他備註 (選填)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('選人')
        .setDescription('【客服專用】選定接單陪陪並推送工單')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(opt => opt.setName('訂單編號').setDescription('訂單編號').setRequired(true))
        .addUserOption(opt => opt.setName('陪陪').setDescription('選定的陪玩師').setRequired(true)),

    new SlashCommandBuilder()
        .setName('後台')
        .setDescription('【客服專用】取得後臺管理系統網址')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    new SlashCommandBuilder()
        .setName('好評')
        .setDescription('【客服專用】發布闆闆評價')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addChannelOption(opt => opt.setName('發布頻道').setDescription('發布好評的頻道').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addUserOption(opt => opt.setName('闆闆').setDescription('評論的闆闆').setRequired(true))
        .addUserOption(opt => opt.setName('陪陪').setDescription('受評的陪玩師').setRequired(true))
        .addIntegerOption(opt => opt.setName('評分').setDescription('1 到 5 星評分').setRequired(true))
        .addStringOption(opt => opt.setName('留言').setDescription('好評回饋內容').setRequired(true))
        .addStringOption(opt => opt.setName('單號').setDescription('對應訂單編號').setRequired(true))
        .addBooleanOption(opt => opt.setName('匿名').setDescription('是否匿名').setRequired(false)),

    new SlashCommandBuilder()
        .setName('指定陪玩')
        .setDescription('【客服專用】建立指定單並發送計時工單')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(opt => opt.setName('闆闆').setDescription('委託闆闆').setRequired(true))
        .addUserOption(opt => opt.setName('陪玩師').setDescription('指定的陪玩師').setRequired(true))
        .addStringOption(opt => opt.setName('服務項目').setDescription('遊戲或項目').setRequired(true))
        .addNumberOption(opt => opt.setName('時長小時').setDescription('時長或局數').setRequired(true))
        .addNumberOption(opt => opt.setName('總金額').setDescription('總委託金額').setRequired(true)),

    new SlashCommandBuilder()
        .setName('查帳')
        .setDescription('【客服專用】查詢目標用戶的餘額與儲值紀錄')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(opt => opt.setName('目標用戶').setDescription('要查詢的用戶').setRequired(true)),

    new SlashCommandBuilder()
        .setName('棄單')
        .setDescription('【客服專用】取消訂單並發布通知')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addStringOption(opt => opt.setName('單號').setDescription('要取消的訂單單號').setRequired(true))
        .addChannelOption(opt => opt.setName('通知頻道').setDescription('發布棄單通知的頻道').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addStringOption(opt => opt.setName('原因').setDescription('棄單原因 (選填)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('【管理店長專用】檢測機器人延遲')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('綁定')
        .setDescription('【員工專用】將當前頻道綁定為我的個人專屬工單頻道'),

    new SlashCommandBuilder()
        .setName('代為綁定')
        .setDescription('【客服專用】代為將當前頻道綁定為目標陪陪的專屬工單頻道')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addUserOption(opt => opt.setName('目標用戶').setDescription('要綁定的陪玩師').setRequired(true))
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
    try {
        console.log('🔄 正在同步註冊指令...');
        const targetGuildId = process.env.GUILD_DEV_ID || process.env.GUILD_MAIN_ID;
        await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, targetGuildId),
            { body: commands }
        );
        console.log(`✅ 指令同步完成！目標伺服器 ID: ${targetGuildId}`);
    } catch (error) {
        console.error('❌ 指令註冊失敗:', error);
    }
})();