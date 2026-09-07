require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs/promises');
const path = require('path');
const {
  buildJiraClient,
  fetchProjects,
  fetchIssues,
  fetchBoards,
  fetchObjectives,
  fetchProjectComponents,
  fetchIssueTypes,
  fetchCreateMeta,
  fetchAcceptanceCriteriaFieldIds,
  createIssue,
  updateIssue,
  buildAgileHiveClient,
  fetchAgileHiveTeamMetrics,
  getJiraConfigStatus,
  classifyJiraError,
} = require('./src/jira');
const {
  checkHealth,
  chat,
  buildSmokeTestPrompt,
  buildAnalysisPrompt,
  buildFocusedAnalysisPrompt,
  buildIdeaEvalPrompt,
  buildRefinementPrompt,
  resolveModel,
} = require('./src/ollama');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory cache
const cache = { projects: null, issues: {}, lastRefresh: null };
const BOARD_STATE_FILE = process.env.BOARD_STATE_FILE || path.join(__dirname, 'data', 'board-state.json');
const TABLE_COLUMNS = ['ticket', 'summary', 'product', 'projectId', 'objective', 'points', 'priority', 'status', 'acceptance'];

function isValidProjectKey(projectKey) {
  return /^[A-Z][A-Z0-9]+$/.test(projectKey);
}

