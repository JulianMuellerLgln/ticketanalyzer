import { motion, AnimatePresence } from 'framer-motion';
import TicketLink from './TicketLink';

const STATUS_COLOR = { open: '#555', 'in progress': '#888', done: '#e53e3e' };

function normalizeStatus(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.includes('done') || v.includes('erledigt') || v.includes('closed')) return 'done';
  if (v.includes('progress') || v.includes('arbeit') || v.includes('doing')) return 'in progress';
  return 'open';
}

function milestoneDate(issue) {
  const due = issue?.fields?.duedate;
  const updated = issue?.fields?.updated;
  return due || (updated ? new Date(updated).toISOString().slice(0, 10) : '');
}

function milestoneReactKey(issue, idx) {
  const key = String(issue?.key || '').trim();
  if (key) return `ms-key-${key}`;
  const id = String(issue?.id || '').trim();
  if (id) return `ms-id-${id}`;
  return `issue-${idx}`;
}

export default function Roadmap({ t, issues = [], jiraBaseUrl }) {
  const milestones = (issues || []).slice(0, 120)
    .map((issue, idx) => ({
      id: milestoneReactKey(issue, idx),
      key: issue.key,
      title: issue.fields?.summary || t.noData,
      date: milestoneDate(issue),
      status: normalizeStatus(issue.fields?.status?.name),
    }))
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    })
    .slice(0, 40);

  return (
    <div className="roadmap">
      <div className="roadmap-timeline">
        {milestones.length === 0 && (
          <div className="muted" style={{ fontSize: 12, padding: '8px 0' }}>
            {t.noIssues}
          </div>
        )}
        <AnimatePresence>
          {milestones.map((ms, idx) => (
            <motion.div
              key={ms.id}
              className="milestone"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ delay: idx * 0.05 }}
            >
              <div
                className="milestone-dot"
                style={{ background: STATUS_COLOR[ms.status] || '#444' }}
              />
              <div className="milestone-line" />
              <div className="milestone-body">
                <span className="milestone-title">
                  {ms.key ? (
                    <>
                      <TicketLink ticketKey={ms.key} baseUrl={jiraBaseUrl} className="ticket-key-sm" /> - {ms.title}
                    </>
                  ) : ms.title}
                </span>
                {ms.date && <span className="milestone-date">{ms.date}</span>}
                <span
                  className="milestone-status"
                  style={{ color: STATUS_COLOR[ms.status] || '#888' }}
                >
                  {ms.status}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
