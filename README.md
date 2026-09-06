# Axon — Technical Backlog Intelligence

Draggable dashboard for technical Product Owners. Connects to Jira Data Center and a local Ollama LLM.

## Workflow modes

- **Refinement**: identify under-specified backlog items, enrich them with local AI, review acceptance criteria, assign products/components, and inspect likely objective matches from the modernization board.
- **Planning**: order backlog items, capture open questions and absences, define a Sprint Goal, and start the Sprint.
- **Daily business**: keep the Sprint Goal visible during execution and adapt the Sprint Backlog as work evolves.

The UI also includes a Scrum Guide pop-out with the five Scrum values and the most relevant current guide guidance for software teams.

## Setup

```bash
# 1. Configure server
cp server/.env.example server/.env
# Edit server/.env with your Jira URL, API token, and Ollama settings

# 2. Install deps
npm install
cd server && npm install
cd ../client && npm install

# 3. Run (dev)
npm run dev
```

Opens on http://localhost:5173 — backend on :3001.

## Ollama

```bash
ollama pull qwen2:7b
ollama serve
```

The LLM status indicator in the header shows online/offline in real time.

## Health checks

```bash
curl http://localhost:3001/api/jira/health
curl http://localhost:3001/api/llm/health
```

If Jira health reports auth errors, verify auth mode in server/.env:
- JIRA_AUTH_TYPE=basic with JIRA_USER_EMAIL + JIRA_API_TOKEN
- JIRA_AUTH_TYPE=bearer with JIRA_API_TOKEN (JIRA_USER_EMAIL optional)

## Validation

```bash
npm run lint
npm run build
npm run test:api
npm run test:frontend
```

- `test:api` runs the server API regression tests with Node's built-in test runner.
- `test:frontend` runs the Playwright browser tests for the sprint board and dashboard flows.