async function readBoardStateStore() {
  try {
    const raw = await fs.readFile(BOARD_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeBoardStateStore(store) {
  const dir = path.dirname(BOARD_STATE_FILE);
  const tmpFile = `${BOARD_STATE_FILE}.tmp`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpFile, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(tmpFile, BOARD_STATE_FILE);
}

function sanitizeBoardPlacements(placements) {
  if (!placements || typeof placements !== 'object' || Array.isArray(placements)) return {};
  const out = {};
  for (const [ticketKey, lane] of Object.entries(placements)) {
    const key = asText(ticketKey);
    const value = asText(lane);
    if (!key || !value) continue;
    if (value === 'backlog' || value === 'archive' || value.startsWith('sprint:')) {
      out[key] = value;
    }
  }
  return out;
}

function sanitizeBoardSprints(sprints) {
  if (!sprints || typeof sprints !== 'object' || Array.isArray(sprints)) return {};
  const out = {};
  for (const [sprintId, sprint] of Object.entries(sprints)) {
    const id = asText(sprintId);
    if (!id || !sprint || typeof sprint !== 'object' || Array.isArray(sprint)) continue;
    const state = asText(sprint.state).toLowerCase();
    out[id] = {
      id: asText(sprint.id) || id,
      name: asText(sprint.name) || id,
      state: ['active', 'future', 'closed'].includes(state) ? state : 'future',
      goal: asText(sprint.goal),
      startDate: asText(sprint.startDate),
      endDate: asText(sprint.endDate),
      completeDate: asText(sprint.completeDate),
    };
  }
  return out;
}

function sanitizeBoardState(input) {
  return {
    placements: sanitizeBoardPlacements(input?.placements),
    sprints: sanitizeBoardSprints(input?.sprints),
    showArchive: input?.showArchive !== false,
    planning: sanitizePlanningState(input?.planning),
    checklists: sanitizeBoardChecklists(input?.checklists),
    table: sanitizeBoardTable(input?.table),
  };
}

function sanitizeBoardTable(table) {
  const rawOrder = Array.isArray(table?.columnOrder) ? table.columnOrder : [];
  const seen = new Set();
  const cleaned = [];
  for (const column of rawOrder) {
    const id = asText(column);
    if (!TABLE_COLUMNS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    cleaned.push(id);
  }
  for (const required of TABLE_COLUMNS) {
    if (!seen.has(required)) cleaned.push(required);
  }
  const sortBy = TABLE_COLUMNS.includes(asText(table?.sortBy)) ? asText(table.sortBy) : '';
  const sortDir = asText(table?.sortDir).toLowerCase() === 'desc' ? 'desc' : 'asc';
  return {
    columnOrder: cleaned,
    sortBy,
    sortDir,
  };
}

function sanitizePlanningState(planning) {
  return {
    sprintGoalDraft: asText(planning?.sprintGoalDraft),
    openQuestions: asText(planning?.openQuestions),
    teamAbsences: asText(planning?.teamAbsences),
  };
}

function sanitizeTicketChecklistSection(section) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return {};
  const out = {};
  for (const [itemKey, checked] of Object.entries(section)) {
    const key = asText(itemKey);
    if (!key || typeof checked !== 'boolean') continue;
    out[key] = checked;
  }
  return out;
}

function sanitizeBoardChecklists(checklists) {
  if (!checklists || typeof checklists !== 'object' || Array.isArray(checklists)) return {};
  const out = {};
  for (const [ticketKey, state] of Object.entries(checklists)) {
    const key = asText(ticketKey);
    if (!key || !state || typeof state !== 'object' || Array.isArray(state)) continue;
    out[key] = {
      ready: sanitizeTicketChecklistSection(state.ready),
      done: sanitizeTicketChecklistSection(state.done),
    };
  }
  return out;
}

function getClient() {
  const cfg = getJiraConfigStatus();
  if (!cfg.ok) {
    const err = new Error(cfg.message);
    err.status = 500;
    err.reason = cfg.reason;
    throw err;
  }

  const c = buildJiraClient();
  if (!c) {
    const err = new Error('Jira not configured');
    err.status = 500;
    err.reason = 'missing_env';
    throw err;
  }
  return c;
}

function jiraErrorPayload(e) {
  if (e.reason && e.status) {
    return { status: e.status, body: { error: e.message, reason: e.reason } };
  }
  const info = classifyJiraError(e);
  return {
    status: info.status,
    body: { error: info.message, reason: info.reason, details: info.details },
  };
}

function asText(v) {
  if (v == null) return '';
  return String(v).trim();
}

function normalizeAcceptanceLines(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s*/, ''));
}

function toAcceptanceChecklistText(value) {
  const lines = normalizeAcceptanceLines(value);
  return lines
    .map((line) => {
      const checkbox = line.match(/^\[(x|X| )\]\s*(.+)$/);
      if (checkbox) {
        const checked = checkbox[1].toLowerCase() === 'x';
        const text = asText(checkbox[2]);
        if (!text) return '';
        return `[${checked ? 'x' : ' '}] ${text}`;
      }
      return `[ ] ${line}`;
    })
    .filter(Boolean)
    .join('\n');
}

function appendAcceptanceToDescription(description, acceptanceCriteria) {
  const base = asText(description);
  const checklist = toAcceptanceChecklistText(acceptanceCriteria);
  if (!checklist) return base;
  const sections = [];
  if (base) sections.push(base);
  sections.push(`Acceptance Criteria\n${checklist}`);
  return sections.join('\n\n').trim();
}

function normalizeAnalysis(parsed, issues) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;

  const knownKeys = new Set((issues || []).map((i) => asText(i?.key)).filter(Boolean));
  const normalizeKey = (k) => {
    const key = asText(k);
    return key && knownKeys.has(key) ? key : null;
  };
  const normalizeStructuredInsight = (entry, fallback = {}) => {
    const fromEntry = entry && typeof entry === 'object' ? entry : {};
    const problem = asText(fromEntry.problem || fallback.problem || fromEntry.text || fromEntry.reason || fromEntry.note);
    return {
      problem,
      suggestedAction: asText(fromEntry.suggestedAction || fallback.suggestedAction),
      expectedImpact: asText(fromEntry.expectedImpact || fallback.expectedImpact),
    };
  };

  const out = { ...parsed };

  const issueCount = Array.isArray(issues) ? issues.length : 0;
  const fieldPresence = (fieldGetter) => {
    if (!issueCount) return 0;
    let present = 0;
    for (const issue of issues) {
      if (fieldGetter(issue)) present += 1;
    }
    return present / issueCount;
  };
  const clampPercent = (value) => Math.max(5, Math.min(100, Math.round(value)));
  const baseConfidence = () => clampPercent(
    30
    + Math.min(30, issueCount * 1.5)
    + fieldPresence((issue) => asText(issue?.fields?.summary)) * 20
    + fieldPresence((issue) => asText(issue?.fields?.status?.name)) * 10
    + fieldPresence((issue) => asText(issue?.fields?.assignee?.displayName)) * 5
    + fieldPresence((issue) => asText(issue?.fields?.description)) * 5
  );
  const countConfidence = (entries) => {
    const total = Array.isArray(entries) ? entries.length : 0;
    if (total === 0) return 0;
    return clampPercent(40 + Math.min(35, total * 12) + Math.min(25, issueCount));
  };

  if (Array.isArray(out.suggestions)) {
    out.suggestions = out.suggestions.map((s) => ({
      key: normalizeKey(s?.key),
      ...normalizeStructuredInsight(s),
    }));
  }

  if (Array.isArray(out.slowTickets)) {
    out.slowTickets = out.slowTickets.map((s) => ({
      key: normalizeKey(s?.key),
      daysOpen: Number.isFinite(Number(s?.daysOpen)) ? Number(s.daysOpen) : null,
      ...normalizeStructuredInsight(s),
    }));
  }

  if (Array.isArray(out.backlogRefinementCandidates)) {
    out.backlogRefinementCandidates = out.backlogRefinementCandidates.map((c) => ({
      key: normalizeKey(c?.key),
      ...normalizeStructuredInsight(c),
      missing: Array.isArray(c?.missing) ? c.missing.map((m) => asText(m)).filter(Boolean) : [],
    }));
  }

  if (Array.isArray(out.redundancies)) {
    out.redundancies = out.redundancies.map((r) => ({
      keys: Array.isArray(r?.keys) ? r.keys.map((k) => normalizeKey(k)).filter(Boolean) : [],
      ...normalizeStructuredInsight(r),
    }));
  }

  if (Array.isArray(out.gaps)) {
    out.gaps = out.gaps.map((g) => {
      if (typeof g === 'string') return { key: null, ...normalizeStructuredInsight({ text: g }) };
      return {
        key: normalizeKey(g?.key),
        ...normalizeStructuredInsight(g),
      };
    });
  }

  out.confidence = typeof out.confidence === 'number' ? clampPercent(out.confidence) : baseConfidence();

  if (out.plannedVsDone && typeof out.plannedVsDone === 'object') {
    out.plannedVsDone = {
      ...out.plannedVsDone,
      confidence: typeof out.plannedVsDone.confidence === 'number'
        ? clampPercent(out.plannedVsDone.confidence)
        : clampPercent(baseConfidence() + (issueCount >= 5 ? 5 : -10)),
    };
  }

  if (out.sprintHealth && typeof out.sprintHealth === 'object') {
    out.sprintHealth = {
      ...out.sprintHealth,
      confidence: typeof out.sprintHealth.confidence === 'number'
        ? clampPercent(out.sprintHealth.confidence)
        : clampPercent(baseConfidence() + Math.min(10, issueCount)),
    };
  }

  if (Array.isArray(out.backlogRefinementCandidates)) {
    out.backlogRefinementCandidates = out.backlogRefinementCandidates.map((c) => ({
      ...c,
      confidence: typeof c?.confidence === 'number'
        ? clampPercent(c.confidence)
        : clampPercent(countConfidence(out.backlogRefinementCandidates) - (c?.missing?.length || 0) * 5),
    }));
  }

  return out;
}

