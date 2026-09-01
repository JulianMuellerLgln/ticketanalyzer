const axios = require('axios');

function getOllamaBase() {
  return process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
}

function getModel() {
  return process.env.OLLAMA_MODEL || 'llama3';
}

async function checkHealth() {
  try {
    const res = await axios.get(`${getOllamaBase()}/api/tags`, { timeout: 3000 });
    const models = (res.data.models || []).map((m) => m.name);
    return { online: true, models };
  } catch {
    return { online: false, models: [] };
  }
}

async function chat(prompt) {
  const res = await axios.post(
    `${getOllamaBase()}/api/generate`,
    { model: getModel(), prompt, stream: false },
    { timeout: 120000 }
  );
  return res.data.response || '';
}

function buildAnalysisPrompt(issues, lang = 'en') {
  const lang_intro = lang === 'de'
    ? 'Antworte auf Deutsch. Beantworte als technischer Product Owner.'
    : 'Reply in English. Answer as a technical Product Owner.';

  const simplified = issues.slice(0, 60).map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status?.name,
    priority: i.fields.priority?.name,
    assignee: i.fields.assignee?.displayName || null,
    created: i.fields.created,
    updated: i.fields.updated,
    resolved: i.fields.resolutiondate,
    description: (i.fields.description || '').slice(0, 300),
    storyPoints: i.fields.customfield_10016,
    labels: i.fields.labels,
  }));

  return `${lang_intro}

You are analyzing ${issues.length} Jira tickets for a technical product backlog review.
Below is a JSON excerpt of tickets:

${JSON.stringify(simplified, null, 2)}

Provide a concise structured analysis in JSON with these keys:
- "suggestions": array of {key, text} — new ticket ideas or improvements
- "redundancies": array of {keys: [key1, key2], reason} — tickets that overlap
- "gaps": array of {text} — missing information or empty important fields
- "slowTickets": array of {key, daysOpen, note} — tickets open unusually long
- "summary": string — 2-3 sentence executive summary

Return ONLY valid JSON, no markdown fences.`;
}

function buildIdeaEvalPrompt(ideaText, lang = 'en') {
  const lang_intro = lang === 'de'
    ? 'Antworte auf Deutsch als technischer Product Owner.'
    : 'Reply in English as a technical Product Owner.';
  return `${lang_intro}

Evaluate the following product idea for a technical backlog:

"${ideaText}"

Respond with JSON:
{
  "feasibility": "high|medium|low",
  "effort": "high|medium|low",
  "value": "high|medium|low",
  "risks": ["..."],
  "nextSteps": ["..."],
  "verdict": "brief verdict string"
}

Return ONLY valid JSON.`;
}

module.exports = { checkHealth, chat, buildAnalysisPrompt, buildIdeaEvalPrompt };
