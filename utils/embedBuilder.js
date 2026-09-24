const { EmbedBuilder } = require('discord.js');

// 🎨 品牌標準配色對照表
const BRAND_COLORS = {
    PURPLE: '#9333ea',  // 品牌主色 (註冊/通用)
    GREEN: '#10b981',   // 成功/加值/開始計時
    BLUE: '#3b82f6',    // 指派/訊息小卡
    YELLOW: '#f59e0b',  // 派單/警示
    RED: '#ef4444',     // 結單/結束計時
};

/**
 * 建立米胡電競品牌標準 Embed 卡片基底
 * @param {Object} options
 * @param {string} options.title 卡片標題
 * @param {string} [options.description] 卡片內文
 * @param {string} [options.color] 顏色 (色碼或依品牌色名)
 * @param {string} [options.footerText] 自訂底部標語
 * @returns {EmbedBuilder}
 */
function createMihuEmbed({ title, description, color = BRAND_COLORS.PURPLE, footerText = '米胡電競 MiHu Gaming · 尊榮服務' }) {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setFooter({ text: footerText })
        .setTimestamp();

    if (description) {
        embed.setDescription(description);
    }

    return embed;
}

module.exports = {
    BRAND_COLORS,
    createMihuEmbed
};