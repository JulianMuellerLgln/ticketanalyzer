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
  fetchIssueTypes,
  fetchCreateMeta,
  createIssue,
  getJiraConfigStatus,
  classifyJiraError,
} = require('./src/jira');
const { checkHealth, chat, buildAnalysisPrompt, buildIdeaEvalPrompt } = require('./src/ollama');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory cache
const cache = { projects: null, issues: {}, lastRefresh: null };
const BOARD_STATE_FILE = process.env.BOARD_STATE_FILE || path.join(__dirname, 'data', 'board-state.json');

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
  };
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

function normalizeAnalysis(parsed, issues) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;

  const knownKeys = new Set((issues || []).map((i) => asText(i?.key)).filter(Boolean));
  const normalizeKey = (k) => {
    const key = asText(k);
    return key && knownKeys.has(key) ? key : null;
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
      text: asText(s?.text),
    }));
  }

  if (Array.isArray(out.slowTickets)) {
    out.slowTickets = out.slowTickets.map((s) => ({
      key: normalizeKey(s?.key),
      daysOpen: Number.isFinite(Number(s?.daysOpen)) ? Number(s.daysOpen) : null,
      note: asText(s?.note),
    }));
  }

  if (Array.isArray(out.backlogRefinementCandidates)) {
    out.backlogRefinementCandidates = out.backlogRefinementCandidates.map((c) => ({
      key: normalizeKey(c?.key),
      reason: asText(c?.reason),
      missing: Array.isArray(c?.missing) ? c.missing.map((m) => asText(m)).filter(Boolean) : [],
    }));
  }

  if (Array.isArray(out.redundancies)) {
    out.redundancies = out.redundancies.map((r) => ({
      keys: Array.isArray(r?.keys) ? r.keys.map((k) => normalizeKey(k)).filter(Boolean) : [],
      reason: asText(r?.reason),
    }));
  }

  if (Array.isArray(out.gaps)) {
    out.gaps = out.gaps.map((g) => {
      if (typeof g === 'string') return { text: asText(g) };
      return { text: asText(g?.text) };
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


app.get('/api/llm/health', async (req, res) => {
  const result = await checkHealth();
  res.json(result);
});

app.post('/api/llm/analyze/:projectKey', async (req, res) => {
  const { projectKey } = req.params;
  const lang = req.query.lang || 'en';
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
    const prompt = buildAnalysisPrompt(issues, lang);
    const raw = await chat(prompt);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }
    res.json(normalizeAnalysis(parsed, issues));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, reason: e.reason || 'llm_error' });
  }
});

app.post('/api/llm/evaluate-idea', async (req, res) => {
  const { idea, lang = 'en' } = req.body;
  if (!idea) return res.status(400).json({ error: 'idea required' });
  try {
    const prompt = buildIdeaEvalPrompt(idea, lang);
    const raw = await chat(prompt);
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
  normalizeAnalysis,
  isRetryable,
  retryDelayMs,
};
