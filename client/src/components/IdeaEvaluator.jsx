import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';

const LEVEL_COLOR = { high: '#e53e3e', medium: '#888', low: '#555' };

function Meter({ label, value }) {
  const pct = { high: 100, medium: 60, low: 25 }[value] || 0;
  return (
    <div className="meter-row">
      <span className="meter-label">{label}</span>
      <div className="meter-track">
        <motion.div
          className="meter-fill"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5 }}
          style={{ background: LEVEL_COLOR[value] }}
        />
      </div>
      <span className="meter-val" style={{ color: LEVEL_COLOR[value] }}>{value}</span>
    </div>
  );
}

export default function IdeaEvaluator({ t, lang, llmModel }) {
  const [idea, setIdea] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function evaluate() {
    if (!idea.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await api.evaluateIdea(idea.trim(), lang, llmModel);
      setResult(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="idea-eval">
      <textarea
        className="input idea-textarea"
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder={t.ideaPlaceholder}
        rows={3}
      />
      <button
        className="btn-primary"
        onClick={evaluate}
        disabled={loading || !idea.trim()}
        style={{ marginTop: 8 }}
      >
        {loading && <span className="spinner" />}
        {loading ? t.evaluating : t.evaluate}
      </button>

      {err && <div className="error-text">{err}</div>}

      <AnimatePresence>
        {result && (
          <motion.div
            className="eval-result"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Meter label={t.feasibility} value={result.feasibility} />
            <Meter label={t.effort} value={result.effort} />
            <Meter label={t.value} value={result.value} />

            {result.verdict && (
              <div className="verdict">{result.verdict}</div>
            )}

            {result.risks?.length > 0 && (
              <div className="eval-section">
                <div className="eval-section-label">{t.risks}</div>
                {result.risks.map((r, i) => (
                  <div key={i} className="eval-item">· {r}</div>
                ))}
              </div>
            )}

            {result.nextSteps?.length > 0 && (
              <div className="eval-section">
                <div className="eval-section-label">{t.nextSteps}</div>
                {result.nextSteps.map((s, i) => (
                  <div key={i} className="eval-item">→ {s}</div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
