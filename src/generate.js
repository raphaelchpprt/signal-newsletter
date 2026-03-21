import Anthropic from '@anthropic-ai/sdk';
import https from 'https';
import http from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = resolve(__dirname, '../history.json');

// ─── Config ───────────────────────────────────────────────────────────────────

const RECIPIENT = process.env.RECIPIENT_EMAIL;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;

const TAG_COLORS = {
  frontend: { bg: '#1a1035', text: '#a78bfa', border: '#4c1d95' },
  ia: { bg: '#0d2818', text: '#34d399', border: '#065f46' },
  csrd: { bg: '#0c1a2e', text: '#60a5fa', border: '#1e3a5f' },
  tooling: { bg: '#1f1200', text: '#fbbf24', border: '#92620a' },
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
  const updated = [entry, ...history].slice(0, 4); // keep last 4 weeks
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
        ? `<mark style="background:linear-gradient(90deg,#0DFF5022,#096BDE22 40%,#8E47FE22 70%,#0DFF5022);color:#e0e0e0;padding:2px 6px;border-radius:3px;font-weight:500;border-bottom:1px solid #0DFF5066;">$1</mark>`
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
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .trim();
  const extracted = (cleaned.match(/\{[\s\S]*\}/) || [])[0] || cleaned;
  try {
    return JSON.parse(extracted);
  } catch {
    try {
      return JSON.parse(extracted.replace(/[\r\n\t]/g, ' '));
    } catch (e) {
      console.error('Raw JSON (500 chars):', extracted.substring(0, 500));
      throw e;
    }
  }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Assistant de veille tech de Raphaël, dev front-end chez Kiosk (meetkiosk.com, SaaS CSRD/ESG). Stack : Remix, React, TypeScript, Node.js. Outils : Linear, Claude Code, Cursor. Intérêts : JS/TS, IA pour devs, archi web, CSRD/ESG, éthique IA.

MISSION : newsletter "Signal", 5 items. Pour chaque item :
1. Recherche web — 7 derniers jours uniquement
2. Résumé 2 paragraphes (\n\n), ton direct

Le 5e item est toujours un article opinioné — quelqu'un qui prend position, challenge un consensus, ou questionne une direction tech/web/IA. Cherche des posts daily.dev, des billets de blog de devs connus, des threads HN (news.ycombinator.com) ou des articles sur thenewstack.io/arstechnica.com avec un angle critique. Le résumé doit restituer la thèse de l'auteur et ce qu'elle implique pour Raphaël.

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
  "editorial": "<1 phrase max 20 mots, fil rouge de la semaine, **gras** et ==surligné== autorisés>",
  "items": [{
    "tag": "<catégorie>",
    "tagColor": "<frontend|ia|csrd|tooling|arch|geo>",
    "title": "<max 12 mots>",
    "summary": "<2§ \n\n, 1-2 phrases/§ max, 2x **gras**, 1x ==surligné==>",
    "signal": "<1-2 phrases, 1x **gras**, 1x ==surligné==>",
    "imageUrl": "<url image ou null>",
    "sources": [{ "label": "<nom>", "url": "<url>", "date": "<ex: 18 mars 2026>" }]
  }]
}

