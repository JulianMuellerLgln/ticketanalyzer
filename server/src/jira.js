const axios = require('axios');
const DEFAULT_SPRINT_FIELD_IDS = ['customfield_10005', 'customfield_10020'];
let cachedSprintFieldIds = null;

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

async function fetchIssues(client, projectKey, maxResults = 200) {
  if (!/^[A-Z][A-Z0-9]+$/.test(projectKey)) {
    throw new Error(`Invalid project key: ${projectKey}`);
  }
  const sprintFieldIds = await fetchSprintFieldIds(client);
  const res = await client.get('/search', {
    params: {
      jql: `project = ${projectKey} ORDER BY updated DESC`,
      maxResults,
      fields: [
        'summary', 'status', 'priority', 'assignee', 'reporter',
        'created', 'updated', 'duedate', 'resolutiondate', 'description',
        'issuetype', 'labels', 'components', 'fixVersions',
        'customfield_10016',
        'comment',
        ...sprintFieldIds,
      ].join(','),
    },
  });
  return res.data.issues || [];
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

async function fetchBoards() {
  const agileClient = buildAgileClient();
  if (!agileClient) {
    const status = getJiraConfigStatus();
    throw new Error(status.message);
  }
  const res = await agileClient.get('/board');
  return res.data.values || [];
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

module.exports = {
  DEFAULT_SPRINT_FIELD_IDS,
  buildJiraClient,
  fetchProjects,
  fetchIssues,
  fetchSprintFieldIds,
  fetchBoards,
  fetchProjectComponents,
  fetchIssueTypes,
  fetchCreateMeta,
  createIssue,
  getJiraConfigStatus,
  classifyJiraError,
  __resetSprintFieldIdsForTests: () => {
    cachedSprintFieldIds = null;
  },
};
