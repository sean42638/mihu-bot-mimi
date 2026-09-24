const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const fs = require('fs');
const path = require('path');

function checkDiscordAdminPermission(member, userId) {
    if (userId === "604610298581876746") return true;
    return member && member.permissions && member.permissions.has(PermissionFlagsBits.Administrator);
}

function syncOrdersJsonFromDb() {
    const ordersFilePath = path.join(__dirname, '..', 'data', 'orders.json');
    db.all('SELECT * FROM orders ORDER BY created_at DESC', (err, rows) => {
        if (!err && rows) {
            try { fs.writeFileSync(ordersFilePath, JSON.stringify(rows, null, 2), 'utf8'); } catch (e) {}
        }
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dispatch')
        .setNameLocalizations({ 'zh-TW': '派單' })
        .setDescription('發布工作室派單訊息至指定頻道')
        .addChannelOption(o => o.setName('channel').setNameLocalizations({ 'zh-TW': '發佈頻道' }).setDescription('派單頻道').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(o => o.setName('category').setNameLocalizations({ 'zh-TW': '類別' }).setDescription('訂單類別').setRequired(true).addChoices(
            { name: '陪玩單', value: '陪玩單' }, { name: '禮物單', value: '禮物單' }, { name: '有獎', value: '有獎' }, { name: '冠名', value: '冠名' }, { name: '獎金', value: '獎金' }
        ))
        .addStringOption(o => o.setName('game').setNameLocalizations({ 'zh-TW': '項目' }).setDescription('遊戲或服務項目').setRequired(true))
        .addStringOption(o => o.setName('content').setNameLocalizations({ 'zh-TW': '內容' }).setDescription('內容或規格').setRequired(true))
        .addNumberOption(o => o.setName('duration').setNameLocalizations({ 'zh-TW': '時長' }).setDescription('時長/數量').setRequired(true))
        .addStringOption(o => o.setName('unit').setNameLocalizations({ 'zh-TW': '單位' }).setDescription('計費單位').setRequired(true).addChoices(
            { name: '小時', value: '小時' }, { name: '局', value: '局' }, { name: '首', value: '首' }
        ))
        .addStringOption(o => o.setName('tag').setNameLocalizations({ 'zh-TW': 'tag' }).setDescription('欲 Tag 的身分組').setRequired(true))
        .addUserOption(o => o.setName('boss').setNameLocalizations({ 'zh-TW': '老闆id' }).setDescription('下單老闆').setRequired(true))
        .addNumberOption(o => o.setName('total_price').setNameLocalizations({ 'zh-TW': '總價' }).setDescription('訂單總金額').setRequired(true))
        .addStringOption(o => o.setName('extra').setNameLocalizations({ 'zh-TW': '附加' }).setDescription('附加條件').setRequired(false))
        .addNumberOption(o => o.setName('discount').setNameLocalizations({ 'zh-TW': '折扣' }).setDescription('折扣金額或折數').setRequired(false))
        .addStringOption(o => o.setName('note').setNameLocalizations({ 'zh-TW': '備註' }).setDescription('備註說明').setRequired(false)),
    async execute(interaction) {
        try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch (e) { return; }
        if (!checkDiscordAdminPermission(interaction.member, interaction.user.id)) {
            return interaction.editReply({ content: '🚫 您沒有執行派單的權限。' });
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
        const extra = interaction.options.getString('extra') || '';
        const rawDiscount = interaction.options.getNumber('discount');
        const note = interaction.options.getString('note') || '';

        let discountVal = rawDiscount || 0;
        const durationDisplay = `${duration}${unit}`;
        const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
        const orderNo = `MH-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

        db.run(`INSERT OR IGNORE INTO users (id, username, global_name, custom_nickname, avatar, role) VALUES (?, ?, ?, ?, ?, 'member')`,
            [bossUser.id, bossUser.username, bossUser.globalName || bossUser.username, bossUser.globalName || bossUser.username, bossUser.avatar || '']);

        const dispatchEmbed = new EmbedBuilder().setColor('#f59e0b')
            .addFields(
                { name: '訂單編號', value: `\`${orderNo}\``, inline: true },
                { name: '派單客服', value: `<@${interaction.user.id}>`, inline: true },
                { name: ' ', value: ' ', inline: false },
                { name: '項目', value: `**${game}**`, inline: true },
                { name: '內容', value: `\`${contentTier}\``, inline: true },
                { name: '時長', value: `**${durationDisplay}**`, inline: true }
            ).setFooter({ text: '米胡電競 MiHu Gaming · 派單服務' }).setTimestamp();

        if (extra) dispatchEmbed.addFields({ name: '附加', value: extra, inline: false });
        if (note) dispatchEmbed.addFields({ name: '備註', value: note, inline: false });

        try {
            const sentMessage = await targetChannel.send({ content: `## ✧新單快報✧\n\n${tagInput}`, embeds: [dispatchEmbed] });
            const insertSql = `INSERT INTO orders (order_no, boss_id, category, game, content_tier, duration, unit, unit_price, headcount, tag, extra, discount, note, total_amount, status, channel_id, message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'pending', ?, ?)`;

            db.run(insertSql, [orderNo, bossUser.id, category, game, contentTier, duration, unit, totalPrice, tagInput, extra, discountVal, note, totalPrice, sentMessage.channel.id, sentMessage.id], (dbErr) => {
                if (dbErr) return interaction.editReply({ content: '⚠️ 派單卡片已發送，但寫入資料庫失敗。' });
                syncOrdersJsonFromDb();
                interaction.editReply({ content: `✅ **派單成功！**\n📌 **訂單編號**：\`${orderNo}\` \n📢 **發佈頻道**：<#${targetChannel.id}>` });
            });
        } catch (sendErr) {
            interaction.editReply({ content: `❌ 無法發送訊息至頻道 <#${targetChannel.id}>。` });
        }
    }
};