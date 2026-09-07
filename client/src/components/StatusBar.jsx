import { motion, AnimatePresence } from 'framer-motion';
import { Cpu } from 'lucide-react';

const dot = (ok) => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  display: 'inline-block',
  backgroundColor: ok ? '#22c55e' : '#555',
  marginRight: 5,
  boxShadow: ok ? '0 0 6px #22c55e' : 'none',
});

export default function StatusBar({
  llm,
  llmSmoke,
  selectedModel,
  jiraOk,
  projectCount,
  issueCount,
  selectedProject,
  loadingProjectIssues,
  lastRefresh,
  t,
}) {
  const llmHealthy = Boolean(llm?.online) && llmSmoke?.ok !== false;
  const llmLabel = !llm?.online ? t.llmOffline : llmSmoke?.ok === false ? t.llmDegraded : t.llmOnline;
  const llmTitle = llmSmoke?.ok === false
    ? (llmSmoke.error || t.llmSmokeFailed)
    : (selectedModel || llm?.recommendedModel || llm?.defaultModel || '');
  return (
    <div className="statusbar">
      <span className="statusbar-brand">
        <img src="/lgln.jpeg" alt={t.appName} className="statusbar-logo" />
        <strong>{t.appName}</strong>
        <span className="statusbar-sub">{t.subtitle}</span>
      </span>

      <div className="statusbar-indicators">
        <AnimatePresence mode="wait">
          <motion.span
            key={llmHealthy ? 'on' : 'off'}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
            className="status-chip"
            title={llmTitle}
          >
            <Cpu size={11} style={{ marginRight: 4 }} />
            <span style={dot(llmHealthy)} />
            {llmLabel}
            {llm?.online && (selectedModel || llm.recommendedModel || llm.defaultModel) && (
              <span className="status-model"> · {(selectedModel || llm.recommendedModel || llm.defaultModel)}</span>
            )}
          </motion.span>
        </AnimatePresence>

        <span className="status-chip">
          <span style={dot(jiraOk)} />
          {jiraOk ? t.jiraConnected : t.jiraOffline}
          {jiraOk && projectCount != null && (
            <span className="status-model">
              {' · '}
              {projectCount} {t.projectsLabel}
              {selectedProject ? ` · ${loadingProjectIssues ? t.loading : issueCount} ${t.ticketsLabel}` : ''}
            </span>
          )}
        </span>

        {lastRefresh && (
          <span className="status-chip muted">
            {t.lastRefresh}: {new Date(lastRefresh).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}