// ── Jira routes ──────────────────────────────────────────────────────────────

app.get('/api/projects', async (req, res) => {
  try {
    const client = getClient();
    if (!cache.projects) {
      cache.projects = await fetchProjects(client);
    }
    res.json(cache.projects);
  } catch (e) {
    const payload = jiraErrorPayload(e);
    res.status(payload.status).json(payload.body);
  }
});

app.get('/api/issues/:projectKey', async (req, res) => {
  const { projectKey } = req.params;
  const force = req.query.force === 'true';
  if (!isValidProjectKey(projectKey)) {
    return res.status(400).json({ error: 'Invalid project key' });
  }
  try {
    const client = getClient();
    if (!cache.issues[projectKey] || force) {
      cache.issues[projectKey] = await fetchIssues(client, projectKey);
      cache.lastRefresh = new Date().toISOString();
    }
    res.json({ issues: cache.issues[projectKey], lastRefresh: cache.lastRefresh });
  } catch (e) {
    const payload = jiraErrorPayload(e);
    res.status(payload.status).json(payload.body);
  }
});

app.get('/api/board-state/:projectKey', async (req, res) => {
  const { projectKey } = req.params;
  if (!isValidProjectKey(projectKey)) {
    return res.status(400).json({ error: 'Invalid project key' });
  }
  try {
    const store = await readBoardStateStore();
    res.json(sanitizeBoardState(store[projectKey]));
  } catch (e) {
    res.status(500).json({ error: 'Failed to load board state' });
  }
});

