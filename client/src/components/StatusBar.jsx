import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Zap } from 'lucide-react';

const dot = (ok) => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  display: 'inline-block',
  backgroundColor: ok ? '#e53e3e' : '#555',
  marginRight: 5,
  boxShadow: ok ? '0 0 6px #e53e3e' : 'none',
});

export default function StatusBar({ llm, jiraOk, projectCount, issueCount, lastRefresh, t }) {
  return (
    <div className="statusbar">
      <span className="statusbar-brand">
        <Zap size={16} style={{ color: '#e53e3e', marginRight: 6 }} />
        <strong>{t.appName}</strong>
        <span className="statusbar-sub">{t.subtitle}</span>
      </span>

      <div className="statusbar-indicators">
        <AnimatePresence mode="wait">
          <motion.span
            key={llm?.online ? 'on' : 'off'}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
            className="status-chip"
          >
            <Cpu size={11} style={{ marginRight: 4 }} />
            <span style={dot(llm?.online)} />
            {llm?.online ? t.llmOnline : t.llmOffline}
            {llm?.online && llm.models?.length > 0 && (
              <span className="status-model"> · {llm.models[0]}</span>
            )}
          </motion.span>
        </AnimatePresence>

        <span className="status-chip">
          <span style={dot(jiraOk)} />
          {jiraOk ? t.jiraConnected : t.jiraOffline}
          {jiraOk && projectCount != null && (
            <span className="status-model"> · {projectCount}p {issueCount}t</span>
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
