const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_SPRINT_FIELD_IDS,
  DEFAULT_ESTIMATE_FIELD_IDS,
  fetchIssues,
  fetchEstimateFieldIds,
  fetchSprintFieldIds,
  pickObjectiveBoard,
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
            { id: 'customfield_99999', name: 'Story point estimate', schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
          ],
        };
      }
      if (route === '/search') {
        return { data: { issues: [{ key: 'AXON-1', fields: { customfield_99999: 8 } }] } };
      }
      throw new Error(`Unexpected route: ${route}`);
    },
  };

  const issues = await fetchIssues(client, 'AXON');
  const searchCall = calls.find((call) => call.route === '/search');
  const requestedFields = searchCall.options.params.fields.split(',');

  assert.equal(issues[0].fields.__storyPoints, 8);
  assert.equal(issues[0].fields.__storyPointFieldId, 'customfield_99999');
  assert.ok(requestedFields.includes('customfield_12345'));
  assert.ok(requestedFields.includes('customfield_99999'));
  assert.ok(requestedFields.includes('duedate'));
  assert.equal(searchCall.options.params.jql, 'project = AXON ORDER BY updated DESC');
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
  const estimateFieldIds = await fetchEstimateFieldIds(client);

  assert.deepEqual(sprintFieldIds, DEFAULT_SPRINT_FIELD_IDS);
  assert.deepEqual(estimateFieldIds, DEFAULT_ESTIMATE_FIELD_IDS);
});

test('fetchIssues rejects invalid project keys before calling Jira', async () => {
  const client = {
    get: async () => {
      throw new Error('client should not be called');
    },
  };

  await assert.rejects(() => fetchIssues(client, 'team-3d'), /Invalid project key: team-3d/);
});

test('fetchIssues paginates search results and returns all tickets', async () => {
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
        const startAt = options?.params?.startAt ?? 0;
        if (startAt === 0) {
          return {
            data: {
              total: 250,
              issues: Array.from({ length: 100 }, (_, idx) => ({ key: `AXON-${idx + 1}`, fields: {} })),
            },
          };
        }
        if (startAt === 100) {
          return {
            data: {
              total: 250,
              issues: Array.from({ length: 100 }, (_, idx) => ({ key: `AXON-${idx + 101}`, fields: {} })),
            },
          };
        }
        return {
          data: {
            total: 250,
            issues: Array.from({ length: 50 }, (_, idx) => ({ key: `AXON-${idx + 201}`, fields: {} })),
          },
        };
      }
      throw new Error(`Unexpected route: ${route}`);
    },
  };

  const issues = await fetchIssues(client, 'AXON');
  const searchCalls = calls.filter((call) => call.route === '/search');

  assert.equal(searchCalls.length, 3);
  assert.equal(searchCalls[0].options.params.startAt, 0);
  assert.equal(searchCalls[1].options.params.startAt, 100);
  assert.equal(searchCalls[2].options.params.startAt, 200);
  assert.equal(issues.length, 250);
});

test('pickObjectiveBoard prefers modernization-style objective boards', () => {
  const result = pickObjectiveBoard([
    { id: 1, name: 'Team Board' },
    { id: 2, name: 'Modernisierungs Board' },
    { id: 3, name: 'Objectives 2026' },
  ]);

  assert.deepEqual(result, { id: 2, name: 'Modernisierungs Board' });
});
