import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Globe, BookOpenText } from 'lucide-react';

import { api } from './api';
import { i18n } from './i18n';
import StatusBar from './components/StatusBar';
import TicketList from './components/TicketList';
import LLMInsights from './components/LLMInsights';
import IdeaEvaluator from './components/IdeaEvaluator';
import Roadmap from './components/Roadmap';
import JiraSync from './components/JiraSync';
import ScrumGuideModal from './components/ScrumGuideModal';
import MiddleScrollArea from './components/MiddleScrollArea';

const LLM_MODEL_STORAGE_KEY = 'ticketanalyzer.llmModel';

function Widget({ title, children, className = '' }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`widget ${className}${expanded ? ' widget--expanded' : ''}`}>
      <div className="wh">
        <span className="widget-title">{title}</span>
        <button
          className="icon-btn"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Minimize' : 'Maximize'}
        >
          {expanded ? '⊡' : '⊞'}
        </button>
      </div>
      <MiddleScrollArea className="widget-body">{children}</MiddleScrollArea>
    </div>
  );
}

export default function App() {
  const [lang, setLang] = useState('en');
  const t = i18n[lang];
  const [workflowMode, setWorkflowMode] = useState('daily');
  const [showScrumGuide, setShowScrumGuide] = useState(false);

  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [issues, setIssues] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [jiraOk, setJiraOk] = useState(false);
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');

  const [llm, setLlm] = useState({ online: false, models: [], defaultModel: '', recommendedModel: '' });
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem(LLM_MODEL_STORAGE_KEY) || '');
  const topbarRef = useRef(null);

  // Poll LLM health every 15s
  useEffect(() => {
    const check = () => api.llmHealth().then(setLlm).catch(() => setLlm({ online: false, models: [], defaultModel: '', recommendedModel: '' }));
    check();
    const iv = setInterval(check, 15000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (selectedModel) {
      localStorage.setItem(LLM_MODEL_STORAGE_KEY, selectedModel);
    }
  }, [selectedModel]);

  useEffect(() => {
    const availableModels = llm.models || [];
    const savedModel = localStorage.getItem(LLM_MODEL_STORAGE_KEY) || '';
    const currentValid = selectedModel && availableModels.includes(selectedModel);
    if (currentValid) return;

    if (savedModel && availableModels.includes(savedModel)) {
      setSelectedModel(savedModel);
      return;
    }

    const recommended = llm.recommendedModel || llm.defaultModel || availableModels[0] || '';
    if (recommended && recommended !== selectedModel) {
      setSelectedModel(recommended);
    }
  }, [llm.defaultModel, llm.models, llm.recommendedModel, selectedModel]);

  // Load projects on mount
  useEffect(() => {
    Promise.allSettled([api.projects(), api.jiraHealth()]).then((results) => {
      const [projectsRes, healthRes] = results;
      if (projectsRes.status === 'fulfilled') {
        setProjects(projectsRes.value);
        setJiraOk(true);
      } else {
        setJiraOk(false);
      }

      if (healthRes.status === 'fulfilled') {
        setJiraBaseUrl(healthRes.value?.baseUrl || '');
      }
    });
  }, []);

  const doRefresh = useCallback(async () => {
    if (!selectedProject) return;
    setRefreshing(true);
    try {
      const res = await api.refresh(selectedProject);
      setLastRefresh(res.lastRefresh);
      const data = await api.issues(selectedProject);
      setIssues(data.issues || []);
      setJiraOk(true);
    } catch {
      setJiraOk(false);
    } finally {
      setRefreshing(false);
    }
  }, [selectedProject]);

  // Auto-refresh hourly
  useEffect(() => {
    if (!selectedProject) return;
    const iv = setInterval(() => doRefresh(), 3600000);
    return () => clearInterval(iv);
  }, [selectedProject, doRefresh]);

  async function selectProject(key) {
    setSelectedProject(key);
    setIssues([]);
    if (!key) return;
    try {
      const data = await api.issues(key);
      setIssues(data.issues || []);
      setLastRefresh(data.lastRefresh);
      setJiraOk(true);
    } catch {
      setJiraOk(false);
    }
  }

  useEffect(() => {
    function syncTopbarHeight() {
      const topbar = topbarRef.current;
      const height = topbar ? topbar.offsetHeight : 0;
      document.documentElement.style.setProperty('--app-topbar-height', `${height}px`);
    }

    syncTopbarHeight();
    window.addEventListener('resize', syncTopbarHeight);
    return () => {
      window.removeEventListener('resize', syncTopbarHeight);
      document.documentElement.style.removeProperty('--app-topbar-height');
    };
  }, []);

  return (
    <div className="app">
      <div className="app-topbar" ref={topbarRef}>
        <StatusBar
          llm={llm}
          selectedModel={selectedModel}
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
              {projects.map((p, idx) => (
                <option key={`${p.id || 'project'}-${p.key || idx}`} value={p.key || ''}>
                  {p.key || 'UNKNOWN'} — {p.name}
                </option>
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

          <div className="mode-switch" role="tablist" aria-label={t.workflowMode}>
            {['refinement', 'planning', 'daily'].map((mode) => (
              <button
                key={mode}
                className={`mode-switch-btn${workflowMode === mode ? ' mode-switch-btn--active' : ''}`}
                onClick={() => setWorkflowMode(mode)}
                type="button"
              >
                {t.workflowModes[mode]}
              </button>
            ))}
          </div>

          <div className="toolbar-right">
            <select
              className="input"
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
              disabled={!llm.online || (llm.models || []).length === 0}
              title={t.model}
              style={{ minWidth: 200 }}
            >
              {(() => {
                const options = llm.models || [];
                if (options.length === 0) {
                  const fallback = llm.recommendedModel || llm.defaultModel || '';
                  return <option value={fallback}>{fallback || t.loading}</option>;
                }
                return options.map((modelName) => (
                  <option key={modelName} value={modelName}>
                    {modelName}{modelName === llm.recommendedModel ? ` · ${t.recommended}` : ''}
                  </option>
                ));
              })()}
            </select>

            <button
              className="btn-icon"
              onClick={() => setShowScrumGuide(true)}
              title={t.scrumGuideTitle}
              type="button"
            >
              <BookOpenText size={14} />
              {t.scrumGuideButton}
            </button>

            <button
              className="btn-icon lang-btn"
              onClick={() => setLang((l) => l === 'en' ? 'de' : 'en')}
              title="Switch language"
            >
              <Globe size={13} style={{ marginRight: 4 }} />
              {lang === 'en' ? 'DE' : 'EN'}
            </button>
          </div>
        </div>
      </div>

      <div className="canvas">
        <AnimatePresence>
          <Widget
            key="widget-tickets"
            title={t.sprintBoard}
            className="widget--wide"
          >
            <TicketList
              issues={issues}
              projectKey={selectedProject}
              t={t}
              jiraBaseUrl={jiraBaseUrl}
              workflowMode={workflowMode}
              lang={lang}
              onRefresh={doRefresh}
              llmModel={selectedModel}
            />
          </Widget>

          <Widget key="widget-jirasync" title={t.syncStart}>
            <JiraSync projectKey={selectedProject} t={t} jiraBaseUrl={jiraBaseUrl} />
          </Widget>

          <Widget key="widget-roadmap" title={t.roadmap}>
            <Roadmap t={t} issues={issues} jiraBaseUrl={jiraBaseUrl} />
          </Widget>

          <Widget key="widget-insights" title={t.insights}>
            <LLMInsights projectKey={selectedProject} issueCount={issues.length} t={t} lang={lang} jiraBaseUrl={jiraBaseUrl} llmModel={selectedModel} />
          </Widget>

          <Widget key="widget-idea" title={t.ideaEval}>
            <IdeaEvaluator t={t} lang={lang} llmModel={selectedModel} />
          </Widget>
        </AnimatePresence>
      </div>

      <ScrumGuideModal open={showScrumGuide} onClose={() => setShowScrumGuide(false)} t={t} />
    </div>
  );
}