Pour le 5e item opinioné, le tag peut être "opinion" et le tagColor "geo" (rouge discret).`;

async function generateNewsletter() {
  const history = loadHistory();
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  console.log('Calling Claude with web search...');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
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

function claudeDeepLink(item, edition) {
  const prompt = `Signal #${edition} — "${item.title}" : analyse + implications pour dev front-end Kiosk (Remix+React+TS, SaaS CSRD/ESG). Context: ${item.signal}`;
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
            `<p style="font-size:14px;color:#c0c0c0;line-height:2;margin:0 0 16px;font-family:'Golos Text',sans-serif;">${renderMarkup(p, c.text, c.bg)}</p>`,
        )
        .join('');

      const sourcesHtml = (item.sources || [])
        .map(
          (s) =>
            `<a href="${s.url}" style="display:inline-block;font-size:12px;color:${c.text};font-family:'JetBrains Mono',monospace;text-decoration:none;border-bottom:1px solid ${c.text}66;margin-right:20px;padding-bottom:2px;">${s.label} ↗${s.date ? `<span style="color:#777;font-size:11px;margin-left:5px;">${s.date}</span>` : ''}</a>`,
        )
        .join('');

      return `
    <div style="margin-bottom:10px;background:#111113;border:1px solid #222226;border-radius:12px;overflow:hidden;">
      ${imageHtml}
      <div style="padding:24px 28px 28px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#777;letter-spacing:0.15em;">${num}</span>
          <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:3px;background:${c.bg};color:${c.text};border:1px solid ${c.border};letter-spacing:0.12em;font-family:'JetBrains Mono',monospace;">${item.tag}</span>
        </div>
        <p style="font-size:20px;font-weight:600;color:#f5f5f5;margin:0 0 16px;line-height:1.25;letter-spacing:-0.02em;font-family:'Golos Text',sans-serif;">${item.title}</p>
        <div style="margin-bottom:16px;">${summaryHtml}</div>
        ${sourcesHtml ? `<div style="margin-bottom:20px;">${sourcesHtml}</div>` : ''}
        <div style="padding:14px 18px;background:#0a0a0b;border-left:3px solid ${c.text};border-radius:0 8px 8px 0;margin-bottom:20px;">
          <p style="font-size:13.5px;color:#e0e0e0;margin:0;line-height:1.8;font-family:'Golos Text',sans-serif;">${renderMarkup(item.signal, c.text, c.bg)}</p>
        </div>
        <a href="${claudeDeepLink(item, data.edition)}" style="display:inline-flex;align-items:center;font-size:11px;font-weight:600;color:#ffffff;background:transparent;border:1px solid #ffffff44;border-radius:4px;padding:7px 14px;text-decoration:none;letter-spacing:0.04em;font-family:'Golos Text',sans-serif;"><img src="https://cdn.simpleicons.org/claude/D97757" width="13" height="13" alt="Claude" style="display:inline-block;vertical-align:middle;margin-right:6px;flex-shrink:0;">creuser avec claude →</a>
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
  <style>:root{color-scheme:dark;}body{background-color:#0a0a0b!important;color:#f0f0f0!important;font-family:'Golos Text',sans-serif;}</style>
</head>
<body style="margin:0;padding:0;background:#0a0a0b;">
  <span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${data.items
    .slice(0, 3)
    .map((i) => i.title)
    .join(' · ')} — Ta veille tech de la semaine.</span>
  <div style="max-width:620px;margin:0 auto;padding:40px 16px 60px;background:#0a0a0b;">

    <div style="padding:32px 0 28px;border-bottom:1px solid #1e1e22;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <p style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.2em;color:#777;margin:0 0 8px;">veille tech · raphaël</p>
          <p style="font-size:28px;font-weight:400;color:#f5f5f5;margin:0;letter-spacing:-0.02em;font-family:'DM Serif Display',serif;">SIGNAL<span style="color:#666;font-weight:400;font-family:'DM Serif Display',serif;"> #${data.edition}</span></p>
        </div>
        <div style="text-align:right;padding-top:4px;">
          <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#888;margin:0 0 4px;">${data.date}</p>
          <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#777;margin:0;">${data.items.length} items</p>
        </div>
      </div>
    </div>

    <div style="height:1px;background:linear-gradient(90deg,#0DFF50,#096BDE 40%,#8E47FE 70%,#0DFF50);margin-bottom:12px;"></div>

    ${
      data.editorial
        ? `<div style="padding:20px 24px;background:#111113;border:1px solid #222226;border-radius:12px;margin-bottom:12px;">
      <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#555;letter-spacing:0.15em;margin:0 0 10px;">cette semaine</p>
      <p style="font-size:14px;color:#bbb;line-height:1.75;margin:0;">${renderMarkup(data.editorial, '#a78bfa', '#1a1035', true)}</p>
    </div>`
        : ''
    }
    <div style="margin-bottom:12px;">${itemsHtml}</div>

    <div style="background:#111113;border:1px solid #222226;border-radius:12px;padding:24px 32px;text-align:center;">
      <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#888;letter-spacing:0.15em;margin:0 0 16px;">aller plus loin</p>
      <a href="${allTopicsLink(data)}" style="display:inline-block;font-size:12px;font-weight:700;color:#0a0a0b;background:#f0f0f0;border-radius:3px;padding:12px 28px;text-decoration:none;letter-spacing:0.06em;font-family:'Golos Text',sans-serif;">discuter avec claude →</a>
    </div>

    <div style="padding-top:24px;text-align:center;">
      <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#555;margin:0 0 6px;letter-spacing:0.08em;">signal · #${data.edition}</p>
      <a href="https://raphaelch.me" style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#f0f0f0;text-decoration:none;letter-spacing:0.06em;">raphaelch.me</a>
    </div>

  </div>
</body>
</html>`;
}

