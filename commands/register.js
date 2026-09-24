const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('register')
        .setNameLocalizations({ 'zh-TW': '註冊' })
        .setDescription('玩家於 Discord 自行綁定與註冊米胡電競會員帳號'),
    async execute(interaction) {
        try { await interaction.deferReply({ flags: MessageFlags.Ephemeral }); } catch (e) { return; }
        const discordUser = interaction.user;
        const userId = discordUser.id;

        db.get('SELECT * FROM users WHERE id = ?', [userId], async (err, row) => {
            if (err) return interaction.editReply({ content: '❌ 資料庫查詢發生錯誤。' });

            const sendEmbedResponse = (userRecord) => {
                const vipLevel = Number(userRecord.vip_level || 0);
                const vipDisplay = vipLevel > 0 ? `VIP ${vipLevel}` : '一般會員';
                const totalBalance = Number(userRecord.balance || 0) + Number(userRecord.bonus_balance || 0);

                const embed = new EmbedBuilder()
                    .setColor('#9333ea')
                    .setTitle('您已經是米胡電競的會員囉！')
                    .setDescription(`歡迎回來，**${userRecord.custom_nickname || userRecord.global_name || userRecord.username}**！\n\n您可隨時登入後臺檢視個人錢包與檔案：\n👉 [米胡電競管理後臺](${process.env.WEBSITE_URL || 'http://localhost:3000'})`)
                    .addFields(
                        { name: '當前 VIP 等級', value: vipDisplay, inline: true },
                        { name: '總可用金額', value: `$${totalBalance.toLocaleString()} NTD`, inline: true }
                    )
                    .setThumbnail(discordUser.displayAvatarURL({ dynamic: true }))
                    .setFooter({ text: '米胡電競 MiHu Gaming · 尊榮服務' });

                return interaction.editReply({ embeds: [embed] });
            };

            if (!row) {
                db.run(`INSERT INTO users (id, username, global_name, custom_nickname, avatar, role, vip_level) VALUES (?, ?, ?, ?, ?, 'member', 0)`,
                    [userId, discordUser.username, discordUser.globalName || discordUser.username, discordUser.globalName || discordUser.username, discordUser.avatar || ''],
                    (insErr) => {
                        if (insErr) return interaction.editReply({ content: '❌ 註冊失敗，請重試。' });
                        sendEmbedResponse({ id: userId, username: discordUser.username, global_name: discordUser.globalName, custom_nickname: discordUser.globalName, avatar: discordUser.avatar, role: 'member', vip_level: 0, balance: 0, bonus_balance: 0 });
                    });
            } else {
                db.run('UPDATE users SET username = ?, global_name = ?, avatar = ? WHERE id = ?', [discordUser.username, discordUser.globalName || discordUser.username, discordUser.avatar || '', userId]);
                sendEmbedResponse(row);
            }
        });
    }
};