const axios = require('axios');
const DEFAULT_SPRINT_FIELD_IDS = ['customfield_10005', 'customfield_10020'];
const DEFAULT_ESTIMATE_FIELD_IDS = ['customfield_10016'];
const PROJECT_ID_FIELD_NAME_HINTS = [
  'project id',
  'projekt id',
  'projekt-id',
  'projektkennung',
  'modernisierungsprojekt',
  'modernisierung',
  'pa-',
];
const ACCEPTANCE_FIELD_NAME_HINTS = [
  'akzeptanzkriterien',
  'akzeptanzkriterium',
  'acceptance criteria',
  'acceptance criterion',
];
let cachedSprintFieldIds = null;
let cachedEstimateFieldIds = null;
let cachedProjectIdFieldIds = null;
let cachedAcceptanceFieldIds = null;

function normalizeBaseUrl(raw) {
  const value = (raw || '').trim().replace(/\/$/, '');
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('JIRA_BASE_URL must start with http:// or https://');
  }
  return parsed.toString().replace(/\/$/, '');
}

function getJiraConfigStatus() {
  const {
    JIRA_BASE_URL,
    JIRA_API_TOKEN,
    JIRA_USER_EMAIL,
    JIRA_AUTH_TYPE = 'basic',
  } = process.env;
  const missing = [];
  const authType = JIRA_AUTH_TYPE.trim().toLowerCase();

  if (!['basic', 'bearer'].includes(authType)) {
    return {
      ok: false,
      reason: 'invalid_auth_type',
      message: 'JIRA_AUTH_TYPE must be basic or bearer',
    };
  }

  if (!JIRA_BASE_URL) missing.push('JIRA_BASE_URL');
  if (!JIRA_API_TOKEN) missing.push('JIRA_API_TOKEN');
  if (authType === 'basic' && !JIRA_USER_EMAIL) missing.push('JIRA_USER_EMAIL');

  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'missing_env',
      message: `Missing Jira config: ${missing.join(', ')}`,
    };
  }

  try {
    const normalizedBaseUrl = normalizeBaseUrl(JIRA_BASE_URL);
    return { ok: true, reason: 'ok', message: 'ok', normalizedBaseUrl, authType };
  } catch (err) {
    return {
      ok: false,
      reason: 'invalid_url',
      message: err.message,
    };
  }
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

function classifyJiraError(err) {
  if (!err.response) {
    if (err.code === 'ECONNABORTED') {
      return {
        reason: 'timeout',
        status: 504,
        message: 'Jira request timed out',
        details: err.message,
      };
    }
    return {
      reason: 'network',
      status: 502,
      message: 'Cannot reach Jira instance',
      details: err.message,
    };
  }

  const status = err.response.status;
  const details = compactErrorData(err.response.data);
  if (status === 401 || status === 403) {
    return {
      reason: 'auth',
      status,
      message: 'Jira authentication failed',
      details,
    };
  }
  if (status === 404) {
    return {
      reason: 'endpoint',
      status,
      message: 'Jira endpoint not found. Check JIRA_BASE_URL',
      details,
    };
  }
  if (status === 429) {
    return {
      reason: 'rate_limit',
      status,
      message: 'Jira rate limit reached',
      details,
    };
  }
  if (status >= 500) {
    return {
      reason: 'upstream',
      status,
      message: 'Jira upstream server error',
      details,
    };
  }

  return {
    reason: 'unknown',
    status,
    message: err.message || 'Jira request failed',
    details,
  };
}

function buildJiraClient() {
  const status = getJiraConfigStatus();
  if (!status.ok) return null;

  const headers = { 'Content-Type': 'application/json' };
  const auth = status.authType === 'basic'
    ? { username: process.env.JIRA_USER_EMAIL, password: process.env.JIRA_API_TOKEN }
    : undefined;
  if (status.authType === 'bearer') {
    headers.Authorization = `Bearer ${process.env.JIRA_API_TOKEN}`;
  }

  return axios.create({
    baseURL: `${status.normalizedBaseUrl}/rest/api/2`,
    auth,
    headers,
    timeout: 30000,
  });
}

