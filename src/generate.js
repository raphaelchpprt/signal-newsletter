import Anthropic from "@anthropic-ai/sdk";
import nodemailer from "nodemailer";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RECIPIENT = "hi@raphaelch.me";
const SENDER_EMAIL = process.env.SENDER_EMAIL;
const SENDER_PASSWORD = process.env.SENDER_PASSWORD;

function getWeekNumber() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
}

function formatDate() {
  return new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const SYSTEM_PROMPT = `Tu es l'assistant de veille tech de Raphaël Chauvet, développeur fullstack front-end chez Kiosk (meetkiosk.com), une plateforme B2B SaaS de conformité CSRD et collecte de données ESG. Il est basé à Biarritz, travaille en remote.

Son stack : Remix, React, TypeScript, Node.js.
Ses outils quotidiens : Linear, Slack, Notion, Claude Code, Cursor.
Ses centres d'intérêt tech : écosystème JS/TS, outils IA pour devs, architecture web, tooling front-end.
Son contexte métier : CSRD, ESG, SaaS B2B européen, réglementation EU.
Ses intérêts plus larges : éthique IA, géopolitique tech, régulation EU.

Ta mission : générer une newsletter hebdomadaire appelée "Signal" avec 4 à 5 sujets pertinents pour lui.

Pour chaque sujet, tu dois :
1. Faire une recherche web pour trouver des actus récentes et concrètes
2. Synthétiser en 3-4 phrases maximum (pas de jargon corporate, ton direct)
3. Ajouter un "Signal pour toi" : ce que ça implique concrètement pour son travail chez Kiosk ou sa pratique de dev
4. Retourner 1 à 2 URLs sources — uniquement des sources primaires fiables (voir liste ci-dessous)

SOURCES AUTORISÉES (privilégier dans cet ordre) :
- Annonces officielles : github.com/blog, devblogs.microsoft.com, blog.angular.io, react.dev/blog, remix.run/blog, nodejs.org/en/blog, vitejs.dev/blog, deno.com/blog, bun.sh/blog
- Tech fiable : thenewstack.io, changelog.com, css-tricks.com, smashingmagazine.com, web.dev, developer.chrome.com, webkit.org/blog
- IA/ML : anthropic.com/news, openai.com/blog, huggingface.co/blog, simonwillison.net
- ESG/CSRD : esgtoday.com, esgnews.com, responsible-investor.com, consilium.europa.eu, eur-lex.europa.eu, efrag.org
- Presse tech sérieuse : techcrunch.com, wired.com, arstechnica.com, theverge.com, infoq.com

SOURCES INTERDITES :
- Sites de contenu généré par IA (articles sans auteur identifié, SEO farms)
- Medium sauf publications officielles d'entreprises
- Sites avec des titres clickbait ou du contenu clairement synthétisé
- Toute URL qui ne charge pas ou qui redirige vers une page d'erreur
- nxcode.io, ryzlabs.com, programming-helper.com et autres agrégateurs IA

Si tu ne trouves pas de source fiable sur un sujet, choisis un autre sujet pour lequel tu as une vraie source.

Thèmes à couvrir chaque semaine (équilibrer) :
- Écosystème JS/TS (Remix, React, Node, Vite, tooling)
- Outils IA pour devs (Claude Code, Cursor, Copilot, nouveaux modèles)
- CSRD / ESG tech (marché, réglementation EU, concurrents, tendances)
- Web performance / architecture (patterns, runtimes, déploiement)
- Optionnel : éthique IA ou géopolitique tech si actu notable

Format de réponse : JSON uniquement, sans markdown ni backticks, selon ce schéma exact :
{
  "edition": <numéro de semaine>,
  "date": "<date en français>",
  "items": [
    {
      "tag": "<catégorie courte>",
      "tagColor": "<une valeur parmi: frontend, ia, csrd, tooling, arch, geo>",
      "title": "<titre accrocheur, max 12 mots>",
      "summary": "<résumé factuel, 3-4 phrases, ton direct>",
      "signal": "<ce que ça implique concrètement pour Raphaël>",
      "sources": [
        { "label": "<nom court de la source>", "url": "<url complète>", "date": "<date de publication ex: 18 mars 2026>" }
      ]
    }
  ]
}`;

async function generateNewsletter() {
  console.log("Generating newsletter with web search...");

  const today = formatDate();
  const weekNum = getWeekNumber();

  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Génère l'édition #${weekNum} de Signal pour le ${today}. Fais des recherches web sur les actus des 7 derniers jours uniquement. Ignore tout ce qui est plus vieux que 7 jours. Retourne uniquement le JSON, sans texte autour.`,
      },
    ],
  });

  let jsonText = "";
  for (const block of response.content) {
    if (block.type === "text") {
      jsonText = block.text;
    }
  }

  jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(jsonText);
}

