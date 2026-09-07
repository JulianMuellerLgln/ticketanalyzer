import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, AlertTriangle, Lightbulb, Clock, Layers, HeartPulse, ListChecks } from 'lucide-react';
import { api } from '../api';
import TicketLink, { linkifyTicketText } from './TicketLink';

function LinkedText({ text, jiraBaseUrl }) {
  const parts = linkifyTicketText(text, jiraBaseUrl);
  return (
    <>
      {parts.map((p, idx) => {
        if (p.type === 'ticket') {
          return (
            <TicketLink
              key={`${p.value}-${idx}`}
              ticketKey={p.value}
              baseUrl={jiraBaseUrl}
              className="ticket-key-sm"
            />
          );
        }
        return <span key={`txt-${idx}`}>{p.value}</span>;
      })}
    </>
  );
}

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

export default function LLMInsights({ projectKey, issueCount, t, lang, jiraBaseUrl, llmModel }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [activeFocus, setActiveFocus] = useState('overview');

  async function run(focus = 'overview') {
    if (!projectKey || issueCount <= 0) {
      setErr(t.noIssues);
      return;
    }
    setLoading(true);
    setErr(null);
    setActiveFocus(focus);
    try {
      const res = await api.analyze(projectKey, lang, llmModel, focus);
      setData((previous) => focus === 'overview' ? res : { ...(previous || {}), ...res });
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  }

  const focusButtons = [
    { key: 'overview', label: t.analysisOverview || t.runAnalysis },
    { key: 'suggestions', label: t.analysisSuggestions || t.suggestions },
    { key: 'redundancies', label: t.analysisDuplicates || t.redundancies },
    { key: 'gaps', label: t.gaps },
    { key: 'slowTickets', label: t.analysisSlowTickets || t.slowTickets },
    { key: 'backlogRefinementCandidates', label: t.analysisRefinement || t.backlogRefinement },
  ];

  return (
    <div className="insights">
      <div className="insights-header">
        <div className="insights-focus-actions">
          {focusButtons.map((focus) => (
            <button
              key={focus.key}
              className={`btn-icon insights-focus-btn${activeFocus === focus.key ? ' insights-focus-btn--active' : ''}`}
              onClick={() => run(focus.key)}
              disabled={loading || !projectKey || issueCount <= 0}
              type="button"
            >
              {loading && activeFocus === focus.key ? <span className="spinner" /> : null}
              {focus.label}
            </button>
          ))}
        </div>
        {issueCount > 0 && (
          <span className="muted insights-ticket-count">
            {issueCount} {t.ticketsLabel || 'tickets'}
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

          {data.coverage && (
            <div className="workflow-meta-row" style={{ marginBottom: 8 }}>
              <span className="workflow-chip">
                {data.coverage.usedAllTickets ? t.analysisAllTickets : `${data.coverage.sampledTickets}/${data.coverage.analyzedTickets}`}
              </span>
              {data.coverage.usedAllTickets && (
                <span className="workflow-chip">{data.coverage.analyzedTickets} {t.ticketsLabel || 'tickets'}</span>
              )}
            </div>
          )}

          {data.plannedVsDone && (
              <Section icon={<HeartPulse size={12} style={{ marginRight: 4 }} />} label={t.plannedVsDone} defaultOpen>
              <div className="analysis-item"><strong>{t.periodAssumption}:</strong> <span><LinkedText text={data.plannedVsDone.periodAssumption || t.noData} jiraBaseUrl={jiraBaseUrl} /></span></div>
              <div className="analysis-item"><strong>{t.plannedCount}:</strong> <span>{data.plannedVsDone.plannedCount ?? '-'}</span></div>
              <div className="analysis-item"><strong>{t.doneCount}:</strong> <span>{data.plannedVsDone.doneCount ?? '-'}</span></div>
              <div className="analysis-item"><strong>{t.completionRate}:</strong> <span>{data.plannedVsDone.completionRate ?? '-'}%</span></div>
              <div className="analysis-item"><strong>{t.atRiskCount}:</strong> <span>{data.plannedVsDone.atRiskCount ?? '-'}</span></div>
              {data.plannedVsDone.notes && (
                <div className="analysis-item"><strong>{t.notes}:</strong> <span><LinkedText text={data.plannedVsDone.notes} jiraBaseUrl={jiraBaseUrl} /></span></div>
              )}
            </Section>
          )}

          {data.sprintHealth && (
            <Section icon={<HeartPulse size={12} style={{ marginRight: 4, color: '#e53e3e' }} />} label={t.sprintHealth} defaultOpen>
              <div className="analysis-item"><strong>{t.overall}:</strong> <span>{data.sprintHealth.overall || '-'}</span></div>
              {(data.sprintHealth.blockers || []).map((b, i) => (
                <div key={`blocker-${i}-${(b || '').slice(0, 24)}`} className="analysis-item">
                  <strong>{t.blockers}:</strong> <span><LinkedText text={b} jiraBaseUrl={jiraBaseUrl} /></span>
                </div>
              ))}
              {(data.sprintHealth.deliveryRisks || []).map((r, i) => (
                <div key={`risk-${i}-${(r || '').slice(0, 24)}`} className="analysis-item">
                  <strong>{t.deliveryRisks}:</strong> <span><LinkedText text={r} jiraBaseUrl={jiraBaseUrl} /></span>
                </div>
              ))}
              {(data.sprintHealth.followUps || []).map((f, i) => (
                <div key={`followup-${i}-${(f || '').slice(0, 24)}`} className="analysis-item">
                  <strong>{t.followUps}:</strong> <span><LinkedText text={f} jiraBaseUrl={jiraBaseUrl} /></span>
                </div>
              ))}
            </Section>
          )}

          {data.backlogRefinementCandidates?.length > 0 && (
            <Section icon={<ListChecks size={12} style={{ marginRight: 4 }} />} label={t.backlogRefinement}>
              {data.backlogRefinementCandidates.map((c, i) => (
                <div key={`${c?.key || 'refine'}-${i}`} className="analysis-item">
                  {c?.key && <TicketLink ticketKey={c.key} baseUrl={jiraBaseUrl} className="ticket-key-sm" />}
                  <span><LinkedText text={c?.reason || t.noData} jiraBaseUrl={jiraBaseUrl} /></span>
                  {Array.isArray(c?.missing) && c.missing.length > 0 && (
                    <span className="muted">({c.missing.join(', ')})</span>
                  )}
                </div>
              ))}
            </Section>
          )}

          {data.suggestions?.length > 0 && (
            <Section icon={<Lightbulb size={12} style={{ marginRight: 4, color: '#e53e3e' }} />} label={t.suggestions} defaultOpen>
              {data.suggestions.map((s, i) => (
                <div key={`${s?.key || 'suggestion'}-${i}-${(s?.text || '').slice(0, 24)}`} className="analysis-item">
                  {s.key && <TicketLink ticketKey={s.key} baseUrl={jiraBaseUrl} className="ticket-key-sm" />}
                  <span><LinkedText text={s.text} jiraBaseUrl={jiraBaseUrl} /></span>
                </div>
              ))}
            </Section>
          )}

          {data.redundancies?.length > 0 && (
            <Section icon={<Layers size={12} style={{ marginRight: 4 }} />} label={t.redundancies}>
              {data.redundancies.map((r, i) => (
                <div key={`${(r?.keys || []).join('+') || 'redundancy'}-${i}`} className="analysis-item">
                  <span>
                    {(r.keys || []).map((k, kIdx) => (
                      <span key={`${k}-${kIdx}`}>
                        {kIdx > 0 ? ' + ' : ''}
                        <TicketLink ticketKey={k} baseUrl={jiraBaseUrl} className="ticket-key-sm" />
                      </span>
                    ))}
                  </span>
                  <span><LinkedText text={r.reason} jiraBaseUrl={jiraBaseUrl} /></span>
                </div>
              ))}
            </Section>
          )}

          {data.gaps?.length > 0 && (
            <Section icon={<AlertTriangle size={12} style={{ marginRight: 4, color: '#e53e3e' }} />} label={t.gaps}>
              {data.gaps.map((g, i) => (
                <div key={`${(g?.text || g || 'gap').toString().slice(0, 24)}-${i}`} className="analysis-item">
                  <LinkedText text={g.text || g} jiraBaseUrl={jiraBaseUrl} />
                </div>
              ))}
            </Section>
          )}

          {data.slowTickets?.length > 0 && (
            <Section icon={<Clock size={12} style={{ marginRight: 4 }} />} label={t.slowTickets}>
              {data.slowTickets.map((s, i) => (
                <div key={`${s?.key || 'slow'}-${i}`} className="analysis-item">
                  <TicketLink ticketKey={s.key} baseUrl={jiraBaseUrl} className="ticket-key-sm" />
                  <span className="muted">{s.daysOpen}d</span>
                  <span><LinkedText text={s.note} jiraBaseUrl={jiraBaseUrl} /></span>
                </div>
              ))}
            </Section>
          )}
        </motion.div>
      )}
    </div>
  );
}
