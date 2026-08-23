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
};
