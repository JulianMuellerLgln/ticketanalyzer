import { AnimatePresence, motion } from 'framer-motion';
import TicketLink from './TicketLink';

const STATUS_COLOR = { done: '#22c55e', open: '#666', 'in progress': '#888' };

function normalizeStatus(raw) {
  const value = String(raw || '').toLowerCase();
  if (value.includes('done') || value.includes('erledigt') || value.includes('closed') || value.includes('fertig')) return 'done';
  if (value.includes('progress') || value.includes('arbeit') || value.includes('doing')) return 'in progress';
  return 'open';
}

function storyPoints(issue) {
  const value = issue?.fields?.customfield_10016;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function milestoneDate(issue) {
  const delivered = issue?.fields?.resolutiondate || issue?.fields?.duedate || issue?.fields?.updated;
  if (!delivered) return '';
  const parsed = new Date(delivered);
  return Number.isNaN(parsed.getTime()) ? String(delivered) : parsed.toISOString().slice(0, 10);
}

function milestoneReactKey(issue, idx) {
  const key = String(issue?.key || '').trim();
  if (key) return `ms-key-${key}`;
  const id = String(issue?.id || '').trim();
  if (id) return `ms-id-${id}`;
  return `issue-${idx}`;
}

export default function Roadmap({ t, issues = [], jiraBaseUrl }) {
  const milestones = (issues || [])
    .filter((issue) => normalizeStatus(issue?.fields?.status?.name) === 'done')
    .map((issue, idx) => ({
      id: milestoneReactKey(issue, idx),
      key: issue.key,
      title: issue.fields?.summary || t.noData,
      date: milestoneDate(issue),
      status: normalizeStatus(issue.fields?.status?.name),
      points: storyPoints(issue),
      version: issue?.fields?.fixVersions?.[0]?.name || '',
    }))
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });

  const totalPoints = milestones.reduce((sum, item) => sum + item.points, 0);

  return (
    <div className="roadmap">
      <div className="workflow-panel-subtitle">{t.roadmapSubtitle}</div>
      <div className="workflow-meta-row" style={{ marginTop: 10, marginBottom: 10 }}>
        <span className="workflow-chip">{milestones.length} {t.doneCount}</span>
        <span className="workflow-chip">{totalPoints} {t.points}</span>
      </div>

      <div className="roadmap-timeline">
        {milestones.length === 0 && (
          <div className="muted" style={{ fontSize: 12, padding: '8px 0' }}>
            {t.roadmapEmpty}
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
                {ms.date && <span className="milestone-date">{t.deliveredAt}: {ms.date}</span>}
                {ms.version && <span className="milestone-date">{ms.version}</span>}
                <span className="milestone-date">{ms.points} {t.points}</span>
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
