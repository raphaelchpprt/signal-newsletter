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
    .map((h) => `#${h.edition}: ${h.titles.join(', ')}`)
    .join(' | ');
  return ' Sujets recents a eviter : ' + lines + '.';
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

MISSION : newsletter "Signal", 5 items exactement dans cet ordre :

1. Front-end : JS/TS, React, librairies UI (shadcn, radix, headless...), frameworks (Remix, Next), tooling front
2. IA pour devs : modèles, Claude Code, Cursor, Copilot, workflows IA
3. Web perf & archi : performance, runtimes, patterns d'architecture, déploiement
4. Éthique & géopolitique tech : régulation IA, souveraineté numérique, CSRD/ESG, green & civic tech, impacts sociétaux
5. Opinion/Vision : un article opinioné qui prend position ou challenge un consensus tech/UX/UI/web. Style : "Is Frontend Dead?", best practices remises en question, nouveautés UX/UI analysées de façon critique. Sources : daily.dev, HN (news.ycombinator.com), thenewstack.io, arstechnica.com. Restitue la thèse de l'auteur et ce qu'elle implique pour Raphaël. Tag : "opinion", tagColor : "geo".

Pour chaque item :
1. Recherche web — 7 derniers jours uniquement
2. Résumé 2 paragraphes (

), ton direct, 1-2 phrases/§ max

Langue : français correct avec apostrophes (l'IA, d'abord, c'est, qu'il).`;

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
  const titles = data.items.map((i) => i.title).join(' / ');
  const prompt = `Signal #${data.edition} : ${titles}. Quel sujet prioriser — dev front-end Kiosk (Remix+React+TS, SaaS CSRD/ESG) ?`;
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
            `<p style="font-size:14px;color:#c0c0c0;line-height:1.5;margin:0 0 16px;font-family:'Golos Text',sans-serif;">${renderMarkup(p, c.text, c.bg)}</p>`,
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
  date: 'vendredi 21 mars 2026',
  editorial:
    "==React Router v7 et shadcn/ui redefinissent le front-end== pendant que l'IA accelere partout — **une semaine de consolidation, pas de revolution**.",
  items: [
    {
      tag: 'frontend',
      tagColor: 'frontend',
      title: 'shadcn/ui v2 : composants serveur et nouvelles primitives',
      summary:
        "shadcn/ui sort une mise a jour majeure avec des composants compatibles React Server Components.\n\n**Le catalogue passe a 47 composants** et introduit un nouveau systeme de theming via CSS variables. ==L'écosystème headless UI se standardise autour de Radix + shadcn.==",
      signal:
        "**Très pertinent pour Kiosk** — ==evalue l'adoption de shadcn pour les prochains composants du dashboard ESG==.",
      imageUrl: null,
      sources: [
        {
          label: 'shadcn/ui',
          url: 'https://ui.shadcn.com',
          date: '19 mars 2026',
        },
      ],
    },
    {
      tag: 'ia',
      tagColor: 'ia',
      title: 'Claude Code : les nouveaux workflows multi-agents en pratique',
      summary:
        "Anthropic documente les patterns d'usage de Claude Code en mode multi-agents pour les refactos larges.\n\n**Les equipes qui utilisent des agents en parallele gagnent 3x en vitesse** sur les migrations de codebase. ==La frontiere entre dev et orchestrateur devient floue.==",
      signal:
        '==Explore le mode agent de Claude Code pour les migrations TypeScript de Kiosk== — **le gain potentiel est significant**.',
      imageUrl: null,
      sources: [
        {
          label: 'Anthropic',
          url: 'https://anthropic.com/news',
          date: '18 mars 2026',
        },
      ],
    },
    {
      tag: 'arch',
      tagColor: 'arch',
      title: 'Bun 2.0 : le runtime JS qui challenge Node sur tous les fronts',
      summary:
        'Bun 2.0 sort avec des performances en hausse et une compatibilite Node.js quasi totale.\n\n**Les benchmarks montrent 4x plus rapide que Node** sur les taches I/O intensives. ==Le choix du runtime devient un vrai debat en 2026.==',
      signal:
        "**Pas d'urgence de migrer Kiosk** — mais ==surveille la compatibilite Remix + Bun pour une future evaluation==.",
      imageUrl: null,
      sources: [
        { label: 'bun.sh', url: 'https://bun.sh', date: '17 mars 2026' },
      ],
    },
    {
      tag: 'geo',
      tagColor: 'geo',
      title:
        'EU AI Act : premieres sanctions et ce que ca change pour les SaaS',
      summary:
        'Les premieres mises en conformite EU AI Act entrent en vigueur pour les systemes a haut risque.\n\n**Les SaaS B2B europeens ont 12 mois** pour documenter leurs systemes IA. ==La compliance IA devient un argument commercial, pas juste une contrainte.==',
      signal:
        '==Anticipe une section IA dans le reporting Kiosk== — **les clients CSRD vont poser ces questions**.',
      imageUrl: null,
      sources: [
        {
          label: 'consilium.europa.eu',
          url: 'https://consilium.europa.eu',
          date: '16 mars 2026',
        },
      ],
    },
    {
      tag: 'opinion',
      tagColor: 'geo',
      title: 'Le frontend est mort — vraiment ?',
      summary:
        "Un article de Ahmed Amir sur daily.dev pose la question frontalement : le role du dev front-end est-il en train de disparaitre avec l'IA ?\n\n**L'auteur argumente que le front-end ne meurt pas, il se transforme** — de la syntaxe vers l'architecture et l'UX thinking. ==La valeur se deplace vers ceux qui comprennent pourquoi, pas juste comment.==",
      signal:
        "**C'est exactement ton positionnement** — ==cultive l'angle UX/architecture plutot que la maitrise syntaxique pure==.",
      imageUrl: null,
      sources: [
        {
          label: 'daily.dev',
          url: 'https://app.daily.dev/posts/is-frontend-dead-the-evolution-you-can-t-ignore-xuptirt4j',
          date: '20 mars 2026',
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
