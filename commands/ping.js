const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setNameLocalizations({ 'zh-TW': '延遲檢測', 'zh-CN': '延迟检测' })
        .setDescription('🏓 檢測機器人當前的網路延遲與 API 連線狀態'),

    async execute(interaction, client) {
        // 先 Defer 並下記記錄時間點以計算真實往返時間
        const sent = await interaction.deferReply({ flags: 64, fetchReply: true });

        // 計算往返時間 (Roundtrip Latency) 與 WebSocket 延遲
        const roundtripLatency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = Math.round(client.ws.ping);

        // 根據延遲狀況選擇顏色與狀態
        let statusColor = 0x10b981; // 綠色 (良好 < 150ms)
        let statusText = '🟢 網路狀態極佳';

        if (apiLatency > 300 || roundtripLatency > 400) {
            statusColor = 0xef4444; // 紅色 (較差 > 300ms)
            statusText = '🔴 網路延遲較高';
        } else if (apiLatency > 150 || roundtripLatency > 200) {
            statusColor = 0xf59e0b; // 黃色 (普通)
            statusText = '🟡 網路狀態普通';
        }

        const pingEmbed = new EmbedBuilder()
            .setColor(statusColor)
            .setTitle('🏓 米胡電競 系統延遲檢測')
            .addFields(
                { name: '⚡ 機器人往返延遲 (Roundtrip)', value: `\`${roundtripLatency} ms\``, inline: true },
                { name: '🌐 Discord API 延遲 (WS Ping)', value: `\`${apiLatency} ms\``, inline: true },
                { name: '📊 當前連線品質', value: `**${statusText}**`, inline: false }
            )
            .setFooter({ text: '米胡電競 MiHu Gaming · 系統監控' })
            .setTimestamp();

        await interaction.editReply({ embeds: [pingEmbed] });
    }
};