// ─── Email ────────────────────────────────────────────────────────────────────

async function sendEmail(html, edition) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Signal Newsletter <signal@raphaelch.me>',
      to: [RECIPIENT],
      subject: `Signal #${edition} — Veille tech du vendredi`,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${res.status} ${err}`);
  }
  const data = await res.json();
  console.log(`Email sent to ${RECIPIENT} — id: ${data.id}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const MOCK_DATA = {
  edition: 99,
  date: 'vendredi 20 mars 2026',
  editorial:
    'Cette semaine, **les LLMs envahissent les IDEs** et la reglementation ESG se stabilise. ==Le stack JS/TS est en pleine recomposition== — une semaine dense.',
  items: [
    {
      tag: 'frontend',
      tagColor: 'frontend',
      title: 'Remix 3 drops React — bigger than it sounds',
      summary:
        'Remix v3 est une reecriture complete basee sur un fork de Preact.\n\n**90% des projets Remix existants** ne sont pas concernes par la migration immediate. ==React Router v7 reste l option recommandee.==',
      signal:
        'Kiosk tourne sur Remix v2. **Pas d urgence de migrer** — mais ==surveille React Router v7 pour les prochains sprints==.',
      imageUrl: null,
      sources: [
        { label: 'remix.run', url: 'https://remix.run', date: '18 mars 2026' },
      ],
    },
    {
      tag: 'ia',
      tagColor: 'ia',
      title: 'Claude Code vs Cursor — le bon workflow en 2026',
      summary:
        'Les devs combinent les deux outils selon les phases.\n\n**Claude Code domine sur les refactos larges**. ==Cursor reste superieur pour l ecriture active au quotidien.==',
      signal:
        '==Utilise Claude Code pour les gros chantiers Kiosk== — **la combinaison optimale** sur ton stack TypeScript.',
      imageUrl: null,
      sources: [
        {
          label: 'Anthropic',
          url: 'https://anthropic.com',
          date: '17 mars 2026',
        },
      ],
    },
    {
      tag: 'csrd',
      tagColor: 'csrd',
      title: 'Post-Omnibus : 90% des entreprises continuent de reporter',
      summary:
        'L Omnibus I a reduit le scope CSRD de ~85%.\n\n**90% des entreprises descoppees** maintiennent leur reporting ESG volontairement. ==La demande se deplace vers le value-driven.==',
      signal:
        '**Bonne nouvelle pour Kiosk** — le marche reste fort. ==Repositionne le messaging vers la valeur business==.',
      imageUrl: null,
      sources: [
        {
          label: 'ESG Today',
          url: 'https://esgtoday.com',
          date: '16 mars 2026',
        },
      ],
    },
    {
      tag: 'tooling',
      tagColor: 'tooling',
      title: 'TypeScript Native Preview — compilateur 10x plus rapide',
      summary:
        'Microsoft a publie un compilateur TypeScript reecrit en Go.\n\n**Les benchmarks montrent 10x de gain** sur les gros projets. ==Le DX TypeScript va changer radicalement en 2026.==',
      signal:
        'Sur Kiosk, ==teste la preview des que stable== — **le gain sur les build times** sera immediat.',
      imageUrl: null,
      sources: [
        {
          label: 'devblogs.microsoft.com',
          url: 'https://devblogs.microsoft.com',
          date: '15 mars 2026',
        },
      ],
    },
  ],
};

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const isSendPreview = process.argv.includes('--send-preview');

  if (isDryRun) {
    const { writeFileSync } = await import('fs');
    writeFileSync('preview.html', buildHtml(MOCK_DATA));
    console.log('Preview saved to preview.html — open it in your browser.');
    return;
  }

  if (isSendPreview) {
    const { readFileSync } = await import('fs');
    const html = readFileSync('preview.html', 'utf8');
    await sendEmail(html, 'test');
    console.log('Preview email sent.');
    return;
  }
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
