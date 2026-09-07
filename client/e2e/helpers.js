/**
 * Sets up API route mocks for the Axon frontend.
 * Each mock can be overridden by passing partial overrides.
 */
export async function setupMocks(page, overrides = {}) {
  const defaults = {
    llmHealth: {
      online: true,
      models: ['qwen3:14b', 'qwen3:4b', 'llama3.2'],
      defaultModel: 'qwen3:14b',
      recommendedModel: 'qwen3:14b',
    },
    projects: [
      { key: 'AXON', name: 'Axon Platform' },
      { key: 'OPS', name: 'Operations' },
    ],
    issueTypes: [
      { id: '10001', name: 'Story', description: 'User-facing work', subtask: false },
      { id: '10002', name: 'Task', description: 'General work item', subtask: false },
    ],
    createMeta: {
      issueTypeName: 'Story',
      fields: {
        summary: {
          name: 'Summary',
          required: true,
          schema: { type: 'string', system: 'summary' },
          allowedValues: [],
        },
        description: {
          name: 'Description',
          required: false,
          schema: { type: 'string', system: 'description' },
          allowedValues: [],
        },
        labels: {
          name: 'Labels',
          required: false,
          schema: { type: 'array', system: 'labels', items: 'string' },
          allowedValues: [],
        },
      },
    },
    objectiveContext: {
      board: { id: 77, name: 'Modernisierungs Board', type: 'scrum' },
      issues: [
        {
          key: 'MOD-1',
          fields: {
            summary: 'Modernize login and onboarding flow',
            status: { name: 'Open' },
            labels: ['auth'],
            components: [{ name: 'Portal UI' }],
          },
        },
        {
          key: 'MOD-2',
          fields: {
            summary: 'Improve customer self-service experience',
            status: { name: 'Open' },
            labels: ['self-service'],
            components: [],
          },
        },
      ],
    },
    refineTicket: {
      refinedSummary: 'Implement secure OAuth2 login flow',
      refinedDescription: 'Provide OAuth2 login with clear failure handling and persistent session behavior for end users.',
      acceptanceCriteria: [
        'OAuth2 login succeeds for valid users.',
        'Authentication errors are shown inline.',
        'The active session survives a page refresh.',
      ],
      productComponent: {
        name: 'Portal UI',
        reason: 'The affected user journey is handled in the Portal UI.',
      },
      objectiveAlignment: {
        objectiveKey: 'MOD-1',
        objectiveSummary: 'Modernize login and onboarding flow',
        confidence: 'high',
        reason: 'The ticket directly supports the login modernization objective.',
      },
      openQuestions: [
        'Do we need migration support for existing sessions?',
      ],
    },
    issues: {
      lastRefresh: new Date().toISOString(),
      issues: [
        {
          key: 'AXON-1',
          fields: {
            summary: 'Implement login flow',
            priority: { name: 'High' },
            status: { name: 'In Progress' },
            assignee: { displayName: 'Ada Lovelace' },
            reporter: { displayName: 'Grace Hopper' },
            description: `Acceptance Criteria
- User can log in with email and password
- Errors are shown inline
- Session is persisted after refresh`,
            created: new Date(Date.now() - 5 * 86400000).toISOString(),
            updated: new Date(Date.now() - 1 * 86400000).toISOString(),
            duedate: new Date(Date.now() + 5 * 86400000).toISOString(),
            customfield_10016: 5,
            labels: ['auth', 'frontend'],
            components: [{ name: 'Portal UI' }],
            fixVersions: [{ name: '2026.09' }],
            comment: {
              comments: [
                {
                  id: 'comment-1',
                  created: new Date(Date.now() - 1 * 86400000).toISOString(),
                  author: { displayName: 'Alan Turing' },
                  body: 'Please keep the validation errors inline, preserve the existing session cookie flow, and check [Runbook|https://example.com/runbook].',
                },
              ],
            },
            customfield_10005: [
              {
                id: 11,
                name: 'Sprint 24',
                state: 'active',
                goal: 'Stabilize onboarding',
                startDate: new Date(Date.now() - 2 * 86400000).toISOString(),
                endDate: new Date(Date.now() + 8 * 86400000).toISOString(),
              },
            ],
          },
        },
        {
          key: 'AXON-2',
          fields: {
            summary: 'Fix dashboard crash on mobile',
            priority: { name: 'Highest' },
            status: { name: 'Open' },
            description: 'Acceptance criteria: app should no longer crash on iOS Safari.',
            created: new Date(Date.now() - 12 * 86400000).toISOString(),
            customfield_10016: 3,
            labels: ['ios', 'self-service'],
          },
        },
        {
          key: 'AXON-3',
          fields: {
            summary: 'Add dark mode toggle',
            priority: { name: 'Low' },
            status: { name: 'Backlog' },
            description: 'Theme switcher for user settings.',
            created: new Date(Date.now() - 30 * 86400000).toISOString(),
            customfield_10016: 8,
            customfield_10005: [
              {
                id: 12,
                name: 'Sprint 25',
                state: 'future',
                goal: 'Improve customer self-service',
                startDate: new Date(Date.now() + 14 * 86400000).toISOString(),
                endDate: new Date(Date.now() + 28 * 86400000).toISOString(),
              },
            ],
          },
        },
        {
          key: 'AXON-4',
          fields: {
            summary: 'Improve search performance',
            priority: { name: 'Medium' },
            status: { name: 'Done' },
            description: 'Completed spike and implementation.',
            created: new Date(Date.now() - 8 * 86400000).toISOString(),
            updated: new Date(Date.now() - 1 * 86400000).toISOString(),
            resolutiondate: new Date(Date.now() - 1 * 86400000).toISOString(),
            customfield_10016: 2,
            customfield_10005: [
              {
                id: 11,
                name: 'Sprint 24',
                state: 'active',
                goal: 'Stabilize onboarding',
                startDate: new Date(Date.now() - 2 * 86400000).toISOString(),
                endDate: new Date(Date.now() + 8 * 86400000).toISOString(),
              },
            ],
          },
        },
      ],
    },
    analyze: {
      summary: 'The backlog has 4 tickets. Login flow and mobile crash fix should be prioritized.',
      suggestions: [
        { key: 'AXON-2', text: 'Mobile crash is critical – assign immediately.' },
        { key: 'AXON-1', text: 'Login flow blocks onboarding. Prioritize for next sprint.' },
      ],
      redundancies: [
        { keys: ['AXON-3', 'AXON-4'], reason: 'Dark mode and search may share UI rework.' },
      ],
      gaps: [
        { text: 'No ticket for automated testing coverage.' },
        { text: 'Missing ticket for API rate limiting.' },
      ],
      slowTickets: [
        { key: 'AXON-3', daysOpen: 30, note: 'Stalled in backlog, no activity.' },
      ],
      coverage: {
        focus: 'overview',
        analyzedTickets: 4,
        usedAllTickets: false,
        sampledTickets: 4,
      },
    },
    analyzeByFocus: {
      suggestions: {
        suggestions: [
          { key: 'AXON-2', text: 'Mobile crash is critical – assign immediately.' },
        ],
        coverage: { focus: 'suggestions', analyzedTickets: 4, usedAllTickets: true, sampledTickets: 4 },
      },
      redundancies: {
        redundancies: [
          { keys: ['AXON-3', 'AXON-4'], reason: 'Dark mode and search may share UI rework.' },
        ],
        coverage: { focus: 'redundancies', analyzedTickets: 4, usedAllTickets: true, sampledTickets: 4 },
      },
      gaps: {
        gaps: [
          { text: 'Missing ticket for API rate limiting.' },
        ],
        coverage: { focus: 'gaps', analyzedTickets: 4, usedAllTickets: true, sampledTickets: 4 },
      },
      slowTickets: {
        slowTickets: [
          { key: 'AXON-3', daysOpen: 30, note: 'Stalled in backlog, no activity.' },
        ],
        coverage: { focus: 'slowTickets', analyzedTickets: 4, usedAllTickets: true, sampledTickets: 4 },
      },
      backlogRefinementCandidates: {
        backlogRefinementCandidates: [
          { key: 'AXON-2', reason: 'Needs clearer implementation details.', missing: ['owner'] },
        ],
        coverage: { focus: 'backlogRefinementCandidates', analyzedTickets: 4, usedAllTickets: true, sampledTickets: 4 },
      },
    },
    evaluateIdea: {
      feasibility: 'high',
      effort: 'medium',
      value: 'high',
      verdict: 'Strong idea with clear user value. Feasible within current stack.',
      risks: [
        'Requires backend changes to support real-time sync.',
        'Mobile performance impact needs measurement.',
      ],
      nextSteps: [
        'Create spike ticket for technical investigation.',
        'Get stakeholder sign-off on scope.',
        'Estimate effort with the team.',
      ],
    },
    llmSmokeTest: {
      ok: true,
      model: 'qwen3:14b',
      response: 'pong',
      durationMs: 850,
    },
  };

  const mocks = { ...defaults, ...overrides };
  const captures = mocks.captures || {};
  let boardState = {
    placements: {},
    sprints: {},
    showArchive: true,
    checklists: {},
    table: {
      columnOrder: ['ticket', 'summary', 'product', 'objective', 'points', 'priority', 'status', 'acceptance'],
      sortBy: '',
      sortDir: 'asc',
    },
    ...(mocks.boardState || {}),
  };

  await page.route('**/api/llm/health', (route) =>
    route.fulfill({ json: mocks.llmHealth })
  );
  await page.route('**/api/projects', (route) =>
    route.fulfill({ json: mocks.projects })
  );
  await page.route('**/api/issues/**', (route) =>
    route.fulfill({ json: mocks.issues })
  );
  await page.route('**/api/board-state/**', async (route) => {
    if (route.request().method() === 'PUT') {
      const nextPayload = route.request().postDataJSON() || {};
      captures.boardState = nextPayload;
      boardState = {
        placements: {},
        sprints: {},
        showArchive: true,
        checklists: {},
        table: {
          columnOrder: ['ticket', 'summary', 'product', 'objective', 'points', 'priority', 'status', 'acceptance'],
          sortBy: '',
          sortDir: 'asc',
        },
        ...nextPayload,
      };
    }
    await route.fulfill({ json: boardState });
  });
  await page.route('**/api/jira/components/**', (route) =>
    route.fulfill({ json: [{ id: 'c1', name: 'Portal UI' }, { id: 'c2', name: 'Checkout' }] })
  );
  await page.route('**/api/jira/objectives', (route) =>
    route.fulfill({ json: mocks.objectiveContext })
  );
  await page.route('**/api/jira/issue-types/**', (route) =>
    route.fulfill({ json: mocks.issueTypes })
  );
  await page.route('**/api/jira/create-meta/**', (route) =>
    route.fulfill({ json: mocks.createMeta })
  );
  await page.route('**/api/refresh/**', (route) =>
    route.fulfill({ json: { lastRefresh: new Date().toISOString() } })
  );
  await page.route('**/api/llm/analyze/**', (route) =>
    {
      captures.analyze = route.request().postDataJSON?.() || {};
      const focus = captures.analyze.focus || 'overview';
      const payload = focus === 'overview'
        ? mocks.analyze
        : (mocks.analyzeByFocus?.[focus] || mocks.analyze);
      return route.fulfill({ json: payload });
    }
  );
  await page.route('**/api/llm/evaluate-idea', (route) =>
    {
      captures.evaluateIdea = route.request().postDataJSON?.() || {};
      return route.fulfill({ json: mocks.evaluateIdea });
    }
  );
  await page.route('**/api/llm/smoke-test', (route) =>
    {
      captures.llmSmokeTest = route.request().postDataJSON?.() || {};
      return route.fulfill({ status: mocks.llmSmokeTestStatus || 200, json: mocks.llmSmokeTest });
    }
  );
  await page.route('**/api/llm/refine-ticket', (route) =>
    {
      captures.refineTicket = route.request().postDataJSON?.() || {};
      return route.fulfill({ json: mocks.refineTicket });
    }
  );
  await page.route('**/api/jira/issues/**', (route) =>
    route.fulfill({ json: { ok: true } })
  );
  await page.route('**/api/jira/sync', async (route) => {
    // Simulate a streaming SSE response with progress events
    const body = route.request().postDataJSON();
    const tickets = body.tickets || [];
    const lines = tickets.map((_, i) =>
      `data: ${JSON.stringify({ type: 'progress', index: i, status: 'done', key: `AXON-${100 + i}` })}`
    );
    lines.push(`data: ${JSON.stringify({ type: 'done', created: tickets.length, errors: 0 })}`);
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: lines.join('\n') + '\n',
    });
  });
}
