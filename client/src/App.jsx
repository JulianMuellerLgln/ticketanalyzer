import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Globe } from 'lucide-react';
import Draggable from 'react-draggable';

import { api } from './api';
import { i18n } from './i18n';
import StatusBar from './components/StatusBar';
import TicketList from './components/TicketList';
import LLMInsights from './components/LLMInsights';
import IdeaEvaluator from './components/IdeaEvaluator';
import Roadmap from './components/Roadmap';

// Simple widget wrapper using react-draggable
function Widget({ id, title, children, defaultPos, zMap, onFocus }) {
  const [expanded, setExpanded] = useState(false);
  const nodeRef = { current: null };

  return (
    <Draggable
      nodeRef={nodeRef}
      handle=".wh"
      defaultPosition={defaultPos}
      disabled={expanded}
      bounds="parent"
      onStart={() => onFocus(id)}
    >
      <div
        ref={(el) => (nodeRef.current = el)}
        className={`widget${expanded ? ' widget--expanded' : ''}`}
        style={{ zIndex: zMap[id] || 1 }}
        onClick={() => onFocus(id)}
      >
        <div className="wh">
          <span className="widget-title">{title}</span>
          <button
            className="icon-btn"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            title={expanded ? 'Minimize' : 'Maximize'}
          >
            {expanded ? '⊡' : '⊞'}
          </button>
        </div>
        <div className="widget-body">{children}</div>
      </div>
    </Draggable>
  );
}

const POSITIONS = {
  tickets:  { x: 20,  y: 10 },
  insights: { x: 440, y: 10 },
  roadmap:  { x: 20,  y: 340 },
  idea:     { x: 440, y: 340 },
};

export default function App() {
  const [lang, setLang] = useState('en');
  const t = i18n[lang];

  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [issues, setIssues] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [jiraOk, setJiraOk] = useState(false);

  const [llm, setLlm] = useState({ online: false, models: [] });

  const [zMap, setZMap] = useState({ tickets: 1, insights: 1, roadmap: 1, idea: 1 });
  const [zTop, setZTop] = useState(2);

  function focusWidget(id) {
    setZTop((z) => z + 1);
    setZMap((m) => ({ ...m, [id]: zTop + 1 }));
  }

  // Poll LLM health every 15s
  useEffect(() => {
    const check = () => api.llmHealth().then(setLlm).catch(() => setLlm({ online: false, models: [] }));
    check();
    const iv = setInterval(check, 15000);
    return () => clearInterval(iv);
  }, []);

  // Load projects on mount
  useEffect(() => {
    api.projects()
      .then((p) => { setProjects(p); setJiraOk(true); })
      .catch(() => { setJiraOk(false); });
  }, []);

  // Auto-refresh hourly
  useEffect(() => {
    if (!selectedProject) return;
    const iv = setInterval(() => doRefresh(), 3600000);
    return () => clearInterval(iv);
  }, [selectedProject]);

  const doRefresh = useCallback(async () => {
    if (!selectedProject) return;
    setRefreshing(true);
    try {
      const res = await api.refresh(selectedProject);
      setLastRefresh(res.lastRefresh);
      // Re-fetch issues after refresh
      const data = await api.issues(selectedProject);
      setIssues(data.issues || []);
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false);
    }
  }, [selectedProject]);

  async function selectProject(key) {
    setSelectedProject(key);
    setIssues([]);
    if (!key) return;
    try {
      const data = await api.issues(key);
      setIssues(data.issues || []);
      setLastRefresh(data.lastRefresh);
    } catch { /* ignore */ }
  }

  return (
    <div className="app">
      <StatusBar
        llm={llm}
        jiraOk={jiraOk}
        projectCount={projects.length}
        issueCount={issues.length}
        lastRefresh={lastRefresh}
        t={t}
      />

      <div className="toolbar">
        <div className="toolbar-left">
          <select
            className="input"
            value={selectedProject}
            onChange={(e) => selectProject(e.target.value)}
            style={{ minWidth: 180 }}
          >
            <option value="">{t.selectProject}</option>
            {projects.map((p) => (
              <option key={p.key} value={p.key}>{p.key} — {p.name}</option>
            ))}
          </select>

          <button
            className="btn-icon"
            onClick={doRefresh}
            disabled={refreshing || !selectedProject}
            title={t.refresh}
          >
            <motion.span
              animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
              transition={refreshing ? { duration: 1, repeat: Infinity, ease: 'linear' } : {}}
              style={{ display: 'flex' }}
            >
              <RefreshCw size={14} />
            </motion.span>
          </button>
        </div>

        <button
          className="btn-icon lang-btn"
          onClick={() => setLang((l) => l === 'en' ? 'de' : 'en')}
          title="Switch language"
        >
          <Globe size={13} style={{ marginRight: 4 }} />
          {lang === 'en' ? 'DE' : 'EN'}
        </button>
      </div>

      <div className="canvas">
        <AnimatePresence>
          <Widget id="tickets" title={t.tickets} defaultPos={POSITIONS.tickets} zMap={zMap} onFocus={focusWidget}>
            <TicketList issues={issues} t={t} />
          </Widget>

          <Widget id="insights" title={t.insights} defaultPos={POSITIONS.insights} zMap={zMap} onFocus={focusWidget}>
            <LLMInsights projectKey={selectedProject} issueCount={issues.length} t={t} lang={lang} />
          </Widget>

          <Widget id="roadmap" title={t.roadmap} defaultPos={POSITIONS.roadmap} zMap={zMap} onFocus={focusWidget}>
            <Roadmap t={t} />
          </Widget>

          <Widget id="idea" title={t.ideaEval} defaultPos={POSITIONS.idea} zMap={zMap} onFocus={focusWidget}>
            <IdeaEvaluator t={t} lang={lang} />
          </Widget>
        </AnimatePresence>
      </div>
    </div>
  );
}
