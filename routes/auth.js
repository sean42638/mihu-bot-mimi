const express = require('express');
const passport = require('passport');
const router = express.Router();
const { ensureAuth, checkPerm } = require('../middleware/auth');
router.get('/login', (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/dashboard');
    res.render('login', { error: req.query.error || null });
});

router.get('/auth/discord', passport.authenticate('discord'));

router.get('/auth/discord/callback', 
    passport.authenticate('discord', { failureRedirect: '/login?error=Discord 授權失敗' }),
    (req, res) => res.redirect('/dashboard')
);

router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/login');
    });
});

module.exports = router;