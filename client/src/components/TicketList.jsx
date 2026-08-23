import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';

const PRIORITY_COLOR = {
  Highest: '#e53e3e',
  High: '#e53e3e',
  Medium: '#aaa',
  Low: '#666',
  Lowest: '#444',
};

function Badge({ label, color }) {
  return (
    <span style={{ background: color || '#333', color: '#ddd', borderRadius: 3, padding: '1px 5px', fontSize: 10, marginLeft: 4 }}>
      {label}
    </span>
  );
}

export default function TicketList({ issues, t }) {
  const [q, setQ] = useState('');
  const filtered = (issues || []).filter(
    (i) =>
      !q ||
      i.key.toLowerCase().includes(q.toLowerCase()) ||
      i.fields.summary.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="ticketlist">
      <div className="tl-search">
        <Search size={12} style={{ marginRight: 6, opacity: 0.5 }} />
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.search}
        />
        <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>
          {filtered.length}
        </span>
      </div>
      <div className="tl-list">
        <AnimatePresence>
          {filtered.length === 0 && (
            <div className="muted" style={{ padding: '12px 0', fontSize: 12 }}>{t.noIssues}</div>
          )}
          {filtered.map((i, idx) => {
            const prio = i.fields.priority?.name;
            const status = i.fields.status?.name;
            const days = Math.floor(
              (Date.now() - new Date(i.fields.created)) / 86400000
            );
            return (
              <motion.div
                key={i.key}
                className="ticket-row"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.015 }}
              >
                <span className="ticket-key">{i.key}</span>
                <span className="ticket-summary">{i.fields.summary}</span>
                <div className="ticket-meta">
                  {prio && (
                    <Badge label={prio} color={PRIORITY_COLOR[prio] || '#555'} />
                  )}
                  {status && <Badge label={status} color="#2a2a2a" />}
                  <span className="muted" style={{ fontSize: 10, marginLeft: 4 }}>
                    {days}d
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
