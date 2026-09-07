const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_SPRINT_FIELD_IDS,
  DEFAULT_ESTIMATE_FIELD_IDS,
  fetchIssues,
  fetchEstimateFieldIds,
  fetchSprintFieldIds,
  fetchProjectIdFieldIds,
  fetchAcceptanceCriteriaFieldIds,
  fetchAgileHiveTeamMetrics,
  pickPlanningInterval,
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
            { id: 'customfield_77777', name: 'Project ID', schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } },
          ],
        };
      }
      if (route === '/search') {
        return { data: { issues: [{ key: 'AXON-1', fields: { customfield_99999: 8, customfield_77777: { value: 'PA-7 AKS' } } }] } };
      }
      throw new Error(`Unexpected route: ${route}`);
    },
  };

  const issues = await fetchIssues(client, 'AXON');
  const searchCall = calls.find((call) => call.route === '/search');
  const requestedFields = searchCall.options.params.fields.split(',');

  assert.equal(issues[0].fields.__storyPoints, 8);
  assert.equal(issues[0].fields.__storyPointFieldId, 'customfield_99999');
  assert.equal(issues[0].fields.__projectId, 'PA-7 AKS');
  assert.equal(issues[0].fields.__projectIdFieldId, 'customfield_77777');
  assert.ok(requestedFields.includes('customfield_12345'));
  assert.ok(requestedFields.includes('customfield_99999'));
  assert.ok(requestedFields.includes('customfield_77777'));
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
  const projectIdFieldIds = await fetchProjectIdFieldIds(client);

  assert.deepEqual(sprintFieldIds, DEFAULT_SPRINT_FIELD_IDS);
  assert.deepEqual(estimateFieldIds, DEFAULT_ESTIMATE_FIELD_IDS);
  assert.deepEqual(projectIdFieldIds, []);
  assert.deepEqual(await fetchAcceptanceCriteriaFieldIds(client), []);
});

test('fetchProjectIdFieldIds prefers project-id custom fields', async () => {
  const client = {
    get: async (route) => {
      assert.equal(route, '/field');
      return {
        data: [
          { id: 'customfield_13001', name: 'Project ID', schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } },
          { id: 'customfield_13002', name: 'Projekt-ID', schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } },
          { id: 'customfield_13003', name: 'Modernisierung Mapping', schema: { type: 'string' } },
        ],
      };
    },
  };

  const result = await fetchProjectIdFieldIds(client);
  assert.deepEqual(result.slice(0, 2).sort(), ['customfield_13001', 'customfield_13002']);
  assert.equal(result[2], 'customfield_13003');
});

test('fetchAcceptanceCriteriaFieldIds prefers dedicated acceptance criteria fields', async () => {
  const client = {
    get: async (route) => {
      assert.equal(route, '/field');
      return {
        data: [
          { id: 'customfield_10077', name: 'Acceptance Criteria', schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } },
          { id: 'customfield_10078', name: 'Akzeptanzkriterien', schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } },
          { id: 'customfield_10079', name: 'Acceptance Notes', schema: { type: 'string' } },
        ],
      };
    },
  };

  const result = await fetchAcceptanceCriteriaFieldIds(client);
  assert.deepEqual(result, ['customfield_10077', 'customfield_10078', 'customfield_10079']);
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

test('pickPlanningInterval prefers latest completed interval when no active interval exists', () => {
  const now = new Date('2026-09-07T10:00:00.000Z');
  const result = pickPlanningInterval([
    { id: 131, name: '2026-Q4', startDate: '2026-09-14T00:00:00.000Z', endDate: '2026-12-04T00:00:00.000Z' },
    { id: 113, name: '2026-Q3', startDate: '2026-06-15T00:00:00.000Z', endDate: '2026-09-04T00:00:00.000Z' },
  ], now);

  assert.equal(result.strategy, 'latest_completed');
  assert.equal(result.interval.id, 113);
});

