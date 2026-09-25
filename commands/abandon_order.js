const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const { syncOrdersJsonFromDb, syncUsersJsonFromDb } = require('../utils/dataSync');

function checkDiscordAdminPermission(member, userId) {
    if (userId === "604610298581876746") return true;
    return member && member.permissions && member.permissions.has(PermissionFlagsBits.Administrator);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('abandon_order')
        .setNameLocalizations({ 'zh-TW': '棄單' })
        .setDescription('暫棄現有訂單，自動全額退款至闆闆錢包，於原頻道通知陪陪並直接自後台刪除紀錄')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName('order_no').setNameLocalizations({ 'zh-TW': '訂單編號' }).setDescription('欲放棄的訂單編號').setRequired(true)),
    async execute(interaction, client) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: 64 });
            }
        } catch (e) {}

        if (!checkDiscordAdminPermission(interaction.member, interaction.user.id)) {
            return interaction.editReply({ content: '🚫 只有 Discord 客服與管理者身分能使用棄單指令。' });
        }

        const orderNo = interaction.options.getString('order_no').trim();

        // 1. 查詢訂單資料以取得原金額與闆闆 ID
        db.get('SELECT * FROM orders WHERE order_no = ?', [orderNo], async (err, order) => {
            if (err || !order) return interaction.editReply({ content: `❌ 找不到編號為 \`${orderNo}\` 的訂單！` });

            const refundAmount = Number(order.total_amount || 0);
            const bossId = order.boss_id;
            const targetChannelId = order.channel_id || interaction.channelId;

            // 🚀 2. 核心退款邏輯：全額退回闆闆錢包 (實充 balance)，並寫入流水帳
            const refundPromise = new Promise((resolve, reject) => {
                if (refundAmount > 0 && bossId) {
                    db.run(
                        'UPDATE users SET balance = balance + ? WHERE id = ?',
                        [refundAmount, bossId],
                        function (refundErr) {
                            if (refundErr) return reject(refundErr);

                            // 寫入錢包交易流水紀錄 (wallet_transactions)
                            db.run(`
                                INSERT INTO wallet_transactions (user_id, type, amount, description, created_at)
                                VALUES (?, 'order_refund', ?, ?, DATETIME('now', 'localtime'))
                            `, [bossId, refundAmount, `Discord /棄單 退款 - 訂單號: ${orderNo}`], () => {});

                            resolve();
                        }
                    );
                } else {
                    resolve();
                }
            });

            try {
                // 執行錢包退款
                await refundPromise;

                // 3. 於原派單頻道發布棄單通知 (不顯示單號)
                try {
                    const targetChannel = await client.channels.fetch(targetChannelId);
                    if (targetChannel) {
                        await targetChannel.send({ content: '辛苦各位陪陪 本單暫棄' });
                    }
                } catch (chErr) {
                    console.error('❌ 推送原頻道棄單訊息失敗:', chErr);
                }

                // 🚀 4. 後台 SQLite 資料庫直接物理刪除該筆訂單 (DELETE)
                db.run('DELETE FROM orders WHERE order_no = ?', [orderNo], (delErr) => {
                    if (delErr) {
                        return interaction.editReply({ content: `⚠️ 錢包已成功退款 $${refundAmount} NTD，但後台資料庫刪除失敗：${delErr.message}` });
                    }

                    // 5. 觸發 orders.json 與 users.json 異動同步，保持資料庫與 JSON 完全乾淨
                    try {
                        syncOrdersJsonFromDb();
                        if (typeof syncUsersJsonFromDb === 'function') syncUsersJsonFromDb();
                    } catch (syncErr) {}

                    interaction.editReply({
                        content: `✅ **訂單 \`${orderNo}\` 已成功棄單！**\n` +
                                 `• 已全額退還闆闆：\`$${refundAmount.toLocaleString()}\` NTD (<@${bossId}>)\n` +
                                 `• 訂單紀錄已自後台資料庫完全完全清除。`
                    });
                });

            } catch (refundError) {
                console.error('❌ 棄單退款失敗:', refundError);
                return interaction.editReply({ content: `❌ 棄單失敗，錢包退款時發生錯誤：${refundError.message}` });
            }
        });
    }
};