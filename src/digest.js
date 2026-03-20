import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = resolve(__dirname, '../history.json');

const RECIPIENT = process.env.RECIPIENT_EMAIL;
const SENDER_EMAIL = process.env.SENDER_EMAIL;
const SENDER_PASS = process.env.SENDER_PASSWORD;

// ─── Load last 4 editions from history ────────────────────────────────────────

function loadLastEditions() {
  try {
    const history = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
    return history.slice(0, 4);
  } catch {
    return [];
  }
}

function currentMonth() {
  return new Date().toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
  });
}

// ─── Claude — no web search, pure synthesis ───────────────────────────────────

async function generateDigest(editions) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const editionsText = editions
    .map(
      (e) =>
        `Édition #${e.edition} (${e.date}) :\n${e.titles.map((t) => `- ${t}`).join('\n')}`,
    )
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `Tu es l'assistant de veille tech de Raphaël, développeur front-end chez Kiosk (SaaS CSRD/ESG, stack Remix + React + TypeScript).

Voici les sujets couverts dans les 4 dernières éditions de sa newsletter Signal :

${editionsText}

Analyse ces sujets et identifie exactement 3 tendances de fond du mois. Une tendance = quelque chose qui s'est répété, consolidé, ou qui forme un signal fort sur plusieurs semaines.

Pour chaque tendance :
- Un titre court et percutant (max 8 mots)
- 2-3 phrases d'analyse — ce qui se passe vraiment, pas juste une description
- Ce que ça implique concrètement pour Raphaël dans les semaines à venir

Règles de mise en valeur (strictes) :
- **gras** : 1 seul chiffre+contexte ou conclusion frappante par tendance
- ==surligné== : 1 seule phrase — le takeaway le plus important de la tendance

IMPORTANT : réponds UNIQUEMENT avec le JSON brut, sans texte avant ou après, sans backticks :
{
  "month": "${currentMonth()}",
  "trends": [
    {
      "title": "<titre court>",
      "analysis": "<2-3 phrases avec **gras** et ==surligné==>",
      "implication": "<ce que ça implique pour Raphaël>"
    }
  ]
}`,
      },
    ],
  });

  const textBlock = response.content.filter((b) => b.type === 'text').pop();
  if (!textBlock) throw new Error('No text block in response');

  const raw = textBlock.text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  const extracted = (raw.match(/\{[\s\S]*\}/) || [])[0] || raw;
  try {
    return JSON.parse(extracted);
  } catch {
    return JSON.parse(extracted.replace(/[\r\n\t]/g, ' '));
  }
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function renderMarkup(text) {
  return (text || '')
    .replace(
      /==(.+?)==/g,
      `<mark style="background:#1a1035;color:#a78bfa;padding:1px 5px;border-radius:2px;">$1</mark>`,
    )
    .replace(
      /\*\*(.+?)\*\*/g,
      `<strong style="color:#f0f0f0;font-weight:600;">$1</strong>`,
    );
}

