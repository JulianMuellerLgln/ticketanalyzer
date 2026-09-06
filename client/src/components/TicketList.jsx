import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { api } from '../api';
import TicketLink from './TicketLink';

const PRIORITY_TONE = {
  Highest: '#e53e3e',
  High: '#e8743b',
  Medium: '#d6b45f',
  Low: '#7f97b8',
  Lowest: '#666',
};

const ACCEPTANCE_LEVELS = {
  0: { bg: 'rgba(229, 62, 62, 0.12)', border: 'rgba(229, 62, 62, 0.3)', color: '#ff9b9b' },
  1: { bg: 'rgba(240, 165, 0, 0.12)', border: 'rgba(240, 165, 0, 0.28)', color: '#ffd37a' },
  5: { bg: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.28)', color: '#8cf0b0' },
};

function safeIssueReactKey(issue, idx) {
  const key = String(issue?.key || '').trim();
  if (key) return `ticket-key-${key}`;
  const id = String(issue?.id || '').trim();
  if (id) return `ticket-id-${id}`;
  return `ticket-${idx}`;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeStatus(raw) {
  return String(raw || '').trim().toLowerCase();
}

function isDoneStatus(raw) {
  const value = normalizeStatus(raw);
  return value.includes('done') || value.includes('erledigt') || value.includes('closed') || value.includes('fertig');
}

function extractRichText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map((entry) => extractRichText(entry)).filter(Boolean).join(' ');
  if (typeof node !== 'object') return '';
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.content)) {
    const separator = node.type === 'paragraph' || node.type === 'heading' ? '\n' : ' ';
    return node.content.map((entry) => extractRichText(entry)).filter(Boolean).join(separator);
  }
  return '';
}

function issueText(issue) {
  const description = extractRichText(issue?.fields?.description);
  const comments = (issue?.fields?.comment?.comments || [])
    .map((comment) => extractRichText(comment?.body))
    .filter(Boolean)
    .join('\n');
  return [description, comments].filter(Boolean).join('\n').trim();
}

function scoreAcceptanceCriteria(issue) {
  const text = issueText(issue);
  if (!text) return 0;

  const hasKeyword = /(acceptance criteria|acceptance criterion|akzeptanzkriterien|akzeptanzkriterium|abnahmekriterien|\bac\b)/i.test(text);
  const bulletCount =
    (text.match(/(^|\n)\s*[-*•]\s+/g) || []).length +
    (text.match(/(^|\n)\s*\d+\.\s+/g) || []).length;
  const hasScenario = /\bgiven\b/i.test(text) && /\bwhen\b/i.test(text) && /\bthen\b/i.test(text);

  if (hasKeyword && (bulletCount >= 3 || hasScenario || text.length >= 260)) return 5;
  if (hasKeyword || bulletCount >= 2 || hasScenario) return 1;
  return 0;
}

function normalizeSprintState(raw) {
  const value = normalizeStatus(raw);
  if (value.includes('active')) return 'active';
  if (value.includes('future')) return 'future';
  if (value.includes('closed') || value.includes('complete')) return 'closed';
  return 'future';
}

function parseSprintString(raw) {
  const text = String(raw || '');
  const get = (field) => {
    const match = text.match(new RegExp(`${field}=([^,\\]]+)`));
    return match?.[1]?.trim() || '';
  };
  return {
    id: get('id') || slugify(get('name')),
    name: get('name'),
    state: get('state'),
    goal: get('goal'),
    startDate: get('startDate'),
    endDate: get('endDate'),
    completeDate: get('completeDate'),
    activatedDate: get('activatedDate'),
  };
}

function normalizeSprintEntry(raw, idx) {
  if (!raw) return null;
  const source = typeof raw === 'string' ? parseSprintString(raw) : raw;
  const name = String(source?.name || '').trim();
  const id = String(source?.id || '').trim() || slugify(name) || `sprint-${idx}`;
  return {
    id,
    name: name || `Sprint ${idx + 1}`,
    state: normalizeSprintState(source?.state),
    goal: String(source?.goal || '').trim(),
    startDate: String(source?.startDate || source?.activatedDate || '').trim(),
    endDate: String(source?.endDate || '').trim(),
    completeDate: String(source?.completeDate || '').trim(),
  };
}