const TAG_COLORS = {
  frontend: { bg: "#1a1035", text: "#a78bfa", border: "#4c1d95" },
  ia:       { bg: "#0d2818", text: "#34d399", border: "#065f46" },
  csrd:     { bg: "#0c1a2e", text: "#60a5fa", border: "#1e3a5f" },
  tooling:  { bg: "#1f1200", text: "#fbbf24", border: "#78350f" },
  arch:     { bg: "#0f1f10", text: "#86efac", border: "#14532d" },
  geo:      { bg: "#200a0a", text: "#f87171", border: "#7f1d1d" },
};

function buildClaudeLink(item, allItems, edition) {
  const context = allItems
    .map((i) => `- [${i.tag}] ${i.title} : ${i.summary} | Signal : ${i.signal}`)
    .join("\n");
  const prompt =
    `Voici ma newsletter Signal #${edition} de cette semaine :\n\n${context}\n\n` +
    `Je veux creuser le sujet suivant : "${item.title}"\n\n` +
    `Donne-moi une analyse approfondie avec les implications concrètes pour mon travail de dev front-end chez Kiosk (SaaS CSRD/ESG, stack Remix + React + TypeScript). ` +
    `Si pertinent, suggère des actions pratiques ou des ressources à explorer.`;
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

function buildAllTopicsLink(data) {
  const summary = data.items.map((i) => `- [${i.tag}] ${i.title}`).join("\n");
  const prompt =
    `Voici les sujets de ma newsletter Signal #${data.edition} (${data.date}) :\n\n${summary}\n\n` +
    `En tant que dev front-end chez Kiosk (SaaS CSRD/ESG, Remix + React + TypeScript + Node.js, basé à Biarritz), ` +
    `quel sujet devrais-je prioriser cette semaine et pourquoi ? Qu'est-ce qui a le plus d'impact sur mon travail ou ma veille ?`;
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

function buildSourcesHtml(sources, accentColor) {
  if (!sources || sources.length === 0) return "";
  const links = sources
    .map(
      (s) =>
        `<a href="${s.url}" style="display:inline-block;font-size:10px;color:${accentColor};font-family:'Courier New',monospace;letter-spacing:0.05em;text-decoration:none;border-bottom:1px solid ${accentColor}33;margin-right:12px;">${s.label} ↗</a>`
    )
    .join("");
  return `<div style="margin-bottom:16px;">${links}</div>`;
}

function buildHtml(data) {
  const allTopicsLink = buildAllTopicsLink(data);

  const itemsHtml = data.items.map((item, index) => {
    const c = TAG_COLORS[item.tagColor] || TAG_COLORS.tooling;
    const claudeLink = buildClaudeLink(item, data.items, data.edition);
    const number = String(index + 1).padStart(2, "0");
    const sourcesHtml = buildSourcesHtml(item.sources || [], c.text);
    return `
    <div style="margin-bottom:2px;background:#111113;border:1px solid #222226;">
      <div style="padding:28px 32px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
          <span style="font-family:'Courier New',monospace;font-size:10px;color:#444;letter-spacing:0.15em;">${number}</span>
          <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:3px;background:${c.bg};color:${c.text};border:1px solid ${c.border};letter-spacing:0.12em;text-transform:uppercase;font-family:'Courier New',monospace;">${item.tag}</span>
        </div>
        <p style="font-size:17px;font-weight:600;color:#f0f0f0;margin:0 0 12px;line-height:1.35;letter-spacing:-0.02em;">${item.title}</p>
        <p style="font-size:13.5px;color:#888;line-height:1.75;margin:0 0 16px;font-weight:400;">${item.summary}</p>
        ${sourcesHtml}
        <div style="padding:14px 16px;background:#0d0d0f;border-left:2px solid ${c.text};border-radius:0 4px 4px 0;margin-bottom:20px;">
          <p style="font-size:12px;color:#555;margin:0 0 3px;text-transform:uppercase;letter-spacing:0.1em;font-family:'Courier New',monospace;">Signal</p>
          <p style="font-size:13px;color:#ddd;margin:0;line-height:1.6;">${item.signal}</p>
        </div>
        <a href="${claudeLink}" style="display:inline-block;font-size:11px;font-weight:600;color:${c.text};background:${c.bg};border:1px solid ${c.border};border-radius:3px;padding:6px 14px;text-decoration:none;letter-spacing:0.08em;font-family:'Courier New',monospace;text-transform:uppercase;">Creuser →</a>
      </div>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="fr" style="color-scheme: dark;">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>Signal #${data.edition}</title>
  <style>
    :root { color-scheme: dark; }
    body { background-color: #0a0a0b !important; color: #f0f0f0 !important; }
    @media (prefers-color-scheme: dark) {
      body { background-color: #0a0a0b !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#0a0a0b;background-color:#0a0a0b;">
  <div style="max-width:620px;margin:0 auto;padding:40px 16px 60px;background:#0a0a0b;">

    <div style="padding:32px 0 28px;border-bottom:1px solid #1e1e22;margin-bottom:4px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <p style="font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#444;margin:0 0 8px;">Veille tech · Raphaël</p>
          <p style="font-size:28px;font-weight:700;color:#f5f5f5;margin:0;letter-spacing:-0.04em;">SIGNAL<span style="color:#444;font-weight:300;"> #${data.edition}</span></p>
        </div>
        <div style="text-align:right;padding-top:4px;">
          <p style="font-family:'Courier New',monospace;font-size:10px;color:#444;margin:0 0 4px;letter-spacing:0.05em;">${data.date}</p>
          <p style="font-family:'Courier New',monospace;font-size:10px;color:#333;margin:0;letter-spacing:0.05em;">${data.items.length} ITEMS</p>
        </div>
      </div>
    </div>

    <div style="height:1px;background:linear-gradient(90deg,#6366f1 0%,#8b5cf6 30%,#ec4899 60%,#0ea5e9 100%);margin-bottom:4px;"></div>

    <div style="border:1px solid #222226;border-radius:6px;overflow:hidden;margin-bottom:4px;">
      ${itemsHtml}
    </div>

    <div style="background:#111113;border:1px solid #222226;border-radius:6px;padding:24px 32px;text-align:center;">
      <p style="font-family:'Courier New',monospace;font-size:10px;color:#444;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 16px;">Aller plus loin</p>
      <a href="${allTopicsLink}" style="display:inline-block;font-size:12px;font-weight:700;color:#0a0a0b;background:#f0f0f0;border-radius:3px;padding:12px 28px;text-decoration:none;letter-spacing:0.08em;text-transform:uppercase;font-family:'Courier New',monospace;">Discuter avec Claude →</a>
    </div>

    <div style="padding-top:24px;text-align:center;">
      <p style="font-family:'Courier New',monospace;font-size:10px;color:#2a2a2e;margin:0;letter-spacing:0.1em;">SIGNAL · ÉDITION #${data.edition} · AUTO-GÉNÉRÉ</p>
    </div>

  </div>
</body>
</html>`;
}

async function sendEmail(html, edition) {
  const transporter = nodemailer.createTransport({
    host: "ssl0.ovh.net",
    port: 465,
    secure: true,
    auth: {
      user: SENDER_EMAIL,
      pass: SENDER_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `Signal Newsletter <${SENDER_EMAIL}>`,
    to: RECIPIENT,
    subject: `Signal #${edition} — Veille tech du vendredi`,
    html,
  });

  console.log(`Email sent to ${RECIPIENT}`);
}

async function main() {
  try {
    console.log("Starting Signal newsletter generation...");
    const data = await generateNewsletter();
    console.log(`Generated ${data.items.length} items for edition #${data.edition}`);
    const html = buildHtml(data);
    await sendEmail(html, data.edition);
    console.log("Done.");
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