function pickAllowedValue(v) {
  if (!v || typeof v !== 'object') return v;
  const base = {};
  if (v.id != null) base.id = String(v.id);
  if (v.key != null) base.key = String(v.key);
  if (v.value != null) base.value = String(v.value);
  if (v.name != null) base.name = String(v.name);
  if (v.accountId != null) base.accountId = String(v.accountId);
  if (v.displayName != null) base.displayName = String(v.displayName);
  if (Array.isArray(v.children) && v.children.length > 0) {
    base.children = v.children.map((c) => pickAllowedValue(c));
  }
  return base;
}

function sanitizeCreateFields(fields) {
  const result = {};
  for (const [fieldId, field] of Object.entries(fields || {})) {
    result[fieldId] = {
      name: field.name,
      required: Boolean(field.required),
      hasDefaultValue: Boolean(field.hasDefaultValue),
      schema: field.schema
        ? {
            type: field.schema.type,
            system: field.schema.system,
            custom: field.schema.custom,
            customId: field.schema.customId,
            items: field.schema.items,
          }
        : null,
      allowedValues: Array.isArray(field.allowedValues)
        ? field.allowedValues.map((v) => pickAllowedValue(v))
        : [],
    };
  }
  return result;
}

async function fetchIssueTypes(client, projectKey) {
  try {
    const res = await client.get('/issue/createmeta', {
      params: {
        projectKeys: projectKey,
        expand: 'projects.issuetypes',
      },
    });
    const projects = res.data?.projects || [];
    const project = projects[0];
    return (project?.issuetypes || []).map((it) => ({
      id: it.id,
      name: it.name,
      description: it.description || '',
      subtask: Boolean(it.subtask),
    }));
  } catch (err) {
    if (err.response?.status !== 404) throw err;
  }

  const fallback = await client.get(`/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`);
  const issueTypes = fallback.data?.values || fallback.data?.issueTypes || [];
  return issueTypes.map((it) => ({
    id: it.id,
    name: it.name,
    description: it.description || '',
    subtask: Boolean(it.subtask),
  }));
}

async function fetchCreateMeta(client, projectKey, issueTypeName) {
  try {
    const res = await client.get('/issue/createmeta', {
      params: {
        projectKeys: projectKey,
        issuetypeNames: issueTypeName,
        expand: 'projects.issuetypes.fields',
      },
    });

    const project = (res.data?.projects || [])[0];
    const issueType = (project?.issuetypes || [])[0];
    if (!issueType) {
      return { issueTypeName, fields: {} };
    }

    return {
      issueTypeName: issueType.name,
      fields: sanitizeCreateFields(issueType.fields || {}),
    };
  } catch (err) {
    if (err.response?.status !== 404) throw err;
  }

  const issueTypes = await fetchIssueTypes(client, projectKey);
  const selected = issueTypes.find((it) => it.name === issueTypeName) || issueTypes[0];
  if (!selected?.id) {
    return { issueTypeName, fields: {} };
  }

  const fallback = await client.get(
    `/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(selected.id)}`
  );
  const values = fallback.data?.values;
  const rawFields = Array.isArray(values)
    ? values.reduce((acc, field) => {
        const fieldId = field.fieldId || field.key || field.id;
        if (fieldId) acc[fieldId] = field;
        return acc;
      }, {})
    : (fallback.data?.fields || {});

  return {
    issueTypeName: selected.name,
    fields: sanitizeCreateFields(rawFields),
  };
}

async function fetchProjects(client) {
  const res = await client.get('/project');
  return res.data;
}

