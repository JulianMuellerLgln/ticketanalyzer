/**
 * Sets up API route mocks for the Axon frontend.
 * Each mock can be overridden by passing partial overrides.
 */
export async function setupMocks(page, overrides = {}) {
  const defaults = {
    llmHealth: { online: true, models: ['llama3.2'] },
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
            labels: ['auth', 'frontend'],
            components: [{ name: 'Portal UI' }],
            fixVersions: [{ name: '2026.09' }],
            comment: {
              comments: [
                {
                  id: 'comment-1',
                  created: new Date(Date.now() - 1 * 86400000).toISOString(),
                  author: { displayName: 'Alan Turing' },
                  body: 'Please keep the validation errors inline and preserve the existing session cookie flow.',
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
  };

  const mocks = { ...defaults, ...overrides };
  let boardState = {
    placements: {},
    sprints: {},
    showArchive: true,
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
      boardState = {
        placements: {},
        sprints: {},
        showArchive: true,
        ...(route.request().postDataJSON() || {}),
      };
    }
    await route.fulfill({ json: boardState });
  });
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
    route.fulfill({ json: mocks.analyze })
  );
  await page.route('**/api/llm/evaluate-idea', (route) =>
    route.fulfill({ json: mocks.evaluateIdea })
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
