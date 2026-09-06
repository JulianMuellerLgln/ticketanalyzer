const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_SPRINT_FIELD_IDS,
  fetchIssues,
  fetchSprintFieldIds,
  __resetSprintFieldIdsForTests,
} = require('../src/jira');

test.beforeEach(() => {
  __resetSprintFieldIdsForTests();
});

test('fetchSprintFieldIds discovers GreenHopper sprint fields', async () => {
  const client = {
    get: async (route) => {
      assert.equal(route, '/field');
      return {
        data: [
          { id: 'summary', schema: { system: 'summary' } },
          { id: 'customfield_10005', schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
          { id: 'customfield_10020', schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
        ],
      };
    },
  };

  const result = await fetchSprintFieldIds(client);
  assert.deepEqual(result, ['customfield_10005', 'customfield_10020']);
});

test('fetchIssues includes discovered sprint fields in Jira search', async () => {
  const calls = [];
  const client = {
    get: async (route, options) => {
      calls.push({ route, options });
      if (route === '/field') {
        return {
          data: [
            { id: 'customfield_12345', schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
          ],
        };
      }
      if (route === '/search') {
        return { data: { issues: [{ key: 'AXON-1' }] } };
      }
      throw new Error(`Unexpected route: ${route}`);
    },
  };

  const issues = await fetchIssues(client, 'AXON');
  const requestedFields = calls[1].options.params.fields.split(',');

  assert.deepEqual(issues, [{ key: 'AXON-1' }]);
  assert.ok(requestedFields.includes('customfield_12345'));
  assert.ok(requestedFields.includes('duedate'));
  assert.equal(calls[1].options.params.jql, 'project = AXON ORDER BY updated DESC');
});

test('fetchIssues falls back to default sprint fields when field discovery fails', async () => {
  const client = {
    get: async (route, options) => {
      if (route === '/field') {
        throw new Error('field discovery failed');
      }
      if (route === '/search') {
        return { data: { issues: [], fields: options?.params?.fields } };
      }
      throw new Error(`Unexpected route: ${route}`);
    },
  };

  await fetchIssues(client, 'AXON');
  const sprintFieldIds = await fetchSprintFieldIds(client);

  assert.deepEqual(sprintFieldIds, DEFAULT_SPRINT_FIELD_IDS);
});

test('fetchIssues rejects invalid project keys before calling Jira', async () => {
  const client = {
    get: async () => {
      throw new Error('client should not be called');
    },
  };

  await assert.rejects(() => fetchIssues(client, 'team-3d'), /Invalid project key: team-3d/);
});