async function fetchSprintFieldIds(client) {
  if (Array.isArray(cachedSprintFieldIds) && cachedSprintFieldIds.length > 0) {
    return cachedSprintFieldIds;
  }

  try {
    const res = await client.get('/field');
    const sprintFields = (res.data || [])
      .filter((field) => field?.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')
      .map((field) => String(field.id || '').trim())
      .filter(Boolean);
    cachedSprintFieldIds = sprintFields.length > 0 ? sprintFields : DEFAULT_SPRINT_FIELD_IDS;
  } catch {
    cachedSprintFieldIds = DEFAULT_SPRINT_FIELD_IDS;
  }

  return cachedSprintFieldIds;
}

function estimateFieldScore(field) {
  const name = String(field?.name || '').toLowerCase();
  const custom = String(field?.schema?.custom || '').toLowerCase();
  let score = 0;
  if (name === 'story points') score += 100;
  if (name.includes('story point estimate')) score += 90;
  if (name.includes('story point')) score += 70;
  if (name.includes('sprint point')) score += 50;
  if (custom.includes('float')) score += 10;
  return score;
}

function projectIdFieldScore(field) {
  const name = String(field?.name || '').trim().toLowerCase();
  const schemaType = String(field?.schema?.type || '').toLowerCase();
  const custom = String(field?.schema?.custom || '').toLowerCase();
  if (!name) return 0;

  let score = 0;
  if (name === 'project id' || name === 'projekt-id' || name === 'projekt id') score += 240;
  if (name.includes('projekt') && name.includes('id')) score += 140;
  if (name.includes('project') && name.includes('id')) score += 120;
  for (const hint of PROJECT_ID_FIELD_NAME_HINTS) {
    if (name.includes(hint)) score += 40;
  }
  if (schemaType === 'string') score += 20;
  if (schemaType === 'option') score += 30;
  if (custom.includes('select')) score += 20;
  return score;
}

function acceptanceFieldScore(field) {
  const name = String(field?.name || '').trim().toLowerCase();
  const schemaType = String(field?.schema?.type || '').toLowerCase();
  const custom = String(field?.schema?.custom || '').toLowerCase();
  if (!name) return 0;

  let score = 0;
  if (name === 'akzeptanzkriterien' || name === 'acceptance criteria') score += 220;
  for (const hint of ACCEPTANCE_FIELD_NAME_HINTS) {
    if (name.includes(hint)) score += 80;
  }
  if (schemaType === 'string') score += 20;
  if (custom.includes('textarea')) score += 20;
  return score;
}

async function fetchEstimateFieldIds(client) {
  if (Array.isArray(cachedEstimateFieldIds) && cachedEstimateFieldIds.length > 0) {
    return cachedEstimateFieldIds;
  }

  try {
    const res = await client.get('/field');
    const estimateFields = (res.data || [])
      .map((field) => ({ id: String(field?.id || '').trim(), score: estimateFieldScore(field) }))
      .filter((field) => field.id && field.score > 0)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .map((field) => field.id);

    cachedEstimateFieldIds = estimateFields.length > 0 ? estimateFields : DEFAULT_ESTIMATE_FIELD_IDS;
  } catch {
    cachedEstimateFieldIds = DEFAULT_ESTIMATE_FIELD_IDS;
  }

  return cachedEstimateFieldIds;
}

async function fetchProjectIdFieldIds(client) {
  if (Array.isArray(cachedProjectIdFieldIds) && cachedProjectIdFieldIds.length > 0) {
    return cachedProjectIdFieldIds;
  }

  try {
    const res = await client.get('/field');
    const projectIdFields = (res.data || [])
      .map((field) => ({ id: String(field?.id || '').trim(), score: projectIdFieldScore(field) }))
      .filter((field) => field.id && field.score > 0)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .map((field) => field.id);
    cachedProjectIdFieldIds = projectIdFields;
  } catch {
    cachedProjectIdFieldIds = [];
  }

  return cachedProjectIdFieldIds;
}

function valueToProjectIdText(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (!value || typeof value !== 'object') return '';
  const fromOption = String(value.value || value.name || value.key || value.id || '').trim();
  if (fromOption) return fromOption;
  return '';
}

async function fetchAcceptanceCriteriaFieldIds(client) {
  if (Array.isArray(cachedAcceptanceFieldIds) && cachedAcceptanceFieldIds.length > 0) {
    return cachedAcceptanceFieldIds;
  }

  try {
    const res = await client.get('/field');
    const acceptanceFields = (res.data || [])
      .map((field) => ({ id: String(field?.id || '').trim(), score: acceptanceFieldScore(field) }))
      .filter((field) => field.id && field.score > 0)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .map((field) => field.id);
    cachedAcceptanceFieldIds = acceptanceFields;
  } catch {
    cachedAcceptanceFieldIds = [];
  }

  return cachedAcceptanceFieldIds;
}

function injectDerivedEstimate(issue, estimateFieldIds) {
  const fields = issue?.fields;
  if (!fields || typeof fields !== 'object') return issue;
  for (const fieldId of estimateFieldIds || []) {
    const value = Number(fields[fieldId]);
    if (Number.isFinite(value)) {
      fields.__storyPoints = value;
      fields.__storyPointFieldId = fieldId;
      return issue;
    }
  }
  fields.__storyPoints = 0;
  fields.__storyPointFieldId = '';
  return issue;
}

function injectDerivedProjectId(issue, projectIdFieldIds) {
  const fields = issue?.fields;
  if (!fields || typeof fields !== 'object') return issue;
  for (const fieldId of projectIdFieldIds || []) {
    const rawValue = fields[fieldId];
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const first = values
      .map((value) => valueToProjectIdText(value))
      .find((value) => Boolean(value));
    if (first) {
      fields.__projectId = first;
      fields.__projectIdFieldId = fieldId;
      return issue;
    }
  }
  fields.__projectId = '';
  fields.__projectIdFieldId = '';
  return issue;
}

async function fetchIssues(client, projectKey, maxResults = 100) {
  if (!/^[A-Z][A-Z0-9]+$/.test(projectKey)) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }
  const sprintFieldIds = await fetchSprintFieldIds(client);
  const estimateFieldIds = await fetchEstimateFieldIds(client);
  const projectIdFieldIds = await fetchProjectIdFieldIds(client);
  const dynamicFieldIds = [...new Set([...sprintFieldIds, ...estimateFieldIds, ...projectIdFieldIds])];
  const requestedMaxResults = Number(maxResults);
  const pageSize = Number.isFinite(requestedMaxResults) && requestedMaxResults > 0
    ? Math.floor(requestedMaxResults)
    : 100;
  const fields = [
    'summary', 'status', 'priority', 'assignee', 'reporter',
    'created', 'updated', 'duedate', 'resolutiondate', 'description',
    'issuetype', 'labels', 'components', 'fixVersions',
    'comment',
    ...dynamicFieldIds,
  ].join(',');
  const allIssues = [];
  let startAt = 0;
  let total = Number.POSITIVE_INFINITY;

  while (startAt < total) {
    const res = await client.get('/search', {
      params: {
        jql: `project = ${projectKey} ORDER BY updated DESC`,
        startAt,
        maxResults: pageSize,
        fields,
      },
    });
    const batch = res.data?.issues || [];
    allIssues.push(
      ...batch.map((issue) => injectDerivedProjectId(injectDerivedEstimate(issue, estimateFieldIds), projectIdFieldIds))
    );
    const reportedTotal = Number(res.data?.total);
    total = Number.isFinite(reportedTotal) && reportedTotal >= 0 ? reportedTotal : startAt + batch.length;
    if (batch.length === 0) break;
    startAt += batch.length;
  }

  return allIssues;
}

