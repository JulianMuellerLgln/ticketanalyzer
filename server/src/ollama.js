const axios = require('axios');
const DEFAULT_LARGE_MODEL = process.env.OLLAMA_MODEL || 'qwen3:14b';

function getOllamaBase() {
  return process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
}

function getConfiguredDefaultModel() {
  return DEFAULT_LARGE_MODEL;
}

function parseModelBillions(name) {
  const match = String(name || '').match(/(\d+(?:\.\d+)?)\s*b\b/i);
  return match ? Number(match[1]) : 0;
}

function modelFamilyRank(name) {
  const value = String(name || '').toLowerCase();
  if (value.includes('qwen3')) return 500;
  if (value.includes('qwen2.5')) return 450;
  if (value.includes('qwen2')) return 425;
  if (value.includes('deepseek')) return 375;
  if (value.includes('llama3')) return 325;
  return 0;
}

function pickPreferredModel(models = [], configuredDefault = getConfiguredDefaultModel()) {
  const candidates = Array.isArray(models) ? models.filter(Boolean) : [];
  if (candidates.length === 0) return configuredDefault;
  if (configuredDefault && candidates.includes(configuredDefault)) return configuredDefault;

  return [...candidates]
    .sort((left, right) => {
      const sizeDiff = parseModelBillions(right) - parseModelBillions(left);
      if (sizeDiff !== 0) return sizeDiff;
      const familyDiff = modelFamilyRank(right) - modelFamilyRank(left);
      if (familyDiff !== 0) return familyDiff;
      return left.localeCompare(right);
    })[0];
}

function resolveModel(requestedModel) {
  return String(requestedModel || '').trim() || getConfiguredDefaultModel();
}

function compactErrorData(data) {
  if (data == null) return undefined;
  if (typeof data === 'string') return data.slice(0, 300);
  try {
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return 'unserializable_error_data';
  }
}

function buildChatError(message, reason, status, details) {
  const err = new Error(message);
  err.reason = reason;
  err.status = status;
  if (details) err.details = details;
  return err;
}

async function checkHealth() {
  try {
    const res = await axios.get(`${getOllamaBase()}/api/tags`, { timeout: 5000 });
    const models = (res.data.models || []).map((m) => m.name);
    const configuredDefault = getConfiguredDefaultModel();
    const recommendedModel = pickPreferredModel(models, configuredDefault);
    if (models.length === 0) {
      return { online: true, models, reason: 'no_models', defaultModel: configuredDefault, recommendedModel };
    }
    return { online: true, models, reason: 'ok', defaultModel: configuredDefault, recommendedModel };
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      return {
        online: false,
        models: [],
        reason: 'timeout',
        error: 'Ollama health check timed out',
        defaultModel: getConfiguredDefaultModel(),
        recommendedModel: getConfiguredDefaultModel(),
      };
    }
    return {
      online: false,
      models: [],
      reason: 'service_unreachable',
      error: err.message,
      defaultModel: getConfiguredDefaultModel(),
      recommendedModel: getConfiguredDefaultModel(),
    };
  }
}

async function chat(prompt, options = {}) {
  const model = resolveModel(options.model);
  if (!model || !model.trim()) {
    throw buildChatError('OLLAMA_MODEL is not configured', 'missing_model', 500);
  }

  try {
    const res = await axios.post(
      `${getOllamaBase()}/api/generate`,
      { model, prompt, stream: false },
      { timeout: 120000 }
    );
    return res.data.response || '';
  } catch (err) {
    if (!err.response) {
      if (err.code === 'ECONNABORTED') {
        throw buildChatError('Ollama request timed out', 'timeout', 504);
      }
      throw buildChatError('Cannot reach Ollama service', 'service_unreachable', 502, err.message);
    }

    const details = compactErrorData(err.response.data);
    const status = err.response.status;
    const detailsText = typeof details === 'string' ? details.toLowerCase() : '';
    if (status === 404 || detailsText.includes('model') && detailsText.includes('not found')) {
      throw buildChatError(`Model not found in Ollama: ${model}`, 'model_not_found', 404, details);
    }
    throw buildChatError('Ollama inference failed', 'inference_failed', status, details);
  }
}

