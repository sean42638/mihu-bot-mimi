const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../database');
const { syncOrdersJsonFromDb } = require('../utils/dataSync');

module.exports = async function handleButtonInteraction(interaction) {
    const customId = interaction.customId;

    // 1. 點擊【綠色：開始計時】
    if (customId.startsWith('timer_start_')) {
        const orderNo = customId.replace('timer_start_', '');
        db.get('SELECT * FROM orders WHERE order_no = ?', [orderNo], async (err, order) => {
            if (!order) return interaction.reply({ content: '❌ 找不到該筆訂單！', flags: MessageFlags.Ephemeral });
            if (order.talent_id !== interaction.user.id) {
                return interaction.reply({ content: '🚫 您不是此訂單的接單陪陪，無法操作計時！', flags: MessageFlags.Ephemeral });
            }

            const startTimeStr = new Date().toISOString();
            db.run('UPDATE orders SET status = "in_progress", start_time = ? WHERE order_no = ?', [startTimeStr, orderNo], (upErr) => {
                if (upErr) return interaction.reply({ content: '❌ 開始計時失敗！', flags: MessageFlags.Ephemeral });
                
                syncOrdersJsonFromDb();

                const stopRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`timer_stop_${orderNo}`).setLabel('⏹️ 結束計時').setStyle(ButtonStyle.Danger)
                );
                
                const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor('#10b981')
                    .addFields({ name: '⏱️ 開始計時時間', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false });

                interaction.update({ 
                    content: `▶️ **訂單 \`${orderNo}\` 已開始計時！服務狀態更新為：進行中**`, 
                    embeds: [updatedEmbed], 
                    components: [stopRow] 
                });
            });
        });
        return true;
    }

    // 2. 點擊【紅色：結束計時】➜ 跳出 Modal 彈窗填寫留給闆闆的話
    if (customId.startsWith('timer_stop_')) {
        const orderNo = customId.replace('timer_stop_', '');

        db.get('SELECT * FROM orders WHERE order_no = ?', [orderNo], async (err, order) => {
            if (!order) return interaction.reply({ content: '❌ 找不到該筆訂單！', flags: MessageFlags.Ephemeral });
            if (order.talent_id !== interaction.user.id) {
                return interaction.reply({ content: '🚫 您不是此訂單的接單陪陪，無法操作計時！', flags: MessageFlags.Ephemeral });
            }

            const modal = new ModalBuilder()
                .setCustomId(`modal_talent_msg_${orderNo}`)
                .setTitle('💌 服務完成！留給闆闆的話');

            const messageInput = new TextInputBuilder()
                .setCustomId('talent_message_input')
                .setLabel('想給闆闆的留言或感謝的話 (選填)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('例：謝謝闆闆今天的關照，玩的很開心！下次有空再一起玩喔～')
                .setRequired(false)
                .setMaxLength(500);

            const row = new ActionRowBuilder().addComponents(messageInput);
            modal.addComponents(row);

            await interaction.showModal(modal);
        });
        return true;
    }

    return false;
};