function buildAgileClient() {
  const status = getJiraConfigStatus();
  if (!status.ok) return null;

  const headers = { 'Content-Type': 'application/json' };
  const auth = status.authType === 'basic'
    ? { username: process.env.JIRA_USER_EMAIL, password: process.env.JIRA_API_TOKEN }
    : undefined;
  if (status.authType === 'bearer') {
    headers.Authorization = `Bearer ${process.env.JIRA_API_TOKEN}`;
  }

  return axios.create({
    baseURL: `${status.normalizedBaseUrl}/rest/agile/1.0`,
    auth,
    headers,
    timeout: 30000,
  });
}

function buildAgileHiveClient() {
  const status = getJiraConfigStatus();
  if (!status.ok) return null;

  const headers = { 'Content-Type': 'application/json' };
  const auth = status.authType === 'basic'
    ? { username: process.env.JIRA_USER_EMAIL, password: process.env.JIRA_API_TOKEN }
    : undefined;
  if (status.authType === 'bearer') {
    headers.Authorization = `Bearer ${process.env.JIRA_API_TOKEN}`;
  }

  return axios.create({
    baseURL: `${status.normalizedBaseUrl}/rest/agilehive/latest`,
    auth,
    headers,
    timeout: 30000,
  });
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function metricPercent(progress, total) {
  const p = toNumber(progress);
  const t = toNumber(total);
  if (t > 0) return Math.round((p / t) * 100);
  if (p > 0) return Math.round(p);
  return 0;
}

function mapPiStatistics(piStatistics = {}) {
  const stats = piStatistics || {};
  const spBurned = stats.spBurned || {};
  const daysPassed = stats.daysPassed || {};
  const businessValue = stats.businessValue || {};
  const loadVsCap = stats.loadVsCap || {};
  return {
    spPerDay: toNumber(stats.spPerDay),
    velocity: toNumber(stats.averageVelocity),
    spBurned: {
      progress: toNumber(spBurned.progress),
      total: toNumber(spBurned.total),
      percent: metricPercent(spBurned.progress, spBurned.total),
    },
    daysPassed: {
      progress: toNumber(daysPassed.progress),
      total: toNumber(daysPassed.total),
      percent: metricPercent(daysPassed.progress, daysPassed.total),
    },
    businessValue: {
      progress: toNumber(businessValue.progress),
      total: toNumber(businessValue.total),
      percent: metricPercent(businessValue.progress, businessValue.total),
    },
    loadVsCap: {
      progress: toNumber(loadVsCap.progress),
      total: toNumber(loadVsCap.total),
      percent: metricPercent(loadVsCap.progress, loadVsCap.total),
    },
  };
}

function pickRecentCompletedIntervals(intervals = [], count = 3, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const parsed = (Array.isArray(intervals) ? intervals : [])
    .map((interval) => ({
      ...interval,
      id: Number(interval?.id),
      endMs: Date.parse(interval?.endDate || ''),
    }))
    .filter((interval) => Number.isFinite(interval.id))
    .sort((left, right) => {
      const leftEnd = Number.isFinite(left.endMs) ? left.endMs : Number.MIN_SAFE_INTEGER;
      const rightEnd = Number.isFinite(right.endMs) ? right.endMs : Number.MIN_SAFE_INTEGER;
      if (rightEnd !== leftEnd) return rightEnd - leftEnd;
      return right.id - left.id;
    });
  const completed = parsed.filter((interval) => Number.isFinite(interval.endMs) && interval.endMs <= nowMs);
  const source = completed.length > 0 ? completed : parsed;
  return source.slice(0, Math.max(1, Number(count) || 3));
}

function average(values = [], digits = 1) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const valid = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (valid.length === 0) return 0;
  const scale = 10 ** digits;
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * scale) / scale;
}

