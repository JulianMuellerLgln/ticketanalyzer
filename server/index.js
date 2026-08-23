require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { buildJiraClient, fetchProjects, fetchIssues, fetchBoards } = require('./src/jira');
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

// ── Ollama routes ─────────────────────────────────────────────────────────────

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