app.put('/api/board-state/:projectKey', async (req, res) => {
  const { projectKey } = req.params;
  if (!isValidProjectKey(projectKey)) {
    return res.status(400).json({ error: 'Invalid project key' });
  }
  try {
    const store = await readBoardStateStore();
    const nextState = sanitizeBoardState(req.body);
    store[projectKey] = nextState;
    await writeBoardStateStore(store);
    res.json(nextState);
  } catch (e) {
    res.status(500).json({ error: 'Failed to persist board state' });
  }
});

app.get('/api/boards', async (req, res) => {
  try {
    const boards = await fetchBoards();
    res.json(boards);
  } catch (e) {
    const payload = jiraErrorPayload(e);
    res.status(payload.status).json(payload.body);
  }
});

app.get('/api/jira/components/:projectKey', async (req, res) => {
  const { projectKey } = req.params;
  if (!isValidProjectKey(projectKey)) {
    return res.status(400).json({ error: 'Invalid project key' });
  }
  try {
    const client = getClient();
    const components = await fetchProjectComponents(client, projectKey);
    res.json(components);
  } catch (e) {
    const payload = jiraErrorPayload(e);
    res.status(payload.status).json(payload.body);
  }
});

app.get('/api/jira/objectives', async (req, res) => {
  try {
    const result = await fetchObjectives();
    res.json(result);
  } catch (e) {
    const payload = jiraErrorPayload(e);
    res.status(payload.status).json(payload.body);
  }
});

app.get('/api/jira/agile-hive/:projectKey', async (req, res) => {
  const { projectKey } = req.params;
  if (!isValidProjectKey(projectKey)) {
    return res.status(400).json({ error: 'Invalid project key' });
  }
  try {
    const client = buildAgileHiveClient();
    if (!client) {
      const cfg = getJiraConfigStatus();
      return res.status(500).json({ error: cfg.message, reason: cfg.reason });
    }
    const intervalIdText = asText(req.query.intervalId);
    const intervalId = intervalIdText ? Number(intervalIdText) : null;
    const historyCountText = asText(req.query.historyCount);
    const historyCountNumber = historyCountText ? Number(historyCountText) : 3;
    const methodology = asText(req.query.methodology) || 'SCRUM';
    const jql = asText(req.query.jql);
    const data = await fetchAgileHiveTeamMetrics(client, projectKey, {
      intervalId: Number.isFinite(intervalId) ? intervalId : null,
      historyCount: Number.isFinite(historyCountNumber) && historyCountNumber > 0
        ? Math.min(12, Math.floor(historyCountNumber))
        : 3,
      methodology,
      jql,
    });
    res.json(data);
  } catch (e) {
    const payload = jiraErrorPayload(e);
    res.status(payload.status).json(payload.body);
  }
});