function buildDigestHtml(data) {
  const trendsHtml = data.trends
    .map((trend, i) => {
      const num = String(i + 1).padStart(2, '0');
      const accents = [
        { text: '#a78bfa', border: '#4c1d95', bg: '#1a1035' },
        { text: '#34d399', border: '#065f46', bg: '#0d2818' },
        { text: '#60a5fa', border: '#1e3a5f', bg: '#0c1a2e' },
      ];
      const c = accents[i] || accents[0];

      return `
    <div style="margin-bottom:3px;background:#111113;border:1px solid #222226;border-radius:4px;overflow:hidden;">
      <div style="padding:24px 28px 28px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <span style="font-family:'Courier New',monospace;font-size:10px;color:#555;letter-spacing:0.15em;">${num}</span>
          <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:3px;background:${c.bg};color:${c.text};border:1px solid ${c.border};letter-spacing:0.12em;text-transform:uppercase;font-family:'Courier New',monospace;">Tendance</span>
        </div>
        <p style="font-size:20px;font-weight:700;color:#f5f5f5;margin:0 0 14px;line-height:1.25;letter-spacing:-0.03em;">${trend.title}</p>
        <p style="font-size:14px;color:#aaa;line-height:1.8;margin:0 0 16px;">${renderMarkup(trend.analysis)}</p>
        <div style="padding:14px 18px;background:#0a0a0b;border-left:3px solid ${c.text};border-radius:0 6px 6px 0;">
          <p style="font-size:10px;color:${c.text};margin:0 0 6px;text-transform:uppercase;letter-spacing:0.12em;font-family:'Courier New',monospace;font-weight:700;">↳ Pour toi</p>
          <p style="font-size:13.5px;color:#ccc;margin:0;line-height:1.65;">${renderMarkup(trend.implication)}</p>
        </div>
      </div>
    </div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="fr" style="color-scheme:dark;">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <title>Signal Digest — ${data.month}</title>
  <style>:root{color-scheme:dark;}body{background-color:#0a0a0b!important;color:#f0f0f0!important;}</style>
</head>
<body style="margin:0;padding:0;background:#0a0a0b;">
  <span style="display:none;max-height:0;overflow:hidden;">3 tendances de fond ce mois-ci — ce qui se consolide dans ta veille tech.</span>
  <div style="max-width:620px;margin:0 auto;padding:40px 16px 60px;background:#0a0a0b;">

    <div style="padding:32px 0 28px;border-bottom:1px solid #1e1e22;margin-bottom:4px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <p style="font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#444;margin:0 0 8px;">Digest mensuel · Raphaël</p>
          <p style="font-size:28px;font-weight:700;color:#f5f5f5;margin:0;letter-spacing:-0.04em;">SIGNAL<span style="color:#444;font-weight:300;"> · ${data.month}</span></p>
        </div>
        <div style="text-align:right;padding-top:4px;">
          <p style="font-family:'Courier New',monospace;font-size:10px;color:#666;margin:0 0 4px;">Synthèse du mois</p>
          <p style="font-family:'Courier New',monospace;font-size:10px;color:#555;margin:0;">3 tendances</p>
        </div>
      </div>
    </div>

    <div style="height:1px;background:linear-gradient(90deg,#6366f1,#8b5cf6 30%,#ec4899 60%,#0ea5e9);margin-bottom:4px;"></div>

    <div style="border:1px solid #222226;border-radius:6px;overflow:hidden;margin-bottom:4px;">${trendsHtml}</div>

    <div style="padding-top:24px;text-align:center;">
      <p style="font-family:'Courier New',monospace;font-size:10px;color:#2a2a2e;margin:0;letter-spacing:0.1em;">SIGNAL DIGEST · ${data.month.toUpperCase()} · AUTO-GÉNÉRÉ</p>
    </div>

  </div>
</body>
</html>`;
}

// ─── Email ────────────────────────────────────────────────────────────────────

async function sendEmail(html, month) {
  const transporter = nodemailer.createTransport({
    host: 'ssl0.ovh.net',
    port: 465,
    secure: true,
    auth: { user: SENDER_EMAIL, pass: SENDER_PASS },
  });
  await transporter.sendMail({
    from: `Signal Newsletter <${SENDER_EMAIL}>`,
    to: RECIPIENT,
    subject: `Signal Digest — Tendances de ${month}`,
    html,
  });
  console.log(`Digest sent to ${RECIPIENT}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    console.log('Starting monthly digest generation...');
    const editions = loadLastEditions();
    if (editions.length < 2) {
      console.log(
        'Not enough history yet (need at least 2 editions). Skipping.',
      );
      return;
    }
    const data = await generateDigest(editions);
    console.log(`Generated digest for ${data.month}`);
    await sendEmail(buildDigestHtml(data), data.month);
    console.log('Done.');
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}

main();
