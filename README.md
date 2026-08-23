# Axon — Technical Backlog Intelligence

Draggable dashboard for technical Product Owners. Connects to Jira Data Center and a local Ollama LLM.

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
ollama pull llama3
ollama serve
```

The LLM status indicator in the header shows online/offline in real time.
