const runUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from: 'Signal Newsletter <signal@raphaelch.me>',
    to: [process.env.RECIPIENT_EMAIL],
    subject: '⚠️ Signal — workflow failed',
    html: `
      <div style="font-family:monospace;background:#0a0a0b;color:#f0f0f0;padding:32px;max-width:500px;border-radius:8px;">
        <p style="color:#f87171;font-size:16px;font-weight:700;margin:0 0 16px;">Signal Newsletter — build failed</p>
        <p style="color:#aaa;font-size:13px;margin:0 0 20px;">The Friday workflow didn't complete. No newsletter was sent this week.</p>
        <a href="${runUrl}" style="display:inline-block;font-size:12px;color:#0a0a0b;background:#f0f0f0;border-radius:3px;padding:8px 16px;text-decoration:none;font-weight:700;">View failed run →</a>
      </div>
    `,
  }),
});

if (!res.ok) {
  const err = await res.text();
  console.error('Alert failed:', res.status, err);
  process.exit(1);
}

console.log('Alert sent.');