function extractSprintValues(fields) {
  const values = [];
  for (const value of Object.values(fields || {})) {
    if (Array.isArray(value) && value.some((entry) => typeof entry === 'string' && entry.includes('greenhopper.service.sprint.Sprint@'))) {
      values.push(...value);
      continue;
    }
    if (Array.isArray(value) && value.some((entry) => entry && typeof entry === 'object' && ('state' in entry || 'startDate' in entry || 'originBoardId' in entry))) {
      values.push(...value);
    }
  }
  return values;
}

function parseSprintEntries(issue) {
  const values = extractSprintValues(issue?.fields || {});
  return values.map((entry, idx) => normalizeSprintEntry(entry, idx)).filter(Boolean);
}

function sprintSortValue(sprint) {
  return sprint?.startDate || sprint?.endDate || sprint?.name || sprint?.id || '';
}

function buildInitialSprints(tickets) {
  const stateRank = { closed: 0, future: 1, active: 2 };
  const map = {};
  for (const ticket of tickets) {
    for (const sprint of ticket.sprints) {
      const current = map[sprint.id];
      if (!current) {
        map[sprint.id] = sprint;
        continue;
      }
      map[sprint.id] = {
        ...current,
        ...sprint,
        state: stateRank[sprint.state] > stateRank[current.state] ? sprint.state : current.state,
        goal: current.goal || sprint.goal,
        startDate: current.startDate || sprint.startDate,
        endDate: current.endDate || sprint.endDate,
        completeDate: current.completeDate || sprint.completeDate,
      };
    }
  }
  return map;
}

function mergeSprints(previous, initial) {
  const next = { ...initial };
  for (const [id, sprint] of Object.entries(previous)) {
    if (!(id in next) && id.startsWith('local-sprint-')) {
      next[id] = sprint;
    }
  }
  return next;
}

function deriveDefaultLane(ticket) {
  if (ticket.done) return 'archive';
  const activeSprint = ticket.sprints.find((sprint) => sprint.state === 'active');
  if (activeSprint) return `sprint:${activeSprint.id}`;
  const futureSprint = [...ticket.sprints]
    .filter((sprint) => sprint.state === 'future')
    .sort((a, b) => sprintSortValue(a).localeCompare(sprintSortValue(b)))[0];
  if (futureSprint) return `sprint:${futureSprint.id}`;
  return 'backlog';
}

function mergePlacements(previous, tickets) {
  const next = {};
  for (const ticket of tickets) {
    next[ticket.key] = previous[ticket.key] || deriveDefaultLane(ticket);
  }
  return next;
}

function daysRemaining(endDate) {
  if (!endDate) return null;
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86400000));
}

function daysOpen(created) {
  if (!created) return 0;
  const parsed = new Date(created);
  if (Number.isNaN(parsed.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86400000));
}

function formatDateLabel(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatRemainingDays(value, t) {
  if (value == null) return t.noData;
  return `${value} ${value === 1 ? t.dayShort : t.daysShort}`;
}

function getAcceptanceMeta(score, t) {
  if (score >= 5) return { short: '5', text: `${score} · ${t.acceptanceStrong}` };
  if (score >= 1) return { short: '1', text: `${score} · ${t.acceptanceOkay}` };
  return { short: '0', text: `${score} · ${t.acceptanceMissing}` };
}

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) return '';
  return values.map((entry) => String(entry || '').trim()).filter(Boolean).join(', ');
}

function TicketDetailField({ label, value, multiline = false }) {
  return (
    <div className="ticket-detail-field">
      <div className="ticket-detail-label">{label}</div>
      <div className={`ticket-detail-value${multiline ? ' ticket-detail-value--multiline' : ''}`}>
        {value || '—'}
      </div>
    </div>
  );
}