function trend(latest, earliest, epsilon = 0.5, digits = 1) {
  const l = Number(latest);
  const e = Number(earliest);
  if (!Number.isFinite(l) || !Number.isFinite(e)) {
    return { direction: 'flat', delta: 0 };
  }
  const scale = 10 ** digits;
  const delta = Math.round((l - e) * scale) / scale;
  if (Math.abs(delta) < epsilon) return { direction: 'flat', delta };
  return { direction: delta > 0 ? 'up' : 'down', delta };
}

function pickPlanningInterval(intervals = [], now = new Date(), preferredIntervalId = null) {
  const parsed = (Array.isArray(intervals) ? intervals : [])
    .map((interval) => ({
      ...interval,
      id: Number(interval?.id),
      startMs: Date.parse(interval?.startDate || ''),
      endMs: Date.parse(interval?.endDate || ''),
    }))
    .filter((interval) => Number.isFinite(interval.id));
  if (parsed.length === 0) return null;

  if (preferredIntervalId != null) {
    const preferred = parsed.find((entry) => entry.id === Number(preferredIntervalId));
    if (preferred) return { interval: preferred, strategy: 'explicit' };
  }

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const active = parsed
    .filter((entry) => Number.isFinite(entry.startMs) && Number.isFinite(entry.endMs) && entry.startMs <= nowMs && nowMs <= entry.endMs)
    .sort((left, right) => left.endMs - right.endMs);
  if (active.length > 0) return { interval: active[0], strategy: 'active' };

  const completed = parsed
    .filter((entry) => Number.isFinite(entry.endMs) && entry.endMs <= nowMs)
    .sort((left, right) => right.endMs - left.endMs);
  if (completed.length > 0) return { interval: completed[0], strategy: 'latest_completed' };

  const upcoming = parsed
    .filter((entry) => Number.isFinite(entry.startMs) && entry.startMs > nowMs)
    .sort((left, right) => left.startMs - right.startMs);
  if (upcoming.length > 0) return { interval: upcoming[0], strategy: 'upcoming' };

  return { interval: parsed[0], strategy: 'fallback_first' };
}

