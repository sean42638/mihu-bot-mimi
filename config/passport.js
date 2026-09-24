const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const db = require('../database');
const { syncUsersJsonFromDb } = require('../utils/dataSync');

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => done(err, row));
});

const scopes = ['identify', 'guilds'];
passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback',
    scope: scopes
}, (accessToken, refreshToken, profile, done) => {
    const { id, username, global_name, avatar } = profile;

    db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
        if (err) return done(err);

        if (!user) {
            const stmt = db.prepare(`
                INSERT INTO users (id, username, global_name, custom_nickname, avatar, role)
                VALUES (?, ?, ?, ?, ?, 'member')
            `);
            stmt.run([id, username, global_name || username, global_name || username, avatar], (insertErr) => {
                if (insertErr) return done(insertErr);
                syncUsersJsonFromDb();
                return done(null, { id, username, global_name, custom_nickname: global_name || username, avatar, role: 'member' });
            });
            stmt.finalize();
        } else {
            db.run(
                'UPDATE users SET username = ?, global_name = ?, avatar = ? WHERE id = ?',
                [username, global_name || username, avatar, id],
                () => syncUsersJsonFromDb()
            );
            return done(null, user);
        }
    });
}));

module.exports = passport;