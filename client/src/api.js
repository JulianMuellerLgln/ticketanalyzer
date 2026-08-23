import axios from 'axios';

const BASE = '/api';

export const api = {
  projects: () => axios.get(`${BASE}/projects`).then((r) => r.data),
  issues: (key, force = false) =>
    axios.get(`${BASE}/issues/${key}`, { params: { force } }).then((r) => r.data),
  refresh: (key) => axios.post(`${BASE}/refresh/${key}`).then((r) => r.data),
  llmHealth: () => axios.get(`${BASE}/llm/health`).then((r) => r.data),
  analyze: (key, lang) =>
    axios.post(`${BASE}/llm/analyze/${key}`, {}, { params: { lang } }).then((r) => r.data),
  evaluateIdea: (idea, lang) =>
    axios.post(`${BASE}/llm/evaluate-idea`, { idea, lang }).then((r) => r.data),

  /**
   * Sync tickets to Jira via SSE stream.
   * @param {string} projectKey
   * @param {Array<{summary:string, description?:string, issuetype?:string}>} tickets
   * @param {{ onProgress: (event: object) => void, onDone: (event: object) => void, onError: (message: string) => void }} callbacks
   * @returns {{ close: () => void }} – call close() to abort
   */
  syncToJira: async (projectKey, tickets, { onProgress, onDone, onError }) => {
    // SSE requires GET or EventSource; since our payload is large we POST and then open
    // a streaming fetch instead of EventSource.
    const response = await fetch(`${BASE}/jira/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectKey, tickets }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      onError(err.error || 'Sync failed');
      return { close: () => {} };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let closed = false;

    const pump = async () => {
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'done') {
                onDone(event);
              } else {
                onProgress(event);
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    };

    pump().catch(() => onError('Stream interrupted'));

    return {
      close: () => {
        closed = true;
        reader.cancel();
      },
    };
  },
};

