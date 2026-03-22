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
  frontend: { bg: '#160d2e', text: '#c084fc', border: '#6d28d9' },
  ia: { bg: '#001a0a', text: '#34d399', border: '#065f46' },
  'perf & archi': { bg: '#001220', text: '#60a5fa', border: '#1d4ed8' },
  'tech & société': { bg: '#1c0a0a', text: '#f87171', border: '#991b1b' },
  opinion: { bg: '#1a1200', text: '#fbbf24', border: '#b45309' },
};

// ─── History ──────────────────────────────────────────────────────────────────

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
  writeFileSync(
    HISTORY_PATH,
    JSON.stringify([entry, ...history].slice(0, 4), null, 2),
  );
}

function historyContext(history) {
  if (!history.length) return '';
  return (
    ' Sujets recents a eviter : ' +
    history.map((h) => `#${h.edition}: ${h.titles.join(', ')}`).join(' | ') +
    '.'
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
        : `<mark style="background:${bgColor};color:${color};padding:1px 6px;border-radius:5px;">$1</mark>`,
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
    .replace(/[''ʼ]/g, "'")
    .replace(/[""]/g, '"')
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

1. Front-end : JS/TS, React, librairies UI (shadcn, radix, headless...), frameworks (Remix, Next), tooling front — tagColor: "frontend"
2. IA pour devs : modèles, Claude Code, Cursor, Copilot, workflows IA — tagColor: "ia"
3. Web perf & archi : performance, runtimes, patterns d'architecture, déploiement — tagColor: "perf & archi"
4. Éthique & géopolitique tech : régulation IA, souveraineté numérique, CSRD/ESG, greentech, impacts sociétaux — tagColor: "tech & société"
5. Opinion/Vision : un article opinioné qui prend position ou challenge un consensus tech/UX/UI/web. Style : "Is Frontend Dead?", best practices remises en question, nouveautés UX/UI analysées de façon critique. Sources : daily.dev, HN (news.ycombinator.com), thenewstack.io, arstechnica.com. Restitue la thèse de l'auteur et ce qu'elle implique pour Raphaël. — tagColor: "opinion"

Pour chaque item :
1. Recherche web — 7 derniers jours uniquement
2. Résumé 2 paragraphes (\n\n), ton direct, 1-2 phrases/§ max

MISE EN VALEUR (stricte) :
- **gras** : exactement 2x dans le résumé. Chiffre+contexte ou conclusion frappante. Pas de noms propres seuls.
- ==surligné== : exactement 1x dans le résumé. La phrase la plus importante.
- Signal : 1-2 phrases. 1 **gras** + 1 ==surligné== (takeaway actionnable).

SOURCES AUTORISÉES : daily.dev, github.com/blog, devblogs.microsoft.com, react.dev/blog, remix.run/blog, vitejs.dev/blog, deno.com/blog, bun.sh/blog, thenewstack.io, web.dev, developer.chrome.com, anthropic.com/news, openai.com/blog, simonwillison.net, esgtoday.com, esgnews.com, efrag.org, consilium.europa.eu, techcrunch.com, wired.com, arstechnica.com, theverge.com, infoq.com, news.ycombinator.com.
INTERDITS : SEO farms, nxcode.io, ryzlabs.com, Medium générique.

Langue : français correct avec apostrophes (l'IA, d'abord, c'est, qu'il).
IMPORTANT : n'utilise JAMAIS de HTML (<p>, <strong>, <em>, etc.) dans les valeurs JSON. Utilise uniquement **gras** et ==surligné== pour le markup.

FORMAT — JSON pur, sans texte ni backtick :
{
  "edition": <semaine>,
  "date": "<date fr>",
  "editorial": "<3-4 phrases max, fil rouge, **gras** et ==surligné== autorisés>",
  "items": [{
    "tag": "<frontend|ia|perf & archi|tech & société|opinion>",
    "tagColor": "<frontend|ia|perf & archi|tech & société|opinion>",
    "title": "<max 12 mots>",
    "summary": "<2§ \n\n, 1 phrase/§ max (courte), 2x **gras**, 1x ==surligné==>",
    "signal": "<1-2 phrases, 1x **gras**, 1x ==surligné==>",
    "imageUrl": "<url ou null>",
    "sources": [{ "label": "<nom>", "url": "<url>", "date": "<ex: 18 mars 2026>" }]
  }]
}`;

// ─── Generation ───────────────────────────────────────────────────────────────

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

  let data;
  try {
    data = parseJson(textBlock.text);
  } catch (e) {
    console.warn('JSON parse failed, retrying...');
    const retry = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            'Regenere le JSON de la newsletter Signal. Uniquement le JSON brut valide, sans HTML, sans texte autour.',
        },
      ],
    });
    const retryBlock = retry.content.filter((b) => b.type === 'text').pop();
    if (!retryBlock) throw new Error('No text block in retry response');
    data = parseJson(retryBlock.text);
  }

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
      const c = TAG_COLORS[item.tagColor] || TAG_COLORS.opinion;
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
          <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;background:${c.bg};color:${c.text};border:1px solid ${c.border};letter-spacing:0.12em;font-family:'JetBrains Mono',monospace;">${item.tag}</span>
        </div>
        <p style="font-size:20px;font-weight:600;color:#f5f5f5;margin:0 0 16px;line-height:1.25;letter-spacing:-0.02em;font-family:'Golos Text',sans-serif;">${item.title}</p>
        <div style="margin-bottom:16px;">${summaryHtml}</div>
        ${sourcesHtml ? `<div style="margin-bottom:20px;">${sourcesHtml}</div>` : ''}
        <div style="padding:14px 18px;background:#0a0a0b;border-left:3px solid ${c.text};border-radius:0 8px 8px 0;margin-bottom:20px;">
          <p style="font-size:13.5px;color:#e0e0e0;margin:0;line-height:1.5;font-family:'Golos Text',sans-serif;">${renderMarkup(item.signal, c.text, c.bg)}</p>
        </div>
        <a href="${claudeDeepLink(item, data.edition)}" style="display:inline-flex;align-items:center;font-size:11px;font-weight:600;color:#ffffff;background:transparent;border:1px solid #ffffff33;border-radius:8px;padding:7px 14px;text-decoration:none;letter-spacing:0.04em;font-family:'Golos Text',sans-serif;"><img src="https://cdn.simpleicons.org/claude/D97757" width="13" height="13" alt="Claude" style="display:inline-block;vertical-align:middle;margin-right:6px;flex-shrink:0;">creuser avec claude →</a>
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
  <link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&display=swap" rel="stylesheet">
  <style>:root{color-scheme:dark;}body{background-color:#0a0a0b!important;color:#f0f0f0!important;}</style>
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
          <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#777;margin:0;">édition hebdo</p>
        </div>
      </div>
    </div>

    <div style="height:1px;background:linear-gradient(90deg,#0DFF50,#096BDE 40%,#8E47FE 70%,#0DFF50);margin-bottom:12px;"></div>

    ${
      data.editorial
        ? `<div style="padding:20px 24px;background:#111113;border:1px solid #222226;border-radius:12px;margin-bottom:12px;">
      <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#888;letter-spacing:0.15em;margin:0 0 10px;">cette semaine</p>
      <p style="font-size:14px;color:#bbb;line-height:1.75;margin:0;font-family:'Golos Text',Georgia,sans-serif;">${renderMarkup(data.editorial, '#a78bfa', '#1a1035', true)}</p>
    </div>`
        : ''
    }

    <div style="margin-bottom:12px;">${itemsHtml}</div>

    <div style="background:#111113;border:1px solid #222226;border-radius:12px;padding:24px 32px;text-align:center;">
      <p style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#888;letter-spacing:0.15em;margin:0 0 16px;">aller plus loin</p>
      <a href="${allTopicsLink(data)}" style="display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#ffffff;background:#000000;border-radius:10px;padding:12px 28px;text-decoration:none;letter-spacing:0.06em;font-family:'Golos Text',sans-serif;box-shadow:0 0 0 1.5px #0DFF5088,0 0 16px #0DFF5055,0 0 32px #096BDE44,0 0 48px #8E47FE22;"><img src="https://cdn.simpleicons.org/claude/D97757" width="14" height="14" alt="Claude" style="display:inline-block;vertical-align:middle;flex-shrink:0;">discuter avec claude →</a>
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
  if (!res.ok)
    throw new Error(`Resend error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  console.log(`Email sent to ${RECIPIENT} — id: ${data.id}`);
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_DATA = {
  edition: 99,
  date: 'vendredi 21 mars 2026',
  editorial:
    "Cette semaine, le fil rouge est clair : ==le front-end se structure autour des stacks modulaires et du server-first==. React Router v7 et shadcn/ui confirment la tendance. **L'IA pour devs ne ralentit pas** — les workflows multi-agents deviennent la norme pour les grosses refactos. Une édition de consolidation plutôt que de rupture.",
  items: [
    {
      tag: 'frontend',
      tagColor: 'frontend',
      title: 'shadcn/ui v2 : composants serveur et nouvelles primitives',
      summary:
        "shadcn/ui sort une mise à jour majeure avec des composants compatibles React Server Components.\n\n**Le catalogue passe à 47 composants** et introduit un nouveau système de theming via CSS variables. ==L'écosystème headless UI se standardise autour de Radix + shadcn.==",
      signal:
        "**Très pertinent pour Kiosk** — ==évalue l'adoption de shadcn pour les prochains composants du dashboard ESG==.",
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
        "Anthropic documente les patterns d'usage de Claude Code en mode multi-agents pour les refactos larges.\n\n**Les équipes qui utilisent des agents en parallèle gagnent 3x en vitesse** sur les migrations de codebase. ==La frontière entre dev et orchestrateur devient floue.==",
      signal:
        '==Explore le mode agent de Claude Code pour les migrations TypeScript de Kiosk== — **le gain potentiel est significatif**.',
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
      tag: 'perf & archi',
      tagColor: 'perf & archi',
      title: 'Bun 2.0 : le runtime JS qui challenge Node sur tous les fronts',
      summary:
        'Bun 2.0 sort avec des performances en hausse et une compatibilité Node.js quasi totale.\n\n**Les benchmarks montrent 4x plus rapide que Node** sur les tâches I/O intensives. ==Le choix du runtime devient un vrai débat en 2026.==',
      signal:
        "**Pas d'urgence de migrer Kiosk** — mais ==surveille la compatibilité Remix + Bun pour une future évaluation==.",
      imageUrl: null,
      sources: [
        { label: 'bun.sh', url: 'https://bun.sh', date: '17 mars 2026' },
      ],
    },
    {
      tag: 'tech & société',
      tagColor: 'tech & société',
      title:
        'EU AI Act : premières sanctions et ce que ça change pour les SaaS',
      summary:
        'Les premières mises en conformité EU AI Act entrent en vigueur pour les systèmes à haut risque.\n\n**Les SaaS B2B européens ont 12 mois** pour documenter leurs systèmes IA. ==La compliance IA devient un argument commercial, pas juste une contrainte.==',
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
      tagColor: 'opinion',
      title: 'Le frontend est mort — vraiment ?',
      summary:
        "Un article d'Ahmed Amir sur daily.dev pose la question frontalement : le rôle du dev front-end est-il en train de disparaître avec l'IA ?\n\n**L'auteur argumente que le front-end ne meurt pas, il se transforme** — de la syntaxe vers l'architecture et l'UX thinking. ==La valeur se déplace vers ceux qui comprennent pourquoi, pas juste comment.==",
      signal:
        "**C'est exactement ton positionnement** — ==cultive l'angle UX/architecture plutôt que la maîtrise syntaxique pure==.",
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const isSendPreview = process.argv.includes('--send-preview');

  if (isDryRun) {
    writeFileSync('preview.html', buildHtml(MOCK_DATA));
    console.log('Preview saved to preview.html — open it in your browser.');
    return;
  }

  if (isSendPreview) {
    await sendEmail(readFileSync('preview.html', 'utf8'), 'test');
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