function buildAnalysisPrompt(issues, lang = 'en') {
  const lang_intro = lang === 'de'
    ? 'Antworte strikt auf Deutsch. Beantworte als technischer Product Owner. Schreibe alle Freitext-Felder auf Deutsch.'
    : 'Reply in English. Answer as a technical Product Owner.';

  const simplified = issues.slice(0, 15).map((i) => ({
    k: i.key,
    s: (i.fields.summary || '').slice(0, 80),
    st: i.fields.status?.name,
    p: i.fields.priority?.name,
    sp: i.fields.customfield_10016,
    spx: i.fields.customfield_10020 || null,
  }));

  return `${lang_intro}

You are analyzing ${issues.length} Jira tickets for a sprint and backlog healthcheck after a team was away (e.g. after vacation).
Below is a compact JSON excerpt of tickets. Field legend: k=key, s=summary, st=status, p=priority, sp=story points, spx=sprint.

${JSON.stringify(simplified)}
${JSON.stringify(simplified, null, 2)}

Produce ONLY valid JSON with exactly this structure:
{
  "summary": "2-4 sentence executive health summary",
  "plannedVsDone": {
    "periodAssumption": "short text describing what was interpreted as the active sprint/period",
    "plannedCount": number,
    "doneCount": number,
    "completionRate": number,
    "atRiskCount": number,
    "notes": "short explanation of confidence and limitations"
  },
  "sprintHealth": {
    "overall": "green|yellow|red",
    "blockers": ["..."],
    "deliveryRisks": ["..."],
    "followUps": ["..."]
  },
  "backlogRefinementCandidates": [
    {
      "key": "TICKET-123",
      "reason": "why this should be refined now",
      "missing": ["acceptance criteria", "estimate", "owner"]
    }
  ],
  "suggestions": [
    { "key": "TICKET-123", "text": "specific improvement" }
  ],
  "redundancies": [
    { "keys": ["A-1", "A-2"], "reason": "overlap reason" }
  ],
  "gaps": [
    { "text": "important missing information" }
  ],
  "slowTickets": [
    { "key": "TICKET-123", "daysOpen": number, "note": "why slow and what to do" }
  ]
}

Rules for quality:
- Be specific and evidence-based. Refer to concrete ticket keys whenever possible.
- Do not invent facts. If data is missing, say so in "notes", "gaps", "blockers", or "missing".
- Never invent ticket keys. Use only keys that exist in the provided JSON excerpt.
- If a finding has no valid key match, set key to null and still provide the textual finding.
- For planned vs done, infer "planned" from available signals (sprint field, fixVersion, dueDate, status timeline). If uncertain, keep confidence caveats explicit.
- backlogRefinementCandidates must prioritize unclear tickets (vague summary/description, missing estimate, unclear owner, missing acceptance criteria, stale updates).
- Keep every text concise and actionable.

Language rule:
- If language is German, every natural-language text field MUST be in German.
- Keep ticket keys and numbers unchanged.

Return ONLY valid JSON, no markdown fences, no extra commentary.`;
}

function buildIdeaEvalPrompt(ideaText, lang = 'en') {
  const lang_intro = lang === 'de'
    ? 'Antworte strikt auf Deutsch als technischer Product Owner. Schreibe alle Freitext-Felder auf Deutsch.'
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

Language rule:
- If language is German, fields "risks", "nextSteps" and "verdict" MUST be German text.
- Keep enum values feasibility/effort/value exactly as high|medium|low.

Return ONLY valid JSON.`;
}

function buildRefinementPrompt({
ticket,
availableComponents = [],
objectiveCandidates = [],
lang = 'en',
}) {
const langIntro = lang === 'de'
  ? 'Antworte strikt auf Deutsch als technischer Product Owner in einem Scrum-Umfeld. Schreibe alle Freitext-Felder auf Deutsch.'
  : 'Reply in English as a technical Product Owner working in Scrum.';

const compactTicket = {
  key: ticket?.key || null,
  summary: ticket?.summary || '',
  description: ticket?.description || '',
  comments: Array.isArray(ticket?.comments) ? ticket.comments.slice(0, 8) : [],
  status: ticket?.status || '',
  priority: ticket?.priority || '',
  currentComponents: Array.isArray(ticket?.components) ? ticket.components : [],
};

const simplifiedObjectives = objectiveCandidates.slice(0, 12).map((objective) => ({
  key: objective?.key || null,
  summary: objective?.summary || '',
  status: objective?.status || '',
}));

return `${langIntro}

You are helping refine a Jira ticket before Sprint Planning.
Use Scrum Product Backlog refinement principles: make the item clearer, more precise, and easier to discuss or select in planning.

Ticket:
${JSON.stringify(compactTicket, null, 2)}

Available product/component values for this Jira project:
${JSON.stringify(availableComponents, null, 2)}

Possible objective tickets from a modernization board:
${JSON.stringify(simplifiedObjectives, null, 2)}

Respond with ONLY valid JSON in exactly this shape:
{
"refinedSummary": "clearer backlog item title",
"refinedDescription": "improved description text ready for Jira",
"acceptanceCriteria": ["criterion 1", "criterion 2"],
"productComponent": {
  "name": "one component name from the provided list or empty string",
  "reason": "short reason"
},
"objectiveAlignment": {
  "objectiveKey": "OBJECTIVE-1 or null",
  "objectiveSummary": "summary or empty string",
  "confidence": "high|medium|low",
  "reason": "why this does or does not align"
},
"openQuestions": ["question 1", "question 2"]
}

Rules:
- Do not invent Jira keys, objectives, or component names.
- productComponent.name must either match one provided component exactly or be an empty string.
- If no objective is a credible fit, set objectiveKey to null and objectiveSummary to an empty string.
- Make acceptance criteria concrete and testable.
- Keep the refined description practical for software delivery teams.
- Mention missing information as open questions instead of inventing it.

Return ONLY valid JSON.`;
}

module.exports = {
  checkHealth,
  chat,
  buildAnalysisPrompt,
  buildIdeaEvalPrompt,
  buildRefinementPrompt,
  getConfiguredDefaultModel,
  pickPreferredModel,
  resolveModel,
  parseModelBillions,
};