test('fetchAgileHiveTeamMetrics maps pi statistics for dashboard usage', async () => {
  const calls = [];
  const client = {
    get: async (route, options = {}) => {
      calls.push({ route, options });
      if (route === '/planning-interval/intervals/for-project') {
        return {
          data: [
            { id: 200, name: '2026-Q4', startDate: '2026-09-14T00:00:00.000Z', endDate: '2026-12-04T00:00:00.000Z', artProject: { key: 'ART-1' } },
            { id: 199, name: '2026-Q3', startDate: '2026-06-15T00:00:00.000Z', endDate: '2026-09-04T00:00:00.000Z', artProject: { key: 'ART-1' } },
          ],
        };
      }
      if (route === '/reports/team/scrum') {
        const intervalId = options?.params?.planningIntervalId;
        if (intervalId === '199') {
          return {
            data: {
              piStatistics: {
                spPerDay: 1.92,
                averageVelocity: 50,
                spBurned: { progress: 87, total: 136 },
                daysPassed: { progress: 81, total: 81 },
                businessValue: { progress: 0, total: 0 },
                loadVsCap: { progress: 136, total: 0 },
              },
            },
          };
        }
        return {
          data: {
            piStatistics: {
              spPerDay: 1.45,
              averageVelocity: 41,
              spBurned: { progress: 55, total: 110 },
              daysPassed: { progress: 81, total: 81 },
              businessValue: { progress: 0, total: 0 },
              loadVsCap: { progress: 118, total: 0 },
            },
          },
        };
      }
      throw new Error(`Unexpected route: ${route}`);
    },
  };

  const result = await fetchAgileHiveTeamMetrics(client, 'LGLNT15', { now: new Date('2026-09-07T10:00:00.000Z') });

  assert.equal(result.interval.id, 199);
  assert.equal(result.metrics.spPerDay, 1.92);
  assert.equal(result.metrics.velocity, 50);
  assert.equal(result.metrics.spBurned.percent, 64);
  assert.equal(result.metrics.daysPassed.percent, 100);
  assert.equal(result.metrics.loadVsCap.percent, 136);
  assert.equal(result.sprintTrend.items.length, 1);
  assert.equal(result.sprintTrend.items[0].id, 199);
  assert.equal(result.sprintTrend.averages.velocity, 50);
  assert.equal(result.sprintTrend.trends.velocity.direction, 'flat');
  const scrumCalls = calls.filter((call) => call.route === '/reports/team/scrum');
  assert.equal(scrumCalls.length, 1);
  assert.equal(scrumCalls[0].options.params.projectKey, 'LGLNT15');
  assert.equal(scrumCalls[0].options.params.planningIntervalId, '199');
});

test('fetchAgileHiveTeamMetrics adds last three completed intervals with averages and trends', async () => {
  const statsByInterval = {
    '201': { spPerDay: 1.4, averageVelocity: 37, spBurned: { progress: 42, total: 100 }, loadVsCap: { progress: 105, total: 0 } },
    '202': { spPerDay: 1.7, averageVelocity: 44, spBurned: { progress: 53, total: 100 }, loadVsCap: { progress: 96, total: 0 } },
    '203': { spPerDay: 2.0, averageVelocity: 52, spBurned: { progress: 66, total: 100 }, loadVsCap: { progress: 88, total: 0 } },
  };
  const calls = [];
  const client = {
    get: async (route, options = {}) => {
      calls.push({ route, options });
      if (route === '/planning-interval/intervals/for-project') {
        return {
          data: [
            { id: 204, name: '2026-Q4', startDate: '2026-09-12T00:00:00.000Z', endDate: '2026-12-04T00:00:00.000Z' },
            { id: 203, name: '2026-Q3', startDate: '2026-06-10T00:00:00.000Z', endDate: '2026-09-01T00:00:00.000Z' },
            { id: 202, name: '2026-Q2', startDate: '2026-03-01T00:00:00.000Z', endDate: '2026-06-01T00:00:00.000Z' },
            { id: 201, name: '2026-Q1', startDate: '2025-12-01T00:00:00.000Z', endDate: '2026-03-01T00:00:00.000Z' },
          ],
        };
      }
      if (route === '/reports/team/scrum') {
        const intervalId = String(options?.params?.planningIntervalId || '');
        return { data: { piStatistics: statsByInterval[intervalId] || {} } };
      }
      throw new Error(`Unexpected route: ${route}`);
    },
  };

  const result = await fetchAgileHiveTeamMetrics(client, 'LGLNT15', {
    now: new Date('2026-09-07T10:00:00.000Z'),
    historyCount: 3,
  });

  assert.deepEqual(result.sprintTrend.items.map((item) => item.id), [201, 202, 203]);
  assert.equal(result.sprintTrend.averages.velocity, 44.3);
  assert.equal(result.sprintTrend.averages.deliveredSp, 53.7);
  assert.equal(result.sprintTrend.trends.velocity.direction, 'up');
  assert.equal(result.sprintTrend.trends.velocity.delta, 15);
  assert.equal(result.sprintTrend.trends.completionRate.direction, 'up');
  assert.equal(result.sprintTrend.trends.loadVsCap.direction, 'down');
  assert.equal(result.sprintTrend.trends.loadVsCap.delta, -17);
  const scrumCalls = calls.filter((call) => call.route === '/reports/team/scrum');
  assert.equal(scrumCalls.length, 3);
});
