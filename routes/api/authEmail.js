const express = require('express');
const router = express.Router();
const db = require('../../database');
const { sendVerificationCode } = require('../../services/emailService');

// 暫存驗證碼 (可改存 Redis 或 SQLite)
const verificationCodes = new Map();

// 1. 發送驗證碼 API
router.post('/api/email/send-code', async (req, res) => {
    try {
        const { email } = req.body;
        const userId = req.user ? req.user.id : null;

        if (!email || !email.includes('@')) {
            return res.json({ success: false, message: '請輸入有效的 Email 地址' });
        }

        // 產生 6 位數驗證碼
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 10 * 60 * 1000; // 10 分鐘有效

        // 保存狀態
        verificationCodes.set(userId || email, { email, code, expiresAt });

        // 發送郵件
        await sendVerificationCode(email, code);

        res.json({ success: true, message: '驗證碼已寄出，請至信箱查收' });
    } catch (err) {
        console.error('❌ 寄送驗證碼失敗:', err);
        res.json({ success: false, message: '寄送驗證郵件失敗，請檢查系統 SMTP 設定' });
    }
});

// 2. 校對驗證碼 API
router.post('/api/email/verify-code', (req, res) => {
    const { email, code } = req.body;
    const userId = req.user ? req.user.id : null;
    const record = verificationCodes.get(userId || email);

    if (!record || record.email !== email) {
        return res.json({ success: false, message: '尚未發送驗證碼或 Email 不符' });
    }

    if (Date.now() > record.expiresAt) {
        verificationCodes.delete(userId || email);
        return res.json({ success: false, message: '驗證碼已過期，請重新發送' });
    }

    if (record.code !== code.trim()) {
        return res.json({ success: false, message: '驗證碼錯誤，請重新輸入' });
    }

    // 驗證成功！更新資料庫 email_verified 狀態
    verificationCodes.delete(userId || email);

    db.run(`UPDATE users SET email = ?, email_verified = 1 WHERE id = ?`, [email, userId], (err) => {
        if (err) return res.json({ success: false, message: '資料庫寫入失敗' });
        res.json({ success: true, message: 'Email 驗證成功並已儲存！' });
    });
});

module.exports = router;