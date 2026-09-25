const { 
    SlashCommandBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder, 
    PermissionFlagsBits 
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('topup')
        .setNameLocalizations({
            'zh-TW': '充值',
            'zh-CN': '充值'
        })
        .setDescription('🪙 [管理員專用] 會員資金充值與帳務調整 (彈窗輸入)')
        .setDescriptionLocalizations({
            'zh-TW': '🪙 [管理員專用] 會員資金充值與帳務調整 (彈窗輸入)',
            'zh-CN': '🪙 [管理员专用] 会员资金充值与账务调整 (弹窗输入)'
        })
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option.setName('target')
                .setNameLocalizations({ 'zh-TW': '目標會員', 'zh-CN': '目标会员' })
                .setDescription('選擇要調整帳務的目標會員')
                .setDescriptionLocalizations({ 'zh-TW': '選擇要調整帳務的目標會員', 'zh-CN': '选择要调整账务的目标会员' })
                .setRequired(true)),

    async execute(interaction) {
        // 🔒 管理員權限過濾
        if (!interaction.memberPermissions || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '🚫 **權限不足**：只有 Discord **系統管理員** 才能使用此充值指令！',
                ephemeral: true
            });
        }

        const targetUser = interaction.options.getUser('target');

        // 🚀 建立 Modal 彈窗 (將 targetUser.id 帶在 customId 中傳遞)
        const modal = new ModalBuilder()
            .setCustomId(`topup_modal_${targetUser.id}`)
            .setTitle(`🪙 會員充值 - ${targetUser.username}`);

        // 輸入框 1：實充金額
        const realAmountInput = new TextInputBuilder()
            .setCustomId('real_amount')
            .setLabel('實充金額 ($)')
            .setPlaceholder('請輸入儲值金額 (例如: 1000)，不得為負數')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        // 輸入框 2：贈送金額
        const bonusAmountInput = new TextInputBuilder()
            .setCustomId('bonus_amount')
            .setLabel('贈送金額 ($)')
            .setPlaceholder('請輸入贈送金 (例如: 100 或 0)，不得為負數')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        // 輸入框 3：調帳備註原因
        const noteInput = new TextInputBuilder()
            .setCustomId('note')
            .setLabel('備註原因 (銀行轉帳、扣薪、活動等)')
            .setPlaceholder('例：玉山銀行轉帳 1000 元 或 客服退款')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(realAmountInput),
            new ActionRowBuilder().addComponents(bonusAmountInput),
            new ActionRowBuilder().addComponents(noteInput)
        );

        // 跳出彈窗 (必須直接呼叫 showModal)
        await interaction.showModal(modal);
    }
};