app.post('/api/refresh/:projectKey', async (req, res) => {
  const { projectKey } = req.params;
  try {
    const client = getClient();
    cache.issues[projectKey] = await fetchIssues(client, projectKey);
    cache.lastRefresh = new Date().toISOString();
    res.json({ ok: true, lastRefresh: cache.lastRefresh, count: cache.issues[projectKey].length });
  } catch (e) {
    const payload = jiraErrorPayload(e);
    res.status(payload.status).json(payload.body);
  }
});

app.get('/api/jira/health', async (req, res) => {
  const cfg = getJiraConfigStatus();
  if (!cfg.ok) {
    return res.status(500).json({ ok: false, reason: cfg.reason, error: cfg.message });
  }

  try {
    const client = getClient();
    const projects = await fetchProjects(client);
    return res.json({
      ok: true,
      reason: 'connected',
      projectCount: projects.length,
      baseUrl: cfg.normalizedBaseUrl,
      authType: cfg.authType,
    });
  } catch (e) {
    const payload = jiraErrorPayload(e);
    return res.status(payload.status).json({ ok: false, ...payload.body, baseUrl: cfg.normalizedBaseUrl });
  }
});

app.get('/api/jira/issue-types/:projectKey', async (req, res) => {
  const { projectKey } = req.params;
  try {
    const client = getClient();
    const issueTypes = await fetchIssueTypes(client, projectKey);
    res.json(issueTypes);
  } catch (e) {
    const payload = jiraErrorPayload(e);
    res.status(payload.status).json(payload.body);
  }
});

app.get('/api/jira/create-meta/:projectKey/:issueType', async (req, res) => {
  const { projectKey, issueType } = req.params;
  try {
    const client = getClient();
    const meta = await fetchCreateMeta(client, projectKey, issueType);
    res.json(meta);
  } catch (e) {
    const payload = jiraErrorPayload(e);
    res.status(payload.status).json(payload.body);
  }
});

// ── Jira write: sync tickets ──────────────────────────────────────────────────

const MAX_RETRIES = 5;
// Base delay for the first retry (ms). Each subsequent wait doubles, capped at MAX_RETRY_DELAY_MS.
// A poorly configured load balancer / unstable on-prem instance may need minutes to recover.
const BASE_RETRY_DELAY_MS = 30_000;   // 30 s
const MAX_RETRY_DELAY_MS  = 300_000;  // 5 min

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true when the error is transient and worth retrying.
 * Permanent client errors (400, 404, 422 …) are not retried.
 */
function isRetryable(err) {
  if (!err.response) return true; // network / timeout error
  const status = err.response.status;
  // 401 Unauthorized can be a transient auth-token hiccup on bad load balancers;
  // 5xx are always transient; 408/429 too.
  return status === 401 || status === 408 || status === 429 || status >= 500;
}

function retryDelayMs(attempt) {
  // Exponential back-off: 30 s, 60 s, 120 s, 240 s, 300 s (capped)
  return Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1), MAX_RETRY_DELAY_MS);
}

// POST /api/jira/sync
// Body: { projectKey: string, tickets: Array<{ summary, description?, issuetype? }> }
// Streams SSE events:
//   { type: 'progress', index, total, status: 'done'|'error', key?, error? }
//   { type: 'retrying', index, attempt, maxRetries, waitSeconds, summary }
//   { type: 'done', total, successCount, errorCount }
app.post('/api/jira/sync', async (req, res) => {
  const { projectKey, tickets } = req.body;
  if (!projectKey || !Array.isArray(tickets) || tickets.length === 0) {
    return res.status(400).json({ error: 'projectKey and non-empty tickets array required' });
  }
  if (!isValidProjectKey(projectKey)) {
    return res.status(400).json({ error: 'Invalid project key' });
  }

  let client;
  try {
    client = getClient();
  } catch (e) {
    const payload = jiraErrorPayload(e);
    return res.status(payload.status).json(payload.body);
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  const total = tickets.length;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < total; i++) {
    const ticket = tickets[i];
    let created = null;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        created = await createIssue(client, projectKey, ticket);
        break;
      } catch (e) {
        lastError = e.message;
        const retryable = isRetryable(e);
        if (attempt < MAX_RETRIES && retryable) {
          const waitMs = retryDelayMs(attempt);
          send({
            type: 'retrying',
            index: i,
            attempt,
            maxRetries: MAX_RETRIES,
            waitSeconds: Math.round(waitMs / 1000),
            summary: ticket.summary,
            error: lastError,
          });
          await sleep(waitMs);
        } else {
          // Non-retryable error or last attempt – give up immediately
          break;
        }
      }
    }

    if (created) {
      successCount++;
      send({ type: 'progress', index: i, total, status: 'done', key: created.key, summary: ticket.summary });
    } else {
      errorCount++;
      send({ type: 'progress', index: i, total, status: 'error', summary: ticket.summary, error: lastError });
    }
  }

  send({ type: 'done', total, successCount, errorCount });
  res.end();
});

app.put('/api/jira/issues/:issueKey', async (req, res) => {
  const { issueKey } = req.params;
  const rawFields = req.body?.fields;
  const acceptanceCriteria = asText(req.body?.acceptanceCriteria);
  const fields = rawFields && typeof rawFields === 'object' && !Array.isArray(rawFields)
    ? { ...rawFields }
    : null;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return res.status(400).json({ error: 'fields object required' });
  }
  try {
    const client = getClient();
    let acceptanceFieldId = null;
    if (acceptanceCriteria) {
      const acceptanceFieldIds = await fetchAcceptanceCriteriaFieldIds(client);
      acceptanceFieldId = acceptanceFieldIds[0] || null;
      if (acceptanceFieldId) {
        fields[acceptanceFieldId] = toAcceptanceChecklistText(acceptanceCriteria);
      } else {
        fields.description = appendAcceptanceToDescription(fields.description, acceptanceCriteria);
      }
    }
    const result = await updateIssue(client, issueKey, fields);
    res.json({ ...result, acceptanceFieldId, acceptanceFallbackToDescription: Boolean(acceptanceCriteria && !acceptanceFieldId) });
  } catch (e) {
    const payload = jiraErrorPayload(e);
    res.status(payload.status).json(payload.body);
  }
});


app.get('/api/llm/health', async (req, res) => {
  const result = await checkHealth();
  res.json(result);
});

app.post('/api/llm/smoke-test', async (req, res) => {
  const requestedModel = asText(req.body?.model);
  const model = resolveModel(requestedModel);
  try {
    const startedAt = Date.now();
    const response = asText(await chat(buildSmokeTestPrompt(), { model })).replace(/\s+/g, ' ');
    const normalized = response.toLowerCase().replace(/[^a-z0-9]+/g, '');
    res.json({
      ok: normalized.includes('pong'),
      model,
      prompt: buildSmokeTestPrompt(),
      response,
      durationMs: Date.now() - startedAt,
    });
  } catch (e) {
    res.status(e.status || 500).json({
      ok: false,
      model,
      error: e.message,
      reason: e.reason || 'llm_error',
    });
  }
});

app.post('/api/llm/analyze/:projectKey', async (req, res) => {
  const { projectKey } = req.params;
  const lang = req.query.lang || 'en';
  const model = asText(req.body?.model);
  const focus = asText(req.body?.focus) || 'overview';
  try {
    const client = getClient();
    if (!cache.issues[projectKey] || cache.issues[projectKey].length === 0) {
      cache.issues[projectKey] = await fetchIssues(client, projectKey);
      cache.lastRefresh = new Date().toISOString();
    }
    const issues = cache.issues[projectKey];
    if (!issues || issues.length === 0) {
      return res.status(400).json({ error: 'No issues available for analysis.' });
    }
    const prompt = focus === 'overview'
      ? buildAnalysisPrompt(issues, lang)
      : buildFocusedAnalysisPrompt(issues, focus, lang);
    const raw = await chat(prompt, { model });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }
    res.json({
      ...normalizeAnalysis(parsed, issues),
      coverage: {
        focus,
        analyzedTickets: issues.length,
        usedAllTickets: focus !== 'overview',
        sampledTickets: focus === 'overview' ? Math.min(15, issues.length) : issues.length,
      },
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, reason: e.reason || 'llm_error' });
  }
});

