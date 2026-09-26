require('dotenv').config();
const { REST } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { registerGuildCommands } = require('./utils/discordCommandRegistry');

async function deployCommands() {
    const botToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
    const applicationId = process.env.DISCORD_CLIENT_ID;
    if (!botToken || !applicationId) throw new Error('DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID are required');

    const commandDirectory = path.join(__dirname, 'commands');
    const currentCommands = new Map();
    for (const file of fs.readdirSync(commandDirectory).filter(name => name.endsWith('.js'))) {
        const command = require(path.join(commandDirectory, file));
        if (command && command.data && typeof command.execute === 'function') {
            currentCommands.set(command.data.name, command);
        }
    }

    const rest = new REST({ version: '10' }).setToken(botToken);
    const guildCounts = await registerGuildCommands(rest, applicationId, currentCommands);
    console.log('Slash commands registered for configured Guilds:', guildCounts);
}

deployCommands()
    .catch(error => {
        console.error('Slash command deployment failed:', error.message);
        process.exitCode = 1;
    });