require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { buildJiraClient, fetchProjects, fetchIssues, fetchBoards, createIssue } = require('./src/jira');
const { checkHealth, chat, buildAnalysisPrompt, buildIdeaEvalPrompt } = require('./src/ollama');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory cache
const cache = { projects: null, issues: {}, lastRefresh: null };

function getClient() {
  const c = buildJiraClient();
  if (!c) throw new Error('Jira not configured');
  return c;
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
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/issues/:projectKey', async (req, res) => {
  const { projectKey } = req.params;
  const force = req.query.force === 'true';
  try {
    const client = getClient();
    if (!cache.issues[projectKey] || force) {
      cache.issues[projectKey] = await fetchIssues(client, projectKey);
      cache.lastRefresh = new Date().toISOString();
    }
    res.json({ issues: cache.issues[projectKey], lastRefresh: cache.lastRefresh });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/boards', async (req, res) => {
  try {
    const boards = await fetchBoards();
    res.json(boards);
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
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
  if (!/^[A-Z][A-Z0-9]+$/.test(projectKey)) {
    return res.status(400).json({ error: 'Invalid project key' });
  }

  let client;
  try {
    client = getClient();
  } catch (e) {
    return res.status(500).json({ error: e.message });
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
  const issues = cache.issues[projectKey];
  if (!issues || issues.length === 0) {
    return res.status(400).json({ error: 'No issues cached. Refresh first.' });
  }
  try {
    const prompt = buildAnalysisPrompt(issues, lang);
    const raw = await chat(prompt);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

// ── Auto-refresh cron (hourly) ────────────────────────────────────────────────

cron.schedule('0 * * * *', async () => {
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Axon server running on :${PORT}`));
