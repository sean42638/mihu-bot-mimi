const { EmbedBuilder } = require('discord.js');
const { checkChannelPermissions } = require('../utils/permissionHelper');

async function handleReviewModal(interaction) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: 64 });
    }

    const sessionId = interaction.customId.replace('modal_review_', '');
    const sessionData = global.reviewSessions ? global.reviewSessions.get(sessionId) : null;

    if (!sessionData) {
        return interaction.editReply({ content: '❌ 好評發布 Session 已過期，請重新執行 `/好評` 指令。' });
    }
    if (sessionData.commandInitiatorId && sessionData.commandInitiatorId !== interaction.user.id) {
        return interaction.editReply({ content: '🚫 此好評 Modal 不屬於目前的指令發起者。' });
    }

    const comment = interaction.fields.getTextInputValue('review_comment').trim();

    try {
        const targetChannel = await interaction.guild.channels.fetch(sessionData.cId).catch(() => null);

        const permCheck = checkChannelPermissions(targetChannel, interaction.client);
        if (!permCheck.hasAccess) {
            return interaction.editReply({ content: permCheck.errorMsg });
        }

        const bossDisplay = sessionData.anon ? '匿名闆闆ෆ' : `<@${sessionData.bId}>`;
        const outerText = `💭₊˚ෆ 感謝 ${bossDisplay} 給 ${sessionData.tal} 的好評∿🤍⸝⸝⸝`;

        const starEmoji = '🌟';
        const starsDisplay = starEmoji.repeat(sessionData.rat) + ` ${sessionData.rat}/5`;

        const now = new Date();
        const formattedDate = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        const reviewEmbed = new EmbedBuilder()
            .setColor(0x3b82f6)
            .addFields(
                { name: '滿意星星', value: starsDisplay, inline: false },
                { name: '留言', value: comment, inline: false }
            )
            .setFooter({ text: `訂單編號 : ${sessionData.oNo} • ${formattedDate}` });

        await targetChannel.send({
            content: outerText,
            embeds: [reviewEmbed]
        });

        global.reviewSessions.delete(sessionId);
        await interaction.editReply({ content: `✅ **好評卡片已成功發布至 <#${sessionData.cId}>！**` });

    } catch (err) {
        console.error('❌ 發布好評發生錯誤:', err);
        await interaction.editReply({ content: `❌ **發布失敗**：${err.message}` }).catch(() => {});
    }
}

// 🎯 關鍵修復：必須匯出包含 handleReviewModal 的物件
module.exports = {
    handleReviewModal
};