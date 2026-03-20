import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'ssl0.ovh.net',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SENDER_EMAIL,
    pass: process.env.SENDER_PASSWORD,
  },
});

const runUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

await transporter.sendMail({
  from: `Signal Newsletter <${process.env.SENDER_EMAIL}>`,
  to: process.env.RECIPIENT_EMAIL,
  subject: `⚠️ Signal — workflow failed`,
  html: `
    <div style="font-family:monospace;background:#0a0a0b;color:#f0f0f0;padding:32px;max-width:500px;border-radius:8px;">
      <p style="color:#f87171;font-size:16px;font-weight:700;margin:0 0 16px;">Signal Newsletter — build failed</p>
      <p style="color:#aaa;font-size:13px;margin:0 0 20px;">The Friday workflow didn't complete. No newsletter was sent this week.</p>
      <a href="${runUrl}" style="display:inline-block;font-size:12px;color:#0a0a0b;background:#f0f0f0;border-radius:3px;padding:8px 16px;text-decoration:none;font-weight:700;">View failed run →</a>
    </div>
  `,
});

console.log('Alert sent.');
