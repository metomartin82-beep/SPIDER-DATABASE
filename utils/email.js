const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_PORT === '465',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

const BRAND_HEADER = `
  <div style="font-family:'Space Grotesk',Arial,sans-serif;max-width:480px;margin:auto;background:#0D0F14;color:#F3EFE6;border-radius:12px;padding:32px;border:1px solid rgba(231,178,77,.2)">
    <div style="color:#E7B24D;font-weight:700;font-size:20px;margin-bottom:24px">🕸 SpiderDB</div>`;
const BRAND_FOOTER = `
    <p style="color:#6B6A66;font-size:12px;margin-top:28px">— The SpiderDB Team</p>
  </div>`;

// Verification email: a clickable link (primary) + a typed code (fallback for
// when the email is opened on a different device than the login attempt).
const sendVerification = async (toEmail, toName, otp, verifyLink) => {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'Verify your SpiderDB account',
    html: `${BRAND_HEADER}
      <p>Hi <strong>${toName}</strong>, welcome to SpiderDB.</p>
      <p>Click below to verify your account:</p>
      <div style="text-align:center;margin:24px 0">
        <a href="${verifyLink}" style="display:inline-block;background:#E7B24D;color:#181205;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px">Verify My Account</a>
      </div>
      <p style="color:#9A9689;font-size:12px;text-align:center">Or paste this link into your browser:<br><span style="color:#E7B24D;word-break:break-all">${verifyLink}</span></p>
      <p style="color:#9A9689;font-size:13px;margin-top:20px">Opening this on a different device? Use this code instead:</p>
      <div style="font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:700;letter-spacing:6px;color:#E7B24D;text-align:center;padding:16px;background:#14171F;border-radius:8px;margin:12px 0">${otp}</div>
      <p style="color:#9A9689;font-size:13px">This link and code expire in 24 hours.</p>
      ${BRAND_FOOTER}`
  });
};

const sendPasswordReset = async (toEmail, toName, resetLink) => {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'Reset your SpiderDB password',
    html: `${BRAND_HEADER}
      <p>Hi <strong>${toName}</strong>, we received a request to reset your password.</p>
      <div style="text-align:center;margin:24px 0">
        <a href="${resetLink}" style="display:inline-block;background:#E7B24D;color:#181205;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px">Reset Password</a>
      </div>
      <p style="color:#9A9689;font-size:12px;text-align:center">Or paste this link into your browser:<br><span style="color:#E7B24D;word-break:break-all">${resetLink}</span></p>
      <p style="color:#9A9689;font-size:13px">This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password won't change.</p>
      ${BRAND_FOOTER}`
  });
};

module.exports = { sendVerification, sendPasswordReset };
