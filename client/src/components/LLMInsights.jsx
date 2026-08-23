import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, AlertTriangle, Lightbulb, Clock, Layers } from 'lucide-react';
import { api } from '../api';

function Section({ icon, label, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="analysis-section">
      <button className="section-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {icon}
        <span>{label}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="section-content">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function LLMInsights({ projectKey, issueCount, t, lang }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function run() {
    if (!projectKey) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await api.analyze(projectKey, lang);
      setData(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="insights">
      <div className="insights-header">
        <button className="btn-primary" onClick={run} disabled={loading || !projectKey}>
          {loading ? (
            <span className="spinner" />
          ) : null}
          {loading ? t.analyzing : t.runAnalysis}
        </button>
        {issueCount > 0 && (
          <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
            {issueCount} tickets
          </span>
        )}
      </div>

      {err && <div className="error-text">{err}</div>}

      {!data && !loading && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t.noAnalysis}</div>
      )}

      {data && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="analysis-results"
        >
          {data.summary && (
            <div className="summary-block">{data.summary}</div>
          )}

          {data.suggestions?.length > 0 && (
            <Section icon={<Lightbulb size={12} style={{ marginRight: 4, color: '#e53e3e' }} />} label={t.suggestions} defaultOpen>
              {data.suggestions.map((s, i) => (
                <div key={i} className="analysis-item">
                  {s.key && <span className="ticket-key-sm">{s.key}</span>}
                  <span>{s.text}</span>
                </div>
              ))}
            </Section>
          )}

          {data.redundancies?.length > 0 && (
            <Section icon={<Layers size={12} style={{ marginRight: 4 }} />} label={t.redundancies}>
              {data.redundancies.map((r, i) => (
                <div key={i} className="analysis-item">
                  <span className="ticket-key-sm">{r.keys?.join(' + ')}</span>
                  <span>{r.reason}</span>
                </div>
              ))}
            </Section>
          )}

          {data.gaps?.length > 0 && (
            <Section icon={<AlertTriangle size={12} style={{ marginRight: 4, color: '#e53e3e' }} />} label={t.gaps}>
              {data.gaps.map((g, i) => (
                <div key={i} className="analysis-item">{g.text || g}</div>
              ))}
            </Section>
          )}

          {data.slowTickets?.length > 0 && (
            <Section icon={<Clock size={12} style={{ marginRight: 4 }} />} label={t.slowTickets}>
              {data.slowTickets.map((s, i) => (
                <div key={i} className="analysis-item">
                  <span className="ticket-key-sm">{s.key}</span>
                  <span className="muted">{s.daysOpen}d</span>
                  <span>{s.note}</span>
                </div>
              ))}
            </Section>
          )}
        </motion.div>
      )}
    </div>
  );
}
