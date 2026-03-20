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
      "signal": "<ce que ça implique concrètement pour Raphaël>"
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
        content: `Génère l'édition #${weekNum} de Signal pour le ${today}. Fais des recherches web sur les actus de la semaine avant de rédiger. Retourne uniquement le JSON, sans texte autour.`,
      },
    ],
  });

  // Extract the final text response (after tool use)
  let jsonText = "";
  for (const block of response.content) {
    if (block.type === "text") {
      jsonText = block.text;
    }
  }

  // Clean up any accidental markdown fences
  jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  return JSON.parse(jsonText);
}

const TAG_COLORS = {
  frontend: { bg: "#EEEDFE", text: "#3C3489" },
  ia: { bg: "#E1F5EE", text: "#085041" },
  csrd: { bg: "#E6F1FB", text: "#0C447C" },
  tooling: { bg: "#FAEEDA", text: "#633806" },
  arch: { bg: "#EAF3DE", text: "#27500A" },
  geo: { bg: "#FAECE7", text: "#712B13" },
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
  const summary = data.items
    .map((i) => `- [${i.tag}] ${i.title}`)
    .join("\n");

  const prompt =
    `Voici les sujets de ma newsletter Signal #${data.edition} (${data.date}) :\n\n${summary}\n\n` +
    `En tant que dev front-end chez Kiosk (SaaS CSRD/ESG, Remix + React + TypeScript + Node.js, basé à Biarritz), ` +
    `quel sujet devrais-je prioriser cette semaine et pourquoi ? Qu'est-ce qui a le plus d'impact sur mon travail ou ma veille ?`;

  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

function buildHtml(data) {
  const allTopicsLink = buildAllTopicsLink(data);

  const itemsHtml = data.items
    .map((item) => {
      const colors = TAG_COLORS[item.tagColor] || TAG_COLORS.tooling;
      const claudeLink = buildClaudeLink(item, data.items, data.edition);
      return `
      <div style="background:#ffffff;border:1px solid #e5e4e0;border-radius:12px;padding:20px 24px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <span style="font-size:11px;font-weight:600;padding:3px 9px;border-radius:6px;background:${colors.bg};color:${colors.text};letter-spacing:0.05em;text-transform:uppercase;">${item.tag}</span>
        </div>
        <p style="font-size:16px;font-weight:500;color:#1a1a1a;margin:0 0 10px;line-height:1.4;">${item.title}</p>
        <p style="font-size:14px;color:#555;line-height:1.65;margin:0 0 12px;">${item.summary}</p>
        <div style="background:#f7f6f3;border-left:3px solid #c8c6bf;border-radius:0 6px 6px 0;padding:10px 14px;margin-bottom:14px;">
          <p style="font-size:13px;color:#333;margin:0;line-height:1.55;"><strong style="font-weight:500;">Signal pour toi :</strong> ${item.signal}</p>
        </div>
        <a href="${claudeLink}" style="display:inline-block;font-size:12px;font-weight:500;color:#3C3489;background:#EEEDFE;border-radius:6px;padding:5px 12px;text-decoration:none;">Creuser avec Claude →</a>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Signal #${data.edition}</title>
</head>
<body style="margin:0;padding:0;background:#f0efe9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:640px;margin:32px auto;padding:0 16px 48px;">

    <div style="border-bottom:1px solid #dddcd7;padding-bottom:20px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end;">
      <div>
        <p style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#888;margin:0 0 4px;">Veille tech personnalisée</p>
        <p style="font-size:24px;font-weight:500;color:#1a1a1a;margin:0;">Signal <span style="color:#999;font-weight:400;">#${data.edition}</span></p>
      </div>
      <div style="text-align:right;">
        <p style="font-size:12px;color:#999;margin:0;">${data.date}</p>
        <p style="font-size:12px;color:#999;margin:4px 0 0;">${data.items.length} sujets · ~5 min</p>
      </div>
    </div>

    ${itemsHtml}

    <div style="border-top:1px solid #dddcd7;margin-top:24px;padding-top:20px;text-align:center;">
      <a href="${allTopicsLink}" style="display:inline-block;font-size:13px;font-weight:500;color:#ffffff;background:#2C2C2A;border-radius:8px;padding:10px 20px;text-decoration:none;margin-bottom:16px;">Discuter de cette édition avec Claude →</a>
      <p style="font-size:12px;color:#aaa;margin:0;">Signal · Édition #${data.edition} · Généré automatiquement pour Raphaël</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendEmail(html, edition) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
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
