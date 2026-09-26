const nodemailer = require('nodemailer');

// 建立 SMTP 傳送器 (可由 .env 或環境變數配置)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== 'false', // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER || 'your-email@gmail.com',
        pass: process.env.SMTP_PASS || 'your-app-password'
    }
});

/**
 * 寄送 6 位數 Email 驗證碼
 */
async function sendVerificationCode(toEmail, code) {
    const mailOptions = {
        from: `"米胡電競 MiHu Gaming" <${process.env.SMTP_USER || 'no-reply@mihu.com'}>`,
        to: toEmail,
        subject: '【米胡電競】電子郵件驗證碼',
        html: `
            <div style="background-color: #0b0914; color: #ffffff; padding: 30px; font-family: sans-serif; border-radius: 12px; max-width: 480px; margin: 0 auto; border: 1px solid #9333ea;">
                <h2 style="color: #c084fc; text-align: center;">🎮 米胡電競 會員驗證</h2>
                <p>您好！我們收到了您在個人檔案綁定 Email 的請求。</p>
                <p>請在驗證視窗中輸入以下 6 位數驗證碼（10 分鐘內有效）：</p>
                <div style="text-align: center; margin: 24px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #fde047; background: #131021; padding: 12px 24px; border-radius: 8px; border: 1px solid #a855f7;">${code}</span>
                </div>
                <p style="font-size: 12px; color: #94a3b8;">如非本人操作，請忽略此郵件。</p>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
}

module.exports = { sendVerificationCode };