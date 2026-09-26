const { PermissionFlagsBits } = require('discord.js');

const GUILD_ENV_KEYS = Object.freeze({
    MAIN: 'GUILD_MAIN_ID',
    STAFF: 'GUILD_STAFF_ID',
    REVIEW: 'GUILD_REVIEW_ID',
    DEV: 'GUILD_DEV_ID'
});
const COMMAND_GUILD_KEYS = Object.freeze(['MAIN', 'STAFF', 'DEV']);

const PUBLIC_COMMAND_GUILDS = Object.freeze({
    register: 'MAIN',
    bind: 'STAFF'
});

const GUILD_LABELS = Object.freeze({
    MAIN: '米胡電競大群',
    STAFF: '員工內部群',
    REVIEW: '入職審核群',
    DEV: '開發測試群'
});

function getConfiguredGuilds(env = process.env) {
    return Object.fromEntries(Object.entries(GUILD_ENV_KEYS)
        .map(([key, envName]) => [key, String(env[envName] || '').trim()])
        .filter(([, guildId]) => guildId));
}

function getCommandGuilds(env = process.env) {
    const configuredGuilds = getConfiguredGuilds(env);
    return Object.fromEntries(COMMAND_GUILD_KEYS
        .filter(guildKey => configuredGuilds[guildKey])
        .map(guildKey => [guildKey, configuredGuilds[guildKey]]));
}

function getMissingGuildVariables(env = process.env) {
    return COMMAND_GUILD_KEYS
        .map(guildKey => GUILD_ENV_KEYS[guildKey])
        .filter(envName => !String(env[envName] || '').trim());
}

function getCommandGuildKeys(commandName) {
    const publicGuild = PUBLIC_COMMAND_GUILDS[commandName];
    return publicGuild ? [publicGuild] : [...COMMAND_GUILD_KEYS];
}

function getCommandGuildLabels(commandName) {
    return getCommandGuildKeys(commandName).map(guildKey => GUILD_LABELS[guildKey]);
}

function isPublicCommand(commandName) {
    return Object.prototype.hasOwnProperty.call(PUBLIC_COMMAND_GUILDS, commandName);
}

function requiresAdministrator(commandName) {
    return !isPublicCommand(commandName);
}

function getMinimumExecutionRole(commandName) {
    return isPublicCommand(commandName) ? '會員' : '管理者';
}

function isCommandAllowedInGuild(commandName, guildId, env = process.env) {
    if (!guildId) return false;
    const configuredGuilds = getConfiguredGuilds(env);
    return getCommandGuildKeys(commandName).some(guildKey => configuredGuilds[guildKey] === String(guildId));
}

function hasDiscordAdministrator(interaction) {
    const permissions = interaction && interaction.memberPermissions;
    return Boolean(permissions && typeof permissions.has === 'function' && permissions.has(PermissionFlagsBits.Administrator));
}

function applyCommandDefaultPermissions(command) {
    if (!command || !command.data || typeof command.data.setDefaultMemberPermissions !== 'function') {
        throw new TypeError('Slash command is missing a Discord.js command builder');
    }

    command.data.setDefaultMemberPermissions(
        isPublicCommand(command.data.name) ? null : PermissionFlagsBits.Administrator
    );
    return command;
}

module.exports = {
    GUILD_ENV_KEYS,
    GUILD_LABELS,
    COMMAND_GUILD_KEYS,
    PUBLIC_COMMAND_GUILDS,
    applyCommandDefaultPermissions,
    getCommandGuildKeys,
    getCommandGuildLabels,
    getCommandGuilds,
    getConfiguredGuilds,
    getMinimumExecutionRole,
    getMissingGuildVariables,
    hasDiscordAdministrator,
    isCommandAllowedInGuild,
    isPublicCommand,
    requiresAdministrator
};