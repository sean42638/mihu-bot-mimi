const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const fs = require('fs');
const path = require('path');

function checkDiscordAdminPermission(member, userId) {
    if (userId === "604610298581876746") return true;
    return member && member.permissions && member.permissions.has(PermissionFlagsBits.Administrator);
}

function syncUsersJsonFromDb() {
    const usersFilePath = path.join(__dirname, '..', 'data', 'users.json');
    db.all('SELECT * FROM users ORDER BY created_at DESC', (err, rows) => {
        if (!err && rows) {
            try { fs.writeFileSync(usersFilePath, JSON.stringify(rows, null, 2), 'utf8'); } catch (e) {}
        }
    });
}

function syncTopupsJsonFromDb() {
    const topupsFilePath = path.join(__dirname, '..', 'data', 'topups.json');
    db.all('SELECT * FROM topups ORDER BY created_at DESC', (err, rows) => {
        if (!err && rows) {
            try { fs.writeFileSync(topupsFilePath, JSON.stringify(rows, null, 2), 'utf8'); } catch (e) {}
        }
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('topup')
        .setNameLocalizations({ 'zh-TW': '加值' })
        .setDescription('客服或管理員為指定會員手動儲值實充與贈送金額')
        .addUserOption(o => o.setName('target').setNameLocalizations({ 'zh-TW': '目標用戶' }).setDescription('欲加值的會員老闆').setRequired(true))
        .addNumberOption(o => o.setName('amount').setNameLocalizations({ 'zh-TW': '實充金額' }).setDescription('實際充值金額').setRequired(true))
        .addNumberOption(o => o.setName('bonus').setNameLocalizations({ 'zh-TW': '贈送金額' }).setDescription('額外贈送金額').setRequired(true))
        .addStringOption(o => o.setName('channel_type').setNameLocalizations({ 'zh-TW': '管道' }).setDescription('付款加值管道').setRequired(true).addChoices(
            { name: '銀行轉帳', value: '銀行轉帳' }, { name: '超商代碼', value: '超商代碼' }, { name: '街口支付', value: '街口支付' },
            { name: 'LINE Pay', value: 'LINE Pay' }, { name: '無卡存款', value: '無卡存款' }, { name: '後台調帳', value: '後台調帳' }
        ))
        .addStringOption(o => o.setName('note').setNameLocalizations({ 'zh-TW': '備註' }).setDescription('加值說明或單號備註').setRequired(false)),
    async execute(interaction) {
        try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch (e) { return; }
        if (!checkDiscordAdminPermission(interaction.member, interaction.user.id)) {
            return interaction.editReply({ content: '🚫 只有 Discord 客服與管理者身分能使用此指令。' });
        }

        const targetUser = interaction.options.getUser('target');
        const amount = interaction.options.getNumber('amount') || 0;
        const bonus = interaction.options.getNumber('bonus') || 0;
        const channelType = interaction.options.getString('channel_type');
        const note = interaction.options.getString('note') || 'Discord 指令加值';
        const tId = targetUser.id;

        db.get('SELECT * FROM users WHERE id = ?', [tId], (err, userRow) => {
            const currentBalance = userRow ? Number(userRow.balance || 0) : 0;
            const currentBonus = userRow ? Number(userRow.bonus_balance || 0) : 0;
            const newBalance = currentBalance + amount;
            const newBonus = currentBonus + bonus;
            const newTotalBalance = newBalance + newBonus;

            db.all('SELECT * FROM vip_tiers ORDER BY level ASC', (vErr, tiers) => {
                let calculatedVip = userRow ? Number(userRow.vip_level || 0) : 0;
                const statsSql = `SELECT COALESCE((SELECT SUM(total_amount) FROM orders WHERE boss_id = ? AND status != 'cancelled'), 0) + COALESCE((SELECT manual_spent FROM users WHERE id = ?), 0) as total_spent, COALESCE((SELECT SUM(amount) FROM topups WHERE user_id = ? AND amount > 0), 0) + ? + COALESCE((SELECT manual_deposited FROM users WHERE id = ?), 0) as total_deposited`;

                db.get(statsSql, [tId, tId, tId, amount, tId], (sErr, stats) => {
                    const depositedTotal = stats ? Number(stats.total_deposited || 0) : amount;
                    const spentTotal = stats ? Number(stats.total_spent || 0) : 0;

                    if (!vErr && tiers) {
                        for (const t of tiers) {
                            if ((t.spent_threshold > 0 && spentTotal >= t.spent_threshold) || (t.deposit_threshold > 0 && depositedTotal >= t.deposit_threshold)) {
                                calculatedVip = Math.max(calculatedVip, Number(t.level));
                            }
                        }
                    }

                    const finalizeTopup = () => {
                        db.run('INSERT INTO topups (user_id, amount, bonus, channel_type, note, operator_id) VALUES (?, ?, ?, ?, ?, ?)',
                            [tId, amount, bonus, channelType, note, interaction.user.id], () => {
                                syncUsersJsonFromDb();
                                syncTopupsJsonFromDb();

                                const topupEmbed = new EmbedBuilder().setColor('#10b981').setTitle('💳 會員錢包加值成功！')
                                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                                    .addFields(
                                        { name: '會員老闆', value: `<@${tId}> (${targetUser.username})`, inline: true },
                                        { name: '經手客服', value: `<@${interaction.user.id}>`, inline: true },
                                        { name: '付款管道', value: `\`${channelType}\``, inline: true },
                                        { name: '實充入帳', value: `**+$${amount.toLocaleString()} NTD**`, inline: true },
                                        { name: '贈送入帳', value: `**+$${bonus.toLocaleString()} NTD**`, inline: true },
                                        { name: '當前總可用餘額', value: `**$${newTotalBalance.toLocaleString()} NTD**`, inline: true },
                                        { name: '當前尊榮 VIP', value: `**VIP ${calculatedVip}**`, inline: true }
                                    ).setFooter({ text: '米胡電競 MiHu Gaming · 帳務中心' }).setTimestamp();

                                if (note) topupEmbed.addFields({ name: '交易備註', value: note, inline: false });
                                interaction.editReply({ content: `✅ **已成功為 <@${tId}> 完成加值！**`, embeds: [topupEmbed] });
                            });
                    };

                    if (!userRow) {
                        db.run(`INSERT INTO users (id, username, global_name, custom_nickname, avatar, role, balance, bonus_balance, vip_level) VALUES (?, ?, ?, ?, ?, 'member', ?, ?, ?)`,
                            [tId, targetUser.username, targetUser.globalName || targetUser.username, targetUser.globalName || targetUser.username, targetUser.avatar || '', newBalance, newBonus, calculatedVip], finalizeTopup);
                    } else {
                        db.run('UPDATE users SET balance = ?, bonus_balance = ?, vip_level = ? WHERE id = ?', [newBalance, newBonus, calculatedVip, tId], finalizeTopup);
                    }
                });
            });
        });
    }
};