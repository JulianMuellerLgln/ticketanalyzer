import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Circle, RefreshCw, Upload, Trash2 } from 'lucide-react';
import { api } from '../api';

function RetryIcon() {
  return (
    <motion.span
      animate={{ rotate: 360 }}
      transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
      style={{ display: 'flex', alignItems: 'center', color: '#f0a500' }}
    >
      <RefreshCw size={12} />
    </motion.span>
  );
}

const STATUS_ICON = {
  pending:  <Circle size={12} style={{ color: '#666' }} />,
  done:     <CheckCircle size={12} style={{ color: '#4caf50' }} />,
  error:    <XCircle size={12} style={{ color: '#e53e3e' }} />,
  retrying: <RetryIcon />,
};

let nextId = 1;

const DEFAULT_TYPES = ['Task', 'Story', 'Bug', 'Epic'];

/**
 * Small hook that counts down from `seconds` to 0, updating every second.
 * Returns the current remaining seconds.
 */
function useCountdown(seconds) {
  const [remaining, setRemaining] = useState(() => seconds);
  const secondsRef = useRef(seconds);

  useEffect(() => {
    secondsRef.current = seconds;
    if (!seconds) { setRemaining(0); return; }
    // Fire immediately so the display doesn't show stale 0
    const end = Date.now() + seconds * 1000;
    const tick = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) clearInterval(iv);
    };
    const iv = setInterval(tick, 500);
    tick();
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  return remaining;
}

function TicketRow({ ticket, syncing, t, onUpdate, onRemove }) {
  const remaining = useCountdown(ticket.status === 'retrying' ? ticket.waitSeconds : 0);

  return (
    <motion.div
      key={ticket.id}
      className="js-row"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
    >
      <span className="js-status-icon">{STATUS_ICON[ticket.status] ?? STATUS_ICON.pending}</span>

      <input
        className="input js-summary"
        placeholder={t.syncSummaryPlaceholder}
        value={ticket.summary}
        disabled={syncing}
        onChange={(e) => onUpdate(ticket.id, 'summary', e.target.value)}
      />

      <select
        className="input js-type"
        value={ticket.issuetype}
        disabled={syncing}
        onChange={(e) => onUpdate(ticket.id, 'issuetype', e.target.value)}
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
        onChange={(e) => onUpdate(ticket.id, 'description', e.target.value)}
      />

      {ticket.key && (
        <span className="js-key">{ticket.key}</span>
      )}
      {ticket.status === 'retrying' && (
        <span className="js-retry-info muted" title={ticket.error}>
          {t.syncRetrying
            .replace('{attempt}', ticket.attempt)
            .replace('{max}', ticket.maxRetries)
            .replace('{s}', remaining)}
        </span>
      )}
      {ticket.status === 'error' && ticket.error && (
        <span className="js-err muted" title={ticket.error} style={{ color: '#e53e3e' }}>!</span>
      )}

      <button
        className="icon-btn"
        onClick={() => onRemove(ticket.id)}
        disabled={syncing}
        title={t.remove}
      >
        <Trash2 size={11} />
      </button>
    </motion.div>
  );
}

export default function JiraSync({ projectKey, t }) {
  const [tickets, setTickets] = useState([
    { id: nextId++, summary: '', description: '', issuetype: 'Task', status: 'pending', key: null, error: null, waitSeconds: 0, attempt: 0, maxRetries: 0 },
  ]);
  const [syncing, setSyncing] = useState(false);
  const [done, setDone] = useState(false);
  const [total, setTotal] = useState(0);
  const [progress, setProgress] = useState(0);
  const streamRef = useRef(null);

  function addRow() {
    setTickets((ts) => [
      ...ts,
      { id: nextId++, summary: '', description: '', issuetype: 'Task', status: 'pending', key: null, error: null, waitSeconds: 0, attempt: 0, maxRetries: 0 },
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

    setTickets((ts) => ts.map((t) => ({ ...t, status: 'pending', key: null, error: null, waitSeconds: 0, attempt: 0 })));
    setSyncing(true);
    setDone(false);
    setTotal(valid.length);
    setProgress(0);

    const payload = valid.map(({ summary, description, issuetype }) => ({ summary, description, issuetype }));
    const idMap = valid.map((t) => t.id);

    const stream = await api.syncToJira(projectKey, payload, {
      onProgress: ({ index, status, key, error }) => {
        const ticketId = idMap[index];
        setTickets((ts) =>
          ts.map((t) =>
            t.id === ticketId
              ? { ...t, status, key: key || null, error: error || null, waitSeconds: 0 }
              : t
          )
        );
        setProgress((p) => p + 1);
      },
      onRetrying: ({ index, attempt, maxRetries, waitSeconds, error }) => {
        const ticketId = idMap[index];
        setTickets((ts) =>
          ts.map((t) =>
            t.id === ticketId
              ? { ...t, status: 'retrying', attempt, maxRetries, waitSeconds, error: error || null }
              : t
          )
        );
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
      <div className="js-table">
        <AnimatePresence>
          {tickets.map((ticket) => (
            <TicketRow
              key={ticket.id}
              ticket={ticket}
              syncing={syncing}
              t={t}
              onUpdate={update}
              onRemove={removeRow}
            />
          ))}
        </AnimatePresence>
      </div>

      {(syncing || done) && total > 0 && (
        <div className="js-progress-wrap">
          <div className="js-progress-bar" style={{ width: `${pct}%` }} />
          <span className="js-progress-label muted">{progress}/{total} ({pct}%)</span>
        </div>
      )}

      <div className="js-actions">
        <button className="btn-primary" onClick={addRow} disabled={syncing}>
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