app.post('/api/llm/evaluate-idea', async (req, res) => {
  const { idea, lang = 'en', model } = req.body;
  if (!idea) return res.status(400).json({ error: 'idea required' });
  try {
    const prompt = buildIdeaEvalPrompt(idea, lang);
    const raw = await chat(prompt, { model: asText(model) });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }
    res.json(parsed);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, reason: e.reason || 'llm_error' });
  }
});

function normalizeRefinementSuggestion(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      refinedSummary: '',
      refinedDescription: '',
      acceptanceCriteria: [],
      productComponent: { name: '', reason: '' },
      objectiveAlignment: { objectiveKey: null, objectiveSummary: '', confidence: 'low', reason: '' },
      openQuestions: [],
    };
  }

  const confidence = asText(parsed?.objectiveAlignment?.confidence).toLowerCase();
  return {
    refinedSummary: asText(parsed.refinedSummary),
    refinedDescription: asText(parsed.refinedDescription),
    acceptanceCriteria: Array.isArray(parsed.acceptanceCriteria)
      ? parsed.acceptanceCriteria.map((entry) => asText(entry)).filter(Boolean)
      : [],
    productComponent: {
      name: asText(parsed?.productComponent?.name),
      reason: asText(parsed?.productComponent?.reason),
    },
    objectiveAlignment: {
      objectiveKey: asText(parsed?.objectiveAlignment?.objectiveKey) || null,
      objectiveSummary: asText(parsed?.objectiveAlignment?.objectiveSummary),
      confidence: ['high', 'medium', 'low'].includes(confidence) ? confidence : 'low',
      reason: asText(parsed?.objectiveAlignment?.reason),
    },
    openQuestions: Array.isArray(parsed.openQuestions)
      ? parsed.openQuestions.map((entry) => asText(entry)).filter(Boolean)
      : [],
  };
}

app.post('/api/llm/refine-ticket', async (req, res) => {
  const { ticket, availableComponents = [], objectiveCandidates = [], lang = 'en', model } = req.body || {};
  if (!ticket || typeof ticket !== 'object') {
    return res.status(400).json({ error: 'ticket object required' });
  }
  try {
    const prompt = buildRefinementPrompt({ ticket, availableComponents, objectiveCandidates, lang });
    const raw = await chat(prompt, { model: asText(model) });
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    res.json(normalizeRefinementSuggestion(parsed));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, reason: e.reason || 'llm_error' });
  }
});

// ── Auto-refresh cron (hourly) ────────────────────────────────────────────────

function scheduleRefreshJob() {
  return cron.schedule('0 * * * *', async () => {
    const client = buildJiraClient();
    if (!client) return;
    const keys = Object.keys(cache.issues);
    for (const key of keys) {
      try {
        cache.issues[key] = await fetchIssues(client, key);
        cache.lastRefresh = new Date().toISOString();
        console.log(`[cron] refreshed ${key}`);
      } catch (e) {
        console.error(`[cron] failed ${key}:`, e.message);
      }
    }
  });
}

function startServer(port = process.env.PORT || 3001) {
  return app.listen(port, () => console.log(`Axon server running on :${port}`));
}

if (require.main === module) {
  scheduleRefreshJob();
  startServer();
}

module.exports = {
  app,
  cache,
  startServer,
  scheduleRefreshJob,
  isValidProjectKey,
  sanitizeBoardPlacements,
  sanitizeBoardSprints,
  sanitizeBoardState,
  sanitizePlanningState,
  sanitizeBoardChecklists,
  sanitizeBoardTable,
  normalizeAnalysis,
  normalizeRefinementSuggestion,
  isRetryable,
  retryDelayMs,
};