async function fetchAgileHiveTeamMetrics(client, projectKey, options = {}) {
  if (!/^[A-Z][A-Z0-9]+$/.test(projectKey)) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }
  const {
    intervalId = null,
    jql = '',
    methodology = 'SCRUM',
    historyCount = 3,
    now = new Date(),
  } = options;
  const intervalsResponse = await client.get('/planning-interval/intervals/for-project', { params: { projectKey } });
  const intervals = intervalsResponse.data || [];
  const selected = pickPlanningInterval(intervals, now, intervalId);
  if (!selected?.interval) {
    throw new Error(`No Agile Hive planning intervals found for project ${projectKey}`);
  }

  const reportPath = String(methodology).toUpperCase() === 'KANBAN'
    ? '/reports/team/kanban'
    : '/reports/team/scrum';
  const reportResponse = await client.get(reportPath, {
    params: {
      projectKey,
      planningIntervalId: String(selected.interval.id),
      ...(jql ? { jql } : {}),
    },
  });
  const metrics = mapPiStatistics(reportResponse.data?.piStatistics || {});
  const recentIntervals = pickRecentCompletedIntervals(intervals, historyCount, now);
  const historyMetricsByIntervalId = {
    [selected.interval.id]: metrics,
  };
  const historyRows = [];
  for (const interval of recentIntervals) {
    if (!historyMetricsByIntervalId[interval.id]) {
      const historyResponse = await client.get(reportPath, {
        params: {
          projectKey,
          planningIntervalId: String(interval.id),
          ...(jql ? { jql } : {}),
        },
      });
      historyMetricsByIntervalId[interval.id] = mapPiStatistics(historyResponse.data?.piStatistics || {});
    }
    historyRows.push({
      id: interval.id,
      name: String(interval?.name || `Interval ${interval.id}`),
      startDate: String(interval?.startDate || ''),
      endDate: String(interval?.endDate || ''),
      metrics: historyMetricsByIntervalId[interval.id],
    });
  }
  const chronological = [...historyRows].sort((left, right) => {
    const leftEnd = Date.parse(left.endDate || '');
    const rightEnd = Date.parse(right.endDate || '');
    if (Number.isFinite(leftEnd) && Number.isFinite(rightEnd) && leftEnd !== rightEnd) return leftEnd - rightEnd;
    return left.id - right.id;
  });
  const earliest = chronological[0] || null;
  const latest = chronological[chronological.length - 1] || null;

  return {
    projectKey,
    methodology: String(methodology).toUpperCase() === 'KANBAN' ? 'KANBAN' : 'SCRUM',
    interval: {
      id: selected.interval.id,
      name: String(selected.interval?.name || ''),
      startDate: String(selected.interval?.startDate || ''),
      endDate: String(selected.interval?.endDate || ''),
      artProjectKey: String(selected.interval?.artProject?.key || ''),
      strategy: selected.strategy,
    },
    metrics,
    sprintTrend: {
      items: chronological,
      averages: {
        velocity: average(chronological.map((entry) => entry.metrics.velocity)),
        spPerDay: average(chronological.map((entry) => entry.metrics.spPerDay), 2),
        deliveredSp: average(chronological.map((entry) => entry.metrics.spBurned.progress)),
        completionRate: average(chronological.map((entry) => entry.metrics.spBurned.percent)),
        loadVsCap: average(chronological.map((entry) => entry.metrics.loadVsCap.percent)),
      },
      trends: {
        velocity: trend(latest?.metrics.velocity, earliest?.metrics.velocity),
        spPerDay: trend(latest?.metrics.spPerDay, earliest?.metrics.spPerDay, 0.05, 2),
        deliveredSp: trend(latest?.metrics.spBurned.progress, earliest?.metrics.spBurned.progress),
        completionRate: trend(latest?.metrics.spBurned.percent, earliest?.metrics.spBurned.percent),
        loadVsCap: trend(latest?.metrics.loadVsCap.percent, earliest?.metrics.loadVsCap.percent),
      },
    },
  };
}