function TicketDetailsModal({ ticket, t, jiraBaseUrl, onClose }) {
  if (!ticket) return null;

  const acceptanceMeta = getAcceptanceMeta(ticket.acceptanceScore, t);
  const descriptionText = extractRichText(ticket?.fields?.description) || '';
  const comments = (ticket?.fields?.comment?.comments || []).map((comment, idx) => ({
    id: comment.id || `comment-${idx}`,
    author: comment?.author?.displayName || t.noData,
    created: formatDateLabel(comment?.created),
    body: extractRichText(comment?.body) || t.noData,
  }));
  const sprintNames = ticket.sprints.map((sprint) => sprint.name).join(', ');
  const labels = formatList(ticket?.fields?.labels);
  const components = formatList((ticket?.fields?.components || []).map((component) => component?.name));
  const versions = formatList((ticket?.fields?.fixVersions || []).map((version) => version?.name));

  return (
    <div className="ticket-modal-overlay" onClick={onClose}>
      <div className="ticket-modal" onClick={(event) => event.stopPropagation()}>
        <div className="ticket-modal-header">
          <div>
            <div className="ticket-modal-title-row">
              <TicketLink ticketKey={ticket.key} baseUrl={jiraBaseUrl} className="ticket-key" />
              <h3 className="ticket-modal-title">{ticket.fields.summary}</h3>
            </div>
            <div className="ticket-modal-subtitle">
              {ticket.fields.issuetype?.name || t.noData} · {ticket.fields.status?.name || t.noData}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title={t.close}>
            <X size={16} />
          </button>
        </div>

        <div className="ticket-modal-body">
          <div className="ticket-detail-grid">
            <TicketDetailField label={t.priority} value={ticket.fields.priority?.name || t.noData} />
            <TicketDetailField label={t.assignee} value={ticket.fields.assignee?.displayName || t.unassigned} />
            <TicketDetailField label={t.reporter} value={ticket.fields.reporter?.displayName || t.noData} />
            <TicketDetailField label={t.createdAt} value={formatDateLabel(ticket.fields.created)} />
            <TicketDetailField label={t.updatedAt} value={formatDateLabel(ticket.fields.updated)} />
            <TicketDetailField label={t.dueDate} value={formatDateLabel(ticket.fields.duedate)} />
            <TicketDetailField label={t.daysOpen} value={String(ticket.daysOpen)} />
            <TicketDetailField label={t.acceptanceCriteria} value={acceptanceMeta.text} />
            <TicketDetailField label={t.sprints} value={sprintNames || t.noData} />
            <TicketDetailField label={t.labels} value={labels || t.noData} />
            <TicketDetailField label={t.components} value={components || t.noData} />
            <TicketDetailField label={t.fixVersions} value={versions || t.noData} />
          </div>

          <TicketDetailField label={t.currentSprintGoal} value={ticket.sprints.find((sprint) => sprint.state === 'active')?.goal || ticket.sprints[0]?.goal || t.noSprintGoal} multiline />
          <TicketDetailField label={t.description} value={descriptionText || t.noData} multiline />

          <div className="ticket-detail-field">
            <div className="ticket-detail-label">{t.comments}</div>
            <div className="ticket-comments">
              {comments.length === 0 && <div className="ticket-comment">{t.noData}</div>}
              {comments.map((comment) => (
                <div key={comment.id} className="ticket-comment">
                  <div className="ticket-comment-meta">
                    <strong>{comment.author}</strong>
                    <span>{comment.created}</span>
                  </div>
                  <div className="ticket-comment-body">{comment.body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  count,
  laneId,
  tickets,
  t,
  onDropTicket,
  onDragStart,
  onDragEnd,
  onDragEnterLane,
  onOpenTicket,
  dropTargetLane,
  allowDrop = true,
}) {
  return (
    <div
      className={`sprint-section${dropTargetLane === laneId ? ' sprint-section--drop-target' : ''}`}
      onDragOver={(event) => {
        if (!allowDrop) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDragEnter={() => {
        if (!allowDrop) return;
        onDragEnterLane(laneId);
      }}
      onDrop={(event) => {
        if (!allowDrop) return;
        event.preventDefault();
        const ticketKey = event.dataTransfer.getData('text/plain');
        onDropTicket(ticketKey, laneId);
      }}
    >
      <div className="sprint-section-header">
        <div>
          <div className="sprint-section-title">{title}</div>
          {subtitle && <div className="sprint-section-subtitle">{subtitle}</div>}
        </div>
        <span className="sprint-section-count">{count}</span>
      </div>

      <div className="ticket-table">
        <div className="ticket-table-header">
          <span>{t.ticket}</span>
          <span>{t.summary}</span>
          <span>{t.priority}</span>
          <span>{t.status}</span>
          <span>{t.daysOpen}</span>
          <span>{t.acceptanceCriteria}</span>
        </div>

        <div className="ticket-table-body">
          <AnimatePresence>
            {tickets.length === 0 && (
              <div className="muted sprint-empty">{t.noIssues}</div>
            )}
            {tickets.map((ticket, idx) => {
              const acceptanceMeta = getAcceptanceMeta(ticket.acceptanceScore, t);
              const acceptanceTone = ACCEPTANCE_LEVELS[ticket.acceptanceScore] || ACCEPTANCE_LEVELS[0];
              return (
                <motion.button
                  key={safeIssueReactKey(ticket, idx)}
                  type="button"
                  className="ticket-table-row"
                  draggable
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ delay: idx * 0.015 }}
                  onDragStart={(event) => onDragStart(event, ticket.key)}
                  onDragEnd={onDragEnd}
                  onClick={() => onOpenTicket(ticket)}
                >
                  <span className="ticket-table-key">
                    <span className="ticket-key">{ticket.key}</span>
                  </span>
                  <span className="ticket-table-summary" title={ticket.fields.summary}>{ticket.fields.summary}</span>
                  <span className="ticket-table-priority" style={{ color: PRIORITY_TONE[ticket.fields.priority?.name] || '#aaa' }}>
                    {ticket.fields.priority?.name || '—'}
                  </span>
                  <span className="ticket-table-status">{ticket.fields.status?.name || '—'}</span>
                  <span className="ticket-table-days">{ticket.daysOpen}</span>
                  <span
                    className="ticket-table-acceptance"
                    style={{
                      background: acceptanceTone.bg,
                      borderColor: acceptanceTone.border,
                      color: acceptanceTone.color,
                    }}
                  >
                    {acceptanceMeta.text}
                  </span>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default function TicketList({ issues, projectKey, t, jiraBaseUrl }) {
  const [q, setQ] = useState('');
  const [showArchive, setShowArchive] = useState(true);
  const [sprints, setSprints] = useState({});
  const [placements, setPlacements] = useState({});
  const [dropTargetLane, setDropTargetLane] = useState('');
  const [persistReady, setPersistReady] = useState(false);
  const [persistError, setPersistError] = useState('');
  const [selectedTicket, setSelectedTicket] = useState(null);

  const tickets = useMemo(
    () =>
      (issues || []).map((issue) => ({
        ...issue,
        done: isDoneStatus(issue?.fields?.status?.name),
        daysOpen: daysOpen(issue?.fields?.created),
        acceptanceScore: scoreAcceptanceCriteria(issue),
        sprints: parseSprintEntries(issue),
      })),
    [issues]
  );

  const initialSprints = useMemo(() => buildInitialSprints(tickets), [tickets]);

  useEffect(() => {
    let cancelled = false;

    async function loadBoardState() {
      if (!projectKey) {
        setShowArchive(true);
        setSprints({});
        setPlacements({});
        setPersistError('');
        setPersistReady(false);
        setSelectedTicket(null);
        return;
      }

      setPersistReady(false);
      try {
        const state = await api.boardState(projectKey);
        if (cancelled) return;
        setShowArchive(state.showArchive !== false);
        setSprints(state.sprints || {});
        setPlacements(state.placements || {});
        setPersistError('');
      } catch (e) {
        if (cancelled) return;
        setShowArchive(true);
        setSprints({});
        setPlacements({});
        setPersistError(e?.response?.data?.error || e.message || 'Failed to load board state');
      } finally {
        if (!cancelled) setPersistReady(true);
      }
    }

    loadBoardState();
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  useEffect(() => {
    setSprints((previous) => mergeSprints(previous, initialSprints));
  }, [initialSprints]);

  useEffect(() => {
    setPlacements((previous) => mergePlacements(previous, tickets));
  }, [tickets]);

  useEffect(() => {
    let cancelled = false;

    async function persistBoardState() {
      if (!projectKey || !persistReady) return;
      try {
        await api.saveBoardState(projectKey, { placements, sprints, showArchive });
        if (!cancelled) setPersistError('');
      } catch (e) {
        if (!cancelled) {
          setPersistError(e?.response?.data?.error || e.message || 'Failed to persist board state');
        }
      }
    }

    persistBoardState();
    return () => {
      cancelled = true;
    };
  }, [placements, persistReady, projectKey, showArchive, sprints]);

  const sprintList = useMemo(
    () => Object.values(sprints).sort((a, b) => sprintSortValue(a).localeCompare(sprintSortValue(b))),
    [sprints]
  );

  const activeSprint = sprintList.find((sprint) => sprint.state === 'active') || null;
  const futureSprints = sprintList.filter((sprint) => sprint.state === 'future');

  const filteredTickets = useMemo(() => {
    const query = q.trim().toLowerCase();
    return tickets.filter((ticket) => {
      if (!query) return true;
      return (
        ticket.key.toLowerCase().includes(query) ||
        String(ticket.fields.summary || '').toLowerCase().includes(query) ||
        String(ticket.fields.status?.name || '').toLowerCase().includes(query)
      );
    });
  }, [tickets, q]);

  const ticketsByLane = useMemo(() => {
    const grouped = { backlog: [], archive: [] };
    for (const ticket of filteredTickets) {
      const lane = placements[ticket.key] || deriveDefaultLane(ticket);
      const laneId = lane.startsWith('sprint:') && !sprints[lane.slice(7)] ? deriveDefaultLane(ticket) : lane;
      if (!grouped[laneId]) grouped[laneId] = [];
      grouped[laneId].push(ticket);
    }
    return grouped;
  }, [filteredTickets, placements, sprints]);

  const visibleTicketCount = useMemo(() => {
    let count = (ticketsByLane.backlog || []).length;
    if (activeSprint) count += (ticketsByLane[`sprint:${activeSprint.id}`] || []).length;
    for (const sprint of futureSprints) {
      count += (ticketsByLane[`sprint:${sprint.id}`] || []).length;
    }
    if (showArchive) count += (ticketsByLane.archive || []).length;
    return count;
  }, [activeSprint, futureSprints, showArchive, ticketsByLane]);

  function onDragStart(event, ticketKey) {
    event.dataTransfer.setData('text/plain', ticketKey);
    event.dataTransfer.effectAllowed = 'move';
  }

  function onDragEnd() {
    setDropTargetLane('');
  }

  function onDropTicket(ticketKey, laneId) {
    if (!ticketKey || !laneId) return;
    setPlacements((previous) => ({ ...previous, [ticketKey]: laneId }));
    setDropTargetLane('');
  }

  function startSprint() {
    const now = new Date();
    const startDate = now.toISOString();
    const endDate = new Date(now.getTime() + 14 * 86400000).toISOString();
    const candidate = futureSprints[0];

    if (candidate) {
      setSprints((previous) => ({
        ...previous,
        [candidate.id]: {
          ...previous[candidate.id],
          state: 'active',
          startDate: previous[candidate.id]?.startDate || startDate,
          endDate: previous[candidate.id]?.endDate || endDate,
        },
      }));
      return;
    }

    const id = `local-sprint-${Date.now()}`;
    setSprints((previous) => ({
      ...previous,
      [id]: {
        id,
        name: `Sprint ${Object.keys(previous).length + 1}`,
        state: 'active',
        goal: '',
        startDate,
        endDate,
        completeDate: '',
      },
    }));
  }

  function endSprint() {
    if (!activeSprint) return;
    setSprints((previous) => ({
      ...previous,
      [activeSprint.id]: {
        ...previous[activeSprint.id],
        state: 'closed',
        completeDate: new Date().toISOString(),
      },
    }));
    setPlacements((previous) => {
      const next = { ...previous };
      for (const ticket of tickets) {
        if ((previous[ticket.key] || deriveDefaultLane(ticket)) === `sprint:${activeSprint.id}` && !ticket.done) {
          next[ticket.key] = 'backlog';
        }
      }
      return next;
    });
  }

  const currentSprintSubtitle = activeSprint
    ? [
        activeSprint.goal ? `${t.currentSprintGoal}: ${activeSprint.goal}` : `${t.currentSprintGoal}: ${t.noSprintGoal}`,
        activeSprint.endDate ? `${t.remainingSprintDays}: ${formatRemainingDays(daysRemaining(activeSprint.endDate), t)}` : '',
        activeSprint.startDate || activeSprint.endDate
          ? `${formatDateLabel(activeSprint.startDate)}${activeSprint.endDate ? ` - ${formatDateLabel(activeSprint.endDate)}` : ''}`
          : '',
      ].filter(Boolean).join(' · ')
    : t.noActiveSprint;

  return (
    <div className="ticketlist sprint-board">
      <div className="tl-search">
        <Search size={12} style={{ marginRight: 6, opacity: 0.5 }} />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} />
        <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>{visibleTicketCount}</span>
        <button className="btn-icon" onClick={() => setShowArchive((value) => !value)}>
          {showArchive ? t.hideArchive : t.showArchive}
        </button>
      </div>

      {persistError && <div className="error-text">{persistError}</div>}

      <div className="sprint-summary-card">
        <div className="sprint-summary-meta">
          <div className="sprint-summary-title">{activeSprint ? activeSprint.name : t.noActiveSprint}</div>
          <div className="sprint-summary-line">{currentSprintSubtitle}</div>
        </div>
        <button className="btn-primary" onClick={activeSprint ? endSprint : startSprint}>
          {activeSprint ? t.endSprint : t.startSprint}
        </button>
      </div>

      <div className="sprint-sections">
        <Section
          title={activeSprint ? `${t.sprintBacklog}: ${activeSprint.name}` : t.sprintBacklog}
          subtitle={activeSprint ? currentSprintSubtitle : t.startSprintHint}
          count={activeSprint ? (ticketsByLane[`sprint:${activeSprint.id}`] || []).length : 0}
          laneId={activeSprint ? `sprint:${activeSprint.id}` : ''}
          tickets={activeSprint ? ticketsByLane[`sprint:${activeSprint.id}`] || [] : []}
          t={t}
          onDropTicket={onDropTicket}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragEnterLane={setDropTargetLane}
          onOpenTicket={setSelectedTicket}
          dropTargetLane={dropTargetLane}
          allowDrop={Boolean(activeSprint)}
        />

        <Section
          title={t.backlog}
          subtitle={t.backlogHint}
          count={(ticketsByLane.backlog || []).length}
          laneId="backlog"
          tickets={ticketsByLane.backlog || []}
          t={t}
          onDropTicket={onDropTicket}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragEnterLane={setDropTargetLane}
          onOpenTicket={setSelectedTicket}
          dropTargetLane={dropTargetLane}
          allowDrop
        />

        {futureSprints.length === 0 ? (
          <div className="sprint-section">
            <div className="sprint-section-header">
              <div>
                <div className="sprint-section-title">{t.futureSprints}</div>
                <div className="sprint-section-subtitle">{t.noFutureSprints}</div>
              </div>
              <span className="sprint-section-count">0</span>
            </div>
          </div>
        ) : (
          futureSprints.map((sprint) => (
            <Section
              key={sprint.id}
              title={sprint.name}
              subtitle={[
                sprint.goal ? `${t.currentSprintGoal}: ${sprint.goal}` : '',
                sprint.startDate || sprint.endDate
                  ? `${formatDateLabel(sprint.startDate)}${sprint.endDate ? ` - ${formatDateLabel(sprint.endDate)}` : ''}`
                  : '',
              ].filter(Boolean).join(' · ') || t.futureSprintHint}
              count={(ticketsByLane[`sprint:${sprint.id}`] || []).length}
              laneId={`sprint:${sprint.id}`}
              tickets={ticketsByLane[`sprint:${sprint.id}`] || []}
              t={t}
              onDropTicket={onDropTicket}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragEnterLane={setDropTargetLane}
              onOpenTicket={setSelectedTicket}
              dropTargetLane={dropTargetLane}
              allowDrop
            />
          ))
        )}

        {showArchive && (
          <Section
            title={t.archive}
            subtitle={t.archiveHint}
            count={(ticketsByLane.archive || []).length}
            laneId="archive"
            tickets={ticketsByLane.archive || []}
            t={t}
            onDropTicket={onDropTicket}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragEnterLane={setDropTargetLane}
            onOpenTicket={setSelectedTicket}
            dropTargetLane={dropTargetLane}
            allowDrop
          />
        )}
      </div>

      <AnimatePresence>
        {selectedTicket && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <TicketDetailsModal
              ticket={selectedTicket}
              t={t}
              jiraBaseUrl={jiraBaseUrl}
              onClose={() => setSelectedTicket(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
