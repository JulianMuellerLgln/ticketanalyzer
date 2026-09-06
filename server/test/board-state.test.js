const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const boardStateFile = path.join(os.tmpdir(), `ticketanalyzer-board-state-${process.pid}.json`);
process.env.BOARD_STATE_FILE = boardStateFile;

const { app } = require('../index');

async function startTestServer() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function requestJson(server, method, route, body) {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

test.before(async () => {
  await fs.rm(boardStateFile, { force: true });
});

test.after(async () => {
  await fs.rm(boardStateFile, { force: true });
});

test('GET /api/board-state returns sanitized defaults for unknown projects', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const response = await requestJson(server, 'GET', '/api/board-state/AXON');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    placements: {},
    sprints: {},
    showArchive: true,
    planning: {
      sprintGoalDraft: '',
      openQuestions: '',
      teamAbsences: '',
    },
    checklists: {},
  });
});

test('board-state endpoints reject invalid project keys', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const getResponse = await requestJson(server, 'GET', '/api/board-state/team-3d');
  const putResponse = await requestJson(server, 'PUT', '/api/board-state/team-3d', {});

  assert.equal(getResponse.status, 400);
  assert.deepEqual(getResponse.body, { error: 'Invalid project key' });
  assert.equal(putResponse.status, 400);
  assert.deepEqual(putResponse.body, { error: 'Invalid project key' });
});

test('PUT /api/board-state persists only supported board state fields', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const payload = {
    placements: {
      'AXON-1': 'backlog',
      'AXON-2': 'sprint:sprint-24',
      'AXON-3': 'archive',
      'AXON-4': 'in-progress',
      '': 'backlog',
    },
    sprints: {
      'sprint-24': {
        id: 24,
        name: 'Sprint 24',
        state: 'ACTIVE',
        goal: 'Ship login improvements',
        startDate: '2026-09-01T00:00:00.000Z',
        endDate: '2026-09-14T00:00:00.000Z',
        completeDate: null,
        ignored: 'value',
      },
      'broken-sprint': 'nope',
    },
    showArchive: false,
    planning: {
      sprintGoalDraft: 'Reduce onboarding support load',
      openQuestions: 'Do we need SSO parity?',
      teamAbsences: 'Ada out on Friday',
    },
    checklists: {
      'AXON-1': {
        ready: {
          acceptance: true,
          estimate: true,
          ignoreMe: 'nope',
        },
        done: {
          tests: false,
          merged: true,
        },
      },
      '': {
        ready: { titleDescription: true },
      },
    },
    ignoredTopLevel: true,
  };

  const putResponse = await requestJson(server, 'PUT', '/api/board-state/AXON', payload);
  const getResponse = await requestJson(server, 'GET', '/api/board-state/AXON');
  const rawStore = JSON.parse(await fs.readFile(boardStateFile, 'utf8'));

  const expected = {
    placements: {
      'AXON-1': 'backlog',
      'AXON-2': 'sprint:sprint-24',
      'AXON-3': 'archive',
    },
    sprints: {
      'sprint-24': {
        id: '24',
        name: 'Sprint 24',
        state: 'active',
        goal: 'Ship login improvements',
        startDate: '2026-09-01T00:00:00.000Z',
        endDate: '2026-09-14T00:00:00.000Z',
        completeDate: '',
      },
    },
    showArchive: false,
    planning: {
      sprintGoalDraft: 'Reduce onboarding support load',
      openQuestions: 'Do we need SSO parity?',
      teamAbsences: 'Ada out on Friday',
    },
    checklists: {
      'AXON-1': {
        ready: {
          acceptance: true,
          estimate: true,
        },
        done: {
          tests: false,
          merged: true,
        },
      },
    },
  };

  assert.equal(putResponse.status, 200);
  assert.deepEqual(putResponse.body, expected);
  assert.equal(getResponse.status, 200);
  assert.deepEqual(getResponse.body, expected);
  assert.deepEqual(rawStore.AXON, expected);
});