async function fetchBoards() {
  const agileClient = buildAgileClient();
  if (!agileClient) {
    const status = getJiraConfigStatus();
    throw new Error(status.message);
  }
  const res = await agileClient.get('/board');
  return res.data.values || [];
}

function objectiveBoardScore(board) {
  const name = String(board?.name || '').toLowerCase();
  if (!name) return -1;
  let score = 0;
  if (name.includes('modernis')) score += 5;
  if (name.includes('objective')) score += 4;
  if (name.includes('ziel')) score += 3;
  if (name.includes('strategy') || name.includes('strateg')) score += 2;
  return score;
}

function pickObjectiveBoard(boards = []) {
  return [...boards]
    .map((board) => ({ board, score: objectiveBoardScore(board) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.board?.name || '').localeCompare(String(b.board?.name || '')))[0]
    ?.board || null;
}

async function fetchBoardIssues(boardId, maxResults = 50) {
  const agileClient = buildAgileClient();
  if (!agileClient) {
    const status = getJiraConfigStatus();
    throw new Error(status.message);
  }
  const res = await agileClient.get(`/board/${encodeURIComponent(boardId)}/issue`, {
    params: {
      maxResults,
      fields: 'summary,description,status,labels,components',
    },
  });
  return res.data?.issues || [];
}

async function fetchObjectives(maxResults = 50) {
  const boards = await fetchBoards();
  const board = pickObjectiveBoard(boards);
  if (!board?.id) {
    return { board: null, issues: [] };
  }
  const issues = await fetchBoardIssues(board.id, maxResults);
  return {
    board: {
      id: board.id,
      name: board.name,
      type: board.type,
    },
    issues,
  };
}

async function fetchProjectComponents(client, projectKey) {
  const res = await client.get(`/project/${encodeURIComponent(projectKey)}/components`);
  return (res.data || []).map((c) => ({
    id: String(c.id),
    name: c.name || String(c.id),
    description: c.description || '',
  }));
}

async function createIssue(client, projectKey, ticket = {}) {
  const { summary, description = '', issuetype = 'Task', fields: dynamicFields } = ticket;
  if (dynamicFields && typeof dynamicFields === 'object') {
    const fields = { ...dynamicFields };
    if (!fields.project) fields.project = { key: projectKey };
    if (!fields.issuetype && issuetype) fields.issuetype = { name: issuetype };
    if (!fields.summary && summary) fields.summary = summary;
    if (!fields.description && description) fields.description = description;
    const res = await client.post('/issue', { fields });
    return res.data;
  }

  const res = await client.post('/issue', {
    fields: {
      project: { key: projectKey },
      summary,
      description,
      issuetype: { name: issuetype },
    },
  });
  return res.data; // { id, key, self }
}

async function updateIssue(client, issueKey, fields = {}) {
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey)) {
    throw new Error(`Invalid issue key: ${issueKey}`);
  }
  await client.put(`/issue/${encodeURIComponent(issueKey)}`, { fields });
  return { ok: true, key: issueKey };
}

module.exports = {
  DEFAULT_SPRINT_FIELD_IDS,
  DEFAULT_ESTIMATE_FIELD_IDS,
  buildJiraClient,
  fetchProjects,
  fetchIssues,
  fetchSprintFieldIds,
  fetchEstimateFieldIds,
  fetchProjectIdFieldIds,
  fetchAcceptanceCriteriaFieldIds,
  fetchBoards,
  fetchBoardIssues,
  fetchObjectives,
  buildAgileHiveClient,
  fetchAgileHiveTeamMetrics,
  pickPlanningInterval,
  fetchProjectComponents,
  fetchIssueTypes,
  fetchCreateMeta,
  createIssue,
  updateIssue,
  pickObjectiveBoard,
  getJiraConfigStatus,
  classifyJiraError,
  __resetSprintFieldIdsForTests: () => {
    cachedSprintFieldIds = null;
    cachedEstimateFieldIds = null;
    cachedProjectIdFieldIds = null;
    cachedAcceptanceFieldIds = null;
  },
};
