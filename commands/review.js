const { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('review')
        .setNameLocalizations({ 'zh-TW': '好評', 'zh-CN': '好評' })
        .setDescription('🌟 [管理員專用] 發布闆闆給予陪陪的好評卡片')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        // 1. 發布頻道 (必填)
        .addChannelOption(option =>
            option.setName('channel')
                .setNameLocalizations({ 'zh-TW': '頻道', 'zh-CN': '频道' })
                .setDescription('選擇要發布好評的頻道')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true))
        // 2. 闆闆 (必填)
        .addUserOption(option =>
            option.setName('boss')
                .setNameLocalizations({ 'zh-TW': '闆闆', 'zh-CN': '老板' })
                .setDescription('選擇點單的闆闆')
                .setRequired(true))
        // 3. 陪陪 (自行填入文字，必填)
        .addStringOption(option =>
            option.setName('talent')
                .setNameLocalizations({ 'zh-TW': '陪陪', 'zh-CN': '陪陪' })
                .setDescription('自行填入陪陪 (多位可輸入例如: @陪陪A @陪陪B 或 暱稱)')
                .setRequired(true))
        // 4. 評分 (1-5星，必填)
        .addIntegerOption(option =>
            option.setName('rating')
                .setNameLocalizations({ 'zh-TW': '評分', 'zh-CN': '评分' })
                .setDescription('選擇評分星級 (1 ~ 5 星)')
                .setMinValue(1)
                .setMaxValue(5)
                .setRequired(true))
        // 5. 匿名 (選填)
        .addBooleanOption(option =>
            option.setName('anonymous')
                .setNameLocalizations({ 'zh-TW': '匿名', 'zh-CN': '匿名' })
                .setDescription('是否隱藏闆闆名稱 (變更為 匿名闆闆ෆ)')),

    async execute(interaction) {
        // 🔒 管理員權限檢查
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '🚫 **權限不足**：只有 Discord **系統管理員** 才能使用此好評發布指令！',
                flags: 64
            });
        }

        const channel = interaction.options.getChannel('channel');
        const bossUser = interaction.options.getUser('boss');
        const talentText = interaction.options.getString('talent');
        const rating = interaction.options.getInteger('rating');
        const isAnonymous = interaction.options.getBoolean('anonymous') || false;

        // 🚀 自動生成 4 位數亂數單號 (免填寫)
        const autoOrderNo = Math.floor(1000 + Math.random() * 9000).toString();

        // 暫存於 Session 中
        const sessionId = `${interaction.user.id}_${Date.now()}`;
        if (!global.reviewSessions) global.reviewSessions = new Map();

        global.reviewSessions.set(sessionId, {
            cId: channel.id,
            oNo: autoOrderNo,
            bId: bossUser.id,
            tal: talentText,
            rat: rating,
            anon: isAnonymous
        });

        // 💬 構建彈窗 Modal 供管理員填寫留言內容
        const modal = new ModalBuilder()
            .setCustomId(`modal_review_${sessionId}`)
            .setTitle('🌟 填寫好評留言內容');

        const commentInput = new TextInputBuilder()
            .setCustomId('review_comment')
            .setLabel('留言內容')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('請輸入闆闆給予的好評留言文字...')
            .setRequired(true);

        const actionRow = new ActionRowBuilder().addComponents(commentInput);
        modal.addComponents(actionRow);

        // 彈出 Modal 視窗
        await interaction.showModal(modal);
    }
};