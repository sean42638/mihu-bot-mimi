require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./database');
const { client } = require('./bot');
const { getRolesData } = require('./utils/dataSync');

// 🔑 載入 Passport 設定模組
const passport = require('./config/passport');

// 🚀 載入獨立路由模組
const authRouter = require('./routes/auth');
const userRouter = require('./routes/user');
const systemRouter = require('./routes/system');
const managementRouter = require('./routes/management');

// 🚀 載入 Modal 派單處理器
const { handleDispatchModal } = require('./handlers/dispatchModalHandler');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'mihu_gaming_secret_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

// 🛡️ 全局動態權限中間件 (畫面顯示真實職位，但保留 Admin ID 最高特權)
app.use((req, res, next) => {
    if (req.isAuthenticated() && req.user) {
        db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (uErr, freshUser) => {
            const currentUser = freshUser || req.user;
            const rolesData = getRolesData();
            const roleObj = rolesData.find(r => r.role_key === currentUser.role);

            let perms = [];
            const myAdminId = "604610298581876746";
            const isSuperAdmin = (currentUser.id === myAdminId || currentUser.role === 'admin');

            if (isSuperAdmin) {
                perms = [
                    'home', 'home_banner', 'home_wallet_card', 'home_info',
                    'personal', 'profile', 'profile_discord', 'profile_nickname', 'my_wallet', 'my_income', 'my_orders',
                    'manage', 'manage_members', 'member_adjust_balance', 'member_adjust_vip', 'manage_staff', 'manage_orders',
                    'system', 'sys_commission', 'sys_vip', 'sys_roles', 'sys_settings', 'sys_logs'
                ];
            } else if (roleObj && roleObj.permissions) {
                perms = Array.isArray(roleObj.permissions) ? roleObj.permissions : [];
            } else {
                perms = ['home', 'home_wallet_card', 'home_info', 'personal', 'profile', 'my_wallet', 'my_orders'];
            }

            res.locals.userPerms = perms;
            res.locals.currentUser = currentUser;
            res.locals.hasPerm = (node) => isSuperAdmin || perms.includes(node);
            next();
        });
    } else {
        res.locals.userPerms = [];
        res.locals.currentUser = null;
        res.locals.hasPerm = () => false;
        next();
    }
});

// 🤖 Discord 機器人 Modal 事件監聽 (監聽派單 Modal 提交)
if (client) {
    client.on('interactionCreate', async (interaction) => {
        if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('modal_disp_')) {
                await handleDispatchModal(interaction);
            }
        }
    });
}

// 🔀 掛載模組化路由
app.use('/', authRouter);
app.use('/', userRouter);
app.use('/', systemRouter);
app.use('/management', managementRouter);

app.get('/', (req, res) => {
    res.redirect(req.isAuthenticated() ? '/dashboard' : '/login');
});

app.listen(PORT, () => {
    console.log(`✨ 米胡電競 Web 管理系統模組化啟動：http://localhost:${PORT}`);
});