import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Globe, BookOpenText, ChevronDown, ChevronUp } from 'lucide-react';

import { api } from './api';
import { i18n } from './i18n';
import StatusBar from './components/StatusBar';
import TicketList from './components/TicketList';
import LLMInsights from './components/LLMInsights';
import IdeaEvaluator from './components/IdeaEvaluator';
import Roadmap from './components/Roadmap';
import JiraSync from './components/JiraSync';
import ScrumGuideModal from './components/ScrumGuideModal';
import TeamStandardsModal from './components/TeamStandardsModal';
import MiddleScrollArea from './components/MiddleScrollArea';

const LLM_MODEL_STORAGE_KEY = 'ticketanalyzer.llmModel';

function Widget({ title, children, className = '', defaultCollapsed = false }) {
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className={`widget ${className}${expanded ? ' widget--expanded' : ''}${collapsed ? ' widget--collapsed' : ''}`}>
      <div className="wh">
        <span className="widget-title">{title}</span>
        <div className="widget-controls">
          <button
            className="icon-btn widget-collapse-btn"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? 'Expand' : 'Collapse'}
            type="button"
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            className="icon-btn widget-expand-btn"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Minimize' : 'Maximize'}
            type="button"
          >
            {expanded ? '⊡' : '⊞'}
          </button>
        </div>
      </div>
      {!collapsed && <MiddleScrollArea className="widget-body">{children}</MiddleScrollArea>}
    </div>
  );
}

export default function App() {
  const [lang, setLang] = useState('en');
  const t = i18n[lang];
  const [workflowMode, setWorkflowMode] = useState('daily');
  const [showScrumGuide, setShowScrumGuide] = useState(false);
  const [showTeamStandards, setShowTeamStandards] = useState(false);

  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [issues, setIssues] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingProjectIssues, setLoadingProjectIssues] = useState(false);
  const [jiraOk, setJiraOk] = useState(false);
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');

  const [llm, setLlm] = useState({ online: false, models: [], defaultModel: '', recommendedModel: '' });
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem(LLM_MODEL_STORAGE_KEY) || '');
  const [llmSmoke, setLlmSmoke] = useState({ loading: false, ok: null, response: '', error: '', model: '', durationMs: 0 });
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
    setLoadingProjectIssues(true);
    try {
      const res = await api.refresh(selectedProject);
      setLastRefresh(res.lastRefresh);
      const data = await api.issues(selectedProject);
      setIssues(data.issues || []);
      setJiraOk(true);
    } catch {
      setIssues([]);
      setJiraOk(false);
    } finally {
      setLoadingProjectIssues(false);
      setRefreshing(false);
    }
  }, [selectedProject]);

  const runLlmSmokeTest = useCallback(async () => {
    setLlmSmoke({ loading: true, ok: null, response: '', error: '', model: '', durationMs: 0 });
    try {
      const result = await api.llmSmokeTest(selectedModel);
      setLlmSmoke({
        loading: false,
        ok: Boolean(result?.ok),
        response: String(result?.response || '').trim(),
        error: '',
        model: String(result?.model || selectedModel || ''),
        durationMs: Number(result?.durationMs) || 0,
      });
    } catch (error) {
      setLlmSmoke({
        loading: false,
        ok: false,
        response: '',
        error: error?.response?.data?.error || error.message || 'LLM smoke test failed',
        model: selectedModel,
        durationMs: 0,
      });
    }
  }, [selectedModel]);

  // Auto-refresh hourly
  useEffect(() => {
    if (!selectedProject) return;
    const iv = setInterval(() => doRefresh(), 3600000);
    return () => clearInterval(iv);
  }, [selectedProject, doRefresh]);

  async function selectProject(key) {
    setSelectedProject(key);
    if (!key) {
      setIssues([]);
      setLoadingProjectIssues(false);
      return;
    }
    setLoadingProjectIssues(true);
    try {
      const data = await api.issues(key);
      setIssues(data.issues || []);
      setLastRefresh(data.lastRefresh);
      setJiraOk(true);
    } catch {
      setIssues([]);
      setJiraOk(false);
    } finally {
      setLoadingProjectIssues(false);
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
          selectedProject={selectedProject}
          loadingProjectIssues={loadingProjectIssues}
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
              onClick={runLlmSmokeTest}
              disabled={!llm.online || (llm.models || []).length === 0 || llmSmoke.loading}
              title={t.llmSmokeTest}
              type="button"
            >
              {llmSmoke.loading ? t.llmSmokeRunning : t.llmSmokeTest}
            </button>

            {llmSmoke.ok !== null && (
              <span
                className={`toolbar-chip${llmSmoke.ok ? ' toolbar-chip--ok' : ' toolbar-chip--error'}`}
                title={llmSmoke.ok
                  ? `${llmSmoke.model} · ${llmSmoke.response}`
                  : `${llmSmoke.model} · ${llmSmoke.error}`}
              >
                {llmSmoke.ok ? t.llmSmokeOk : t.llmSmokeFailed}
                {llmSmoke.model ? ` · ${llmSmoke.model}` : ''}
                {llmSmoke.durationMs > 0 ? ` · ${Math.round(llmSmoke.durationMs / 100) / 10}s` : ''}
                {llmSmoke.ok && llmSmoke.response ? ` · ${llmSmoke.response}` : ''}
              </span>
            )}

            <button
              className="btn-icon"
              onClick={() => setShowTeamStandards(true)}
              title={t.teamStandardsTitle}
              type="button"
            >
              {t.teamStandardsButton}
            </button>

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
          <div className="dashboard-layout">
            <div className="dashboard-main-column">
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
            </div>

            <div className="dashboard-right-rail">
              <Widget key="widget-jirasync" title={t.syncStart} className="widget--right-rail">
                <JiraSync projectKey={selectedProject} t={t} jiraBaseUrl={jiraBaseUrl} />
              </Widget>

              <Widget key="widget-insights" title={t.insights} className="widget--right-rail">
                <LLMInsights projectKey={selectedProject} issueCount={issues.length} t={t} lang={lang} jiraBaseUrl={jiraBaseUrl} llmModel={selectedModel} />
              </Widget>

              <Widget key="widget-idea" title={t.ideaEval} className="widget--right-rail">
                <IdeaEvaluator t={t} lang={lang} llmModel={selectedModel} />
              </Widget>

              <Widget key="widget-roadmap" title={t.roadmap} className="widget--right-rail" defaultCollapsed>
                <Roadmap t={t} issues={issues} jiraBaseUrl={jiraBaseUrl} />
              </Widget>
            </div>
          </div>
        </AnimatePresence>
      </div>

      <ScrumGuideModal open={showScrumGuide} onClose={() => setShowScrumGuide(false)} t={t} />
      <TeamStandardsModal open={showTeamStandards} onClose={() => setShowTeamStandards(false)} t={t} />
    </div>
  );
}
