import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Circle, Upload, Trash2 } from 'lucide-react';
import { api } from '../api';

const STATUS_ICON = {
  pending: <Circle size={12} style={{ color: '#666' }} />,
  done:    <CheckCircle size={12} style={{ color: '#4caf50' }} />,
  error:   <XCircle size={12} style={{ color: '#e53e3e' }} />,
};

let nextId = 1;

const DEFAULT_TYPES = ['Task', 'Story', 'Bug', 'Epic'];

export default function JiraSync({ projectKey, t }) {
  const [tickets, setTickets] = useState([
    { id: nextId++, summary: '', description: '', issuetype: 'Task', status: 'pending', key: null, error: null },
  ]);
  const [syncing, setSyncing] = useState(false);
  const [done, setDone] = useState(false);
  const [total, setTotal] = useState(0);
  const [progress, setProgress] = useState(0);
  const streamRef = useRef(null);

  function addRow() {
    setTickets((ts) => [
      ...ts,
      { id: nextId++, summary: '', description: '', issuetype: 'Task', status: 'pending', key: null, error: null },
    ]);
  }

  function removeRow(id) {
    setTickets((ts) => ts.filter((t) => t.id !== id));
  }

  function update(id, field, value) {
    setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  }

  async function startSync() {
    if (!projectKey) return;
    const valid = tickets.filter((t) => t.summary.trim());
    if (!valid.length) return;

    // Reset status
    setTickets((ts) => ts.map((t) => ({ ...t, status: 'pending', key: null, error: null })));
    setSyncing(true);
    setDone(false);
    setTotal(valid.length);
    setProgress(0);

    const payload = valid.map(({ summary, description, issuetype }) => ({ summary, description, issuetype }));
    const idMap = valid.map((t) => t.id); // map index → original ticket id

    const stream = await api.syncToJira(projectKey, payload, {
      onProgress: ({ index, status, key, error }) => {
        const ticketId = idMap[index];
        setTickets((ts) =>
          ts.map((t) =>
            t.id === ticketId
              ? { ...t, status, key: key || null, error: error || null }
              : t
          )
        );
        setProgress((p) => p + 1);
      },
      onDone: () => {
        setSyncing(false);
        setDone(true);
      },
      onError: (msg) => {
        setSyncing(false);
        console.error('[JiraSync] stream error:', msg);
      },
    });
    streamRef.current = stream;
  }

  function cancel() {
    streamRef.current?.close();
    setSyncing(false);
  }

  const filledCount = tickets.filter((t) => t.summary.trim()).length;
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <div className="jirasync">
      {/* Ticket editor table */}
      <div className="js-table">
        <AnimatePresence>
          {tickets.map((ticket, idx) => (
            <motion.div
              key={ticket.id}
              className="js-row"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ delay: idx * 0.04 }}
            >
              <span className="js-status-icon">{STATUS_ICON[ticket.status]}</span>

              <input
                className="input js-summary"
                placeholder={t.syncSummaryPlaceholder}
                value={ticket.summary}
                disabled={syncing}
                onChange={(e) => update(ticket.id, 'summary', e.target.value)}
              />

              <select
                className="input js-type"
                value={ticket.issuetype}
                disabled={syncing}
                onChange={(e) => update(ticket.id, 'issuetype', e.target.value)}
              >
                {DEFAULT_TYPES.map((tp) => (
                  <option key={tp} value={tp}>{tp}</option>
                ))}
              </select>

              <input
                className="input js-desc"
                placeholder={t.syncDescPlaceholder}
                value={ticket.description}
                disabled={syncing}
                onChange={(e) => update(ticket.id, 'description', e.target.value)}
              />

              {ticket.key && (
                <span className="js-key muted">{ticket.key}</span>
              )}
              {ticket.error && (
                <span className="js-err muted" title={ticket.error} style={{ color: '#e53e3e' }}>!</span>
              )}

              <button
                className="icon-btn"
                onClick={() => removeRow(ticket.id)}
                disabled={syncing}
                title={t.remove}
              >
                <Trash2 size={11} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Progress bar */}
      {(syncing || done) && total > 0 && (
        <div className="js-progress-wrap">
          <div className="js-progress-bar" style={{ width: `${pct}%` }} />
          <span className="js-progress-label muted">{progress}/{total} ({pct}%)</span>
        </div>
      )}

      {/* Actions */}
      <div className="js-actions">
        <button
          className="btn-primary"
          onClick={addRow}
          disabled={syncing}
        >
          + {t.add}
        </button>

        {syncing ? (
          <button className="btn-icon" onClick={cancel} title={t.cancel}>
            ✕ {t.cancel}
          </button>
        ) : (
          <button
            className="btn-primary"
            onClick={startSync}
            disabled={!projectKey || filledCount === 0}
            title={!projectKey ? t.syncNoProject : undefined}
          >
            <Upload size={12} style={{ marginRight: 5 }} />
            {done ? t.syncAgain : t.syncStart}
          </button>
        )}
      </div>

      {!projectKey && (
        <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>{t.syncNoProject}</p>
      )}
    </div>
  );
}
