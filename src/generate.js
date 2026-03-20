import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';
import https from 'https';
import http from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = resolve(__dirname, '../history.json');

// ─── Config ───────────────────────────────────────────────────────────────────

const RECIPIENT = 'hi@raphaelch.me';
const SENDER_EMAIL = process.env.SENDER_EMAIL;
const SENDER_PASS = process.env.SENDER_PASSWORD;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const TAG_COLORS = {
  frontend: { bg: '#1a1035', text: '#a78bfa', border: '#4c1d95' },
  ia: { bg: '#0d2818', text: '#34d399', border: '#065f46' },
  csrd: { bg: '#0c1a2e', text: '#60a5fa', border: '#1e3a5f' },
  tooling: { bg: '#1f1200', text: '#fbbf24', border: '#78350f' },
  arch: { bg: '#0f1f10', text: '#86efac', border: '#14532d' },
  geo: { bg: '#200a0a', text: '#f87171', border: '#7f1d1d' },
};

// ─── History ─────────────────────────────────────────────────────────────────

function loadHistory() {
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveHistory(data, history) {
  const entry = {
    edition: data.edition,
    date: data.date,
    titles: data.items.map((i) => i.title),
  };
  const updated = [entry, ...history].slice(0, 8); // keep last 8 weeks
  writeFileSync(HISTORY_PATH, JSON.stringify(updated, null, 2));
}

function historyContext(history) {
  if (!history.length) return '';
  const lines = history
    .map((h) => `- Edition #${h.edition} (${h.date}) : ${h.titles.join(' / ')}`)
    .join('\n');
  return (
    '\nEditions precedentes (evite les memes sujets, fais des references si pertinent) :\n' +
    lines +
    '\n'
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function weekNumber() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
}

function frenchDate() {
  return new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function renderMarkup(text, color, bgColor, gradientHighlight = false) {
  return (text || '')
    .replace(
      /==(.+?)==/g,
      gradientHighlight
        ? `<span style="background:linear-gradient(90deg,#0DFF50,#096BDE 40%,#8E47FE 70%,#0DFF50);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:600;">$1</span>`
        : `<mark style="background:${bgColor};color:${color};padding:1px 5px;border-radius:2px;">$1</mark>`,
    )
    .replace(
      /\*\*(.+?)\*\*/g,
      `<strong style="color:#f0f0f0;font-weight:600;">$1</strong>`,
    );
}

async function verifyImage(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    return await new Promise((resolve) => {
      const req = lib.request(
        {
          method: 'HEAD',
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          timeout: 3000,
        },
        (res) => {
          const ok = res.statusCode >= 200 && res.statusCode < 400;
          const isImg = (res.headers['content-type'] || '').startsWith(
            'image/',
          );
          resolve(ok && isImg ? url : null);
        },
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    });
  } catch {
    return null;
  }
}

function parseJson(raw) {
  const cleaned = raw
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  const extracted = (cleaned.match(/\{[\s\S]*\}/) || [])[0] || cleaned;
  try {
    return JSON.parse(extracted);
  } catch {
    return JSON.parse(extracted.replace(/[\r\n\t]/g, ' '));
  }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Assistant de veille tech de Raphaël, dev front-end chez Kiosk (meetkiosk.com, SaaS CSRD/ESG). Stack : Remix, React, TypeScript, Node.js. Outils : Linear, Claude Code, Cursor. Intérêts : JS/TS, IA pour devs, archi web, CSRD/ESG, éthique IA.

MISSION : newsletter "Signal", 4 items exactement. Pour chaque item :
1. Recherche web — 7 derniers jours uniquement
2. Résumé 2 paragraphes (\n\n), ton direct

MISE EN VALEUR (stricte) :
- **gras** : exactement 2x dans le résumé. Chiffre+contexte ("**90% continuent quand même**") ou conclusion frappante ("**le modèle compliance est mort**"). Pas de noms propres seuls.
- ==surligné== : exactement 1x dans le résumé. La phrase la plus importante.
- Signal : 2-3 phrases. 1 **gras** + 1 ==surligné== (takeaway actionnable).

SOURCES AUTORISÉES : daily.dev, github.com/blog, devblogs.microsoft.com, react.dev/blog, remix.run/blog, vitejs.dev/blog, deno.com/blog, bun.sh/blog, thenewstack.io, web.dev, developer.chrome.com, anthropic.com/news, openai.com/blog, simonwillison.net, esgtoday.com, esgnews.com, efrag.org, consilium.europa.eu, techcrunch.com, wired.com, arstechnica.com, theverge.com, infoq.com.
INTERDITS : SEO farms, nxcode.io, ryzlabs.com, Medium générique. Pas de source fiable → autre sujet.

THÈMES (équilibrer) : JS/TS · IA pour devs · CSRD/ESG · web perf/archi · éthique/géopolitique tech

FORMAT — JSON pur, sans texte ni backtick :
{
  "edition": <semaine>,
  "date": "<date fr>",
  "editorial": "<2-3 phrases fil rouge, **gras** et ==surligné== autorisés>",
  "items": [{
    "tag": "<catégorie>",
    "tagColor": "<frontend|ia|csrd|tooling|arch|geo>",
    "title": "<max 12 mots>",
    "summary": "<2§ \n\n, max 2 phrases/§, 2x **gras**, 1x ==surligné==>",
    "signal": "<2-3 phrases, 1x **gras**, 1x ==surligné==>",
    "imageUrl": "<url image ou null>",
    "sources": [{ "label": "<nom>", "url": "<url>", "date": "<ex: 18 mars 2026>" }]
  }]
}`;

async function generateNewsletter() {
  const history = loadHistory();
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  console.log('Calling Claude with web search...');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Génère l'édition #${weekNumber()} de Signal pour le ${frenchDate()}. Actus des 7 derniers jours uniquement.${historyContext(history)} IMPORTANT : réponds UNIQUEMENT avec le JSON brut, sans texte avant ou après.`,
      },
    ],
  });

  const textBlock = response.content.filter((b) => b.type === 'text').pop();
  if (!textBlock) throw new Error('No text block in response');

  const data = parseJson(textBlock.text);

  saveHistory(data, history);

  await Promise.all(
    data.items.map(async (item) => {
      item.imageUrl = await verifyImage(item.imageUrl);
    }),
  );

  return data;
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function claudeDeepLink(item, allItems, edition) {
  const context = allItems
    .map((i) => `- [${i.tag}] ${i.title} : ${i.summary} | Signal : ${i.signal}`)
    .join('\n');
  const prompt = `Newsletter Signal #${edition} :\n\n${context}\n\nCreuse ce sujet : "${item.title}"\n\nAnalyse + implications concrètes pour dev front-end chez Kiosk (Remix + React + TypeScript, SaaS CSRD/ESG).`;
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

function allTopicsLink(data) {
  const summary = data.items.map((i) => `- [${i.tag}] ${i.title}`).join('\n');
  const prompt = `Signal #${data.edition} (${data.date}) :\n\n${summary}\n\nEn tant que dev front-end chez Kiosk (Remix + React + TypeScript, SaaS CSRD/ESG), quel sujet prioriser cette semaine ?`;
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

function buildHtml(data) {
  const itemsHtml = data.items
    .map((item, i) => {
      const c = TAG_COLORS[item.tagColor] || TAG_COLORS.tooling;
      const num = String(i + 1).padStart(2, '0');

      const imageHtml = item.imageUrl
        ? `<img src="${item.imageUrl}" alt="" style="display:block;width:100%;height:200px;object-fit:cover;border-bottom:1px solid #222226;border-radius:12px 12px 0 0;">`
        : '';

      const summaryHtml = (item.summary || '')
        .split(/\n\n+/)
        .filter(Boolean)
        .map(
          (p) =>
            `<p style="font-size:14px;color:#aaa;line-height:1.8;margin:0 0 12px;font-family:'Golos Text',sans-serif;">${renderMarkup(p, c.text, c.bg)}</p>`,
        )
        .join('');

      const sourcesHtml = (item.sources || [])
        .map(
          (s) =>
            `<a href="${s.url}" style="display:inline-block;font-size:12px;color:${c.text};font-family:'JetBrains Mono',monospace;text-decoration:none;border-bottom:1px solid ${c.text}66;margin-right:20px;padding-bottom:2px;">${s.label} ↗${s.date ? `<span style="color:#555;font-size:11px;margin-left:5px;">${s.date}</span>` : ''}</a>`,
        )
        .join('');

      return `
    <div style="margin-bottom:3px;background:#111113;border:1px solid #222226;border-radius:12px;overflow:hidden;">
      ${imageHtml}
      <div style="padding:24px 28px 28px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#555;letter-spacing:0.15em;">${num}</span>
          <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:3px;background:${c.bg};color:${c.text};border:1px solid ${c.border};letter-spacing:0.12em;font-family:'JetBrains Mono',monospace;">${item.tag}</span>
        </div>
        <p style="font-size:20px;font-weight:400;color:#f5f5f5;margin:0 0 16px;line-height:1.25;letter-spacing:-0.01em;font-family:'DM Serif Display',serif;">${item.title}</p>
        <div style="margin-bottom:16px;">${summaryHtml}</div>
        ${sourcesHtml ? `<div style="margin-bottom:20px;">${sourcesHtml}</div>` : ''}
        <div style="padding:14px 18px;background:#0a0a0b;border-left:3px solid ${c.text};border-radius:0 8px 8px 0;margin-bottom:20px;">
          <p style="font-size:14px;font-weight:400;color:${c.text};margin:0 0 8px;font-family:'JetBrains Mono',monospace;">signal</p>
          <p style="font-size:13.5px;color:#ccc;margin:0;line-height:1.65;font-family:'Golos Text',sans-serif;">${renderMarkup(item.signal, c.text, c.bg)}</p>
        </div>
        <a href="${claudeDeepLink(item, data.items, data.edition)}" style="display:inline-block;font-size:11px;font-weight:700;color:${c.text};background:${c.bg};border:1px solid ${c.border};border-radius:3px;padding:7px 16px;text-decoration:none;letter-spacing:0.06em;font-family:'Golos Text',sans-serif;>creuser avec claude →</a>
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
  <title>Signal #${data.edition}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Golos+Text:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>:root{color-scheme:dark;}body{background-color:#0a0a0b!important;color:#f0f0f0!important;font-family:'Golos Text',sans-serif;}</style>
</head>
<body style="margin:0;padding:0;background:#0a0a0b;">
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${data.items
    .slice(0, 3)
    .map((i) => i.title)
    .join(' · ')} — Ta veille tech de la semaine.</span>
  <div style="max-width:620px;margin:0 auto;padding:40px 16px 60px;background:#0a0a0b;">

    <div style="padding:32px 0 28px;border-bottom:1px solid #1e1e22;margin-bottom:4px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.2em;color:#444;margin:0 0 8px;">veille tech · raphaël</p>
          <p style="font-size:28px;font-weight:400;color:#f5f5f5;margin:0;letter-spacing:-0.02em;font-family:'DM Serif Display',serif;">SIGNAL<span style="color:#444;font-weight:400;font-family:'DM Serif Display',serif;"> #${data.edition}</span></p>
        </div>
        <div style="text-align:right;padding-top:4px;">
          <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#666;margin:0 0 4px;">${data.date}</p>
          <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#555;margin:0;">${data.items.length} items</p>
        </div>
      </div>
    </div>

    <div style="height:1px;background:linear-gradient(90deg,#0DFF50,#096BDE 40%,#8E47FE 70%,#0DFF50);margin-bottom:4px;"></div>

    ${
      data.editorial
        ? `<div style="padding:20px 24px;background:#111113;border:1px solid #222226;border-radius:12px;margin-bottom:4px;">
      <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#555;letter-spacing:0.15em;margin:0 0 10px;">cette semaine</p>
      <p style="font-size:14px;color:#bbb;line-height:1.75;margin:0;">${renderMarkup(data.editorial, '#a78bfa', '#1a1035')}</p>
    </div>`
        : ''
    }
    <div style="margin-bottom:4px;">${itemsHtml}</div>

    <div style="background:#111113;border:1px solid #222226;border-radius:12px;padding:24px 32px;text-align:center;">
      <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#666;letter-spacing:0.15em;margin:0 0 16px;">aller plus loin</p>
      <a href="${allTopicsLink(data)}" style="display:inline-block;font-size:12px;font-weight:700;color:#0a0a0b;background:#f0f0f0;border-radius:3px;padding:12px 28px;text-decoration:none;letter-spacing:0.06em;font-family:'Golos Text',sans-serif;">discuter avec claude →</a>
    </div>

    <div style="padding-top:24px;text-align:center;">
      <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#2a2a2e;margin:0;letter-spacing:0.08em;">signal · #${data.edition}</p>
    </div>

  </div>
</body>
</html>`;
}

// ─── Email ────────────────────────────────────────────────────────────────────

async function sendEmail(html, edition) {
  const transporter = nodemailer.createTransport({
    host: 'ssl0.ovh.net',
    port: 465,
    secure: true,
    auth: { user: SENDER_EMAIL, pass: SENDER_PASS },
  });
  await transporter.sendMail({
    from: `Signal Newsletter <${SENDER_EMAIL}>`,
    to: RECIPIENT,
    subject: `Signal #${edition} — Veille tech du vendredi`,
    html,
  });
  console.log(`Email sent to ${RECIPIENT}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    console.log('Starting Signal newsletter generation...');
    const data = await generateNewsletter();
    console.log(
      `Generated ${data.items.length} items for edition #${data.edition}`,
    );
    await sendEmail(buildHtml(data), data.edition);
    console.log('Done.');
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}

main();
