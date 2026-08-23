const axios = require('axios');

function buildJiraClient() {
  const { JIRA_BASE_URL, JIRA_API_TOKEN, JIRA_USER_EMAIL } = process.env;
  if (!JIRA_BASE_URL || !JIRA_API_TOKEN) return null;

  return axios.create({
    baseURL: `${JIRA_BASE_URL}/rest/api/2`,
    auth: { username: JIRA_USER_EMAIL, password: JIRA_API_TOKEN },
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });
}

async function fetchProjects(client) {
  const res = await client.get('/project');
  return res.data;
}

async function fetchIssues(client, projectKey, maxResults = 200) {
  const res = await client.get('/search', {
    params: {
      jql: `project = ${projectKey} ORDER BY updated DESC`,
      maxResults,
      fields: [
        'summary', 'status', 'priority', 'assignee', 'reporter',
        'created', 'updated', 'resolutiondate', 'description',
        'issuetype', 'labels', 'components', 'fixVersions',
        'customfield_10016',
        'comment',
      ].join(','),
    },
  });
  return res.data.issues || [];
}

function buildAgileClient() {
  return axios.create({
    baseURL: `${process.env.JIRA_BASE_URL}/rest/agile/1.0`,
    auth: { username: process.env.JIRA_USER_EMAIL, password: process.env.JIRA_API_TOKEN },
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });
}

async function fetchBoards() {
  const agileClient = buildAgileClient();
  const res = await agileClient.get('/board');
  return res.data.values || [];
}

async function createIssue(client, projectKey, { summary, description = '', issuetype = 'Task' }) {
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

module.exports = { buildJiraClient, fetchProjects, fetchIssues, fetchBoards, createIssue };
