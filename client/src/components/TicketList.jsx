import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Save, Search, Sparkles, X } from 'lucide-react';
import { api } from '../api';
import TicketLink from './TicketLink';
import MiddleScrollArea from './MiddleScrollArea';

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

const DEFAULT_PLANNING_STATE = {
  sprintGoalDraft: '',
  openQuestions: '',
  teamAbsences: '',
};

const DEFAULT_AI_STATE = {
  loading: false,
  saving: false,
  error: '',
  savedMessage: '',
  result: null,
};

const DEFAULT_DAILY_ADVICE_STATE = {
  loading: false,
  error: '',
  result: null,
};

const READY_CHECK_KEYS = ['titleDescription', 'acceptance', 'objective', 'component', 'estimate', 'dependencies'];
const DONE_CHECK_KEYS = ['tests', 'docs', 'openPoints', 'acceptanceVerified', 'merged'];
const DEFAULT_CHECKLISTS_STATE = {};

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'oder', 'und', 'der', 'die', 'das',
  'ein', 'eine', 'mit', 'auf', 'von', 'ist', 'are', 'you', 'your', 'after', 'before', 'when',
  'then', 'will', 'nicht', 'noch', 'kein', 'keine', 'einer', 'einem', 'zum', 'zur',
]);

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
  if (node.type === 'hardBreak') return '\n';
  if (typeof node.text === 'string') {
    const href = node.marks?.find((mark) => mark?.type === 'link')?.attrs?.href;
    if (typeof href === 'string' && href.trim()) {
      const label = node.text.trim() || href.trim();
      return label === href.trim() ? `[${href.trim()}]` : `[${label}|${href.trim()}]`;
    }
    return node.text;
  }
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

function groupTicketsByLane(tickets, placements, sprints) {
  const grouped = { backlog: [], archive: [] };
  for (const ticket of tickets) {
    const lane = ticket.done ? 'archive' : (placements[ticket.key] || deriveDefaultLane(ticket));
    const laneId = lane.startsWith('sprint:') && !sprints[lane.slice(7)] ? deriveDefaultLane(ticket) : lane;
    if (!grouped[laneId]) grouped[laneId] = [];
    grouped[laneId].push(ticket);
  }
  return grouped;
}

function mergePlacements(previous, tickets) {
  const next = {};
  for (const ticket of tickets) {
    next[ticket.key] = ticket.done ? 'archive' : (previous[ticket.key] || deriveDefaultLane(ticket));
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

function primaryComponentName(ticket) {
  return String(ticket?.fields?.components?.[0]?.name || '').trim();
}

function storyPoints(ticket) {
  const value = Number(ticket?.fields?.customfield_10016);
  return Number.isFinite(value) ? value : 0;
}

function hasDependenciesHint(ticket) {
  const text = issueText(ticket);
  return /\b(blocked by|depends on|dependency|risk|question|open question|abhaeng|abhängig|offen)\b/i.test(text);
}

function getDefaultChecklistState(ticket, objectiveMatch) {
  return {
    ready: {
      titleDescription: Boolean(String(ticket?.fields?.summary || '').trim() && extractRichText(ticket?.fields?.description).trim()),
      acceptance: ticket.acceptanceScore >= 1,
      objective: Boolean(objectiveMatch),
      component: Boolean(primaryComponentName(ticket)),
      estimate: storyPoints(ticket) > 0,
      dependencies: hasDependenciesHint(ticket),
    },
    done: {
      tests: false,
      docs: false,
      openPoints: false,
      acceptanceVerified: false,
      merged: ticket.done,
    },
  };
}

function checklistProgressMap(ticket, storedState, objectiveMatch) {
  const defaults = getDefaultChecklistState(ticket, objectiveMatch);
  const resolveSection = (keys, sectionName) => {
    const section = storedState?.[sectionName] || {};
    const completed = keys.reduce(
      (sum, key) => sum + ((key in section ? section[key] : defaults[sectionName][key]) ? 1 : 0),
      0
    );
    return { completed, total: keys.length };
  };

  return {
    ready: resolveSection(READY_CHECK_KEYS, 'ready'),
    done: resolveSection(DONE_CHECK_KEYS, 'done'),
  };
}

function progressLabel(progress) {
  return `${progress.completed}/${progress.total}`;
}

function tokenize(value) {
  const words = String(value || '').toLowerCase().match(/[a-z0-9äöüß]{3,}/g) || [];
  return [...new Set(words.filter((word) => !STOP_WORDS.has(word)))];
}

function objectiveIssueText(issue) {
  return [
    issue?.fields?.summary || '',
    extractRichText(issue?.fields?.description),
    formatList(issue?.fields?.labels),
    formatList((issue?.fields?.components || []).map((component) => component?.name)),
  ].join(' ');
}

function buildObjectiveMatch(ticket, objectives) {
  const ticketTokens = new Set(tokenize([
    ticket?.fields?.summary || '',
    issueText(ticket),
    formatList(ticket?.fields?.labels),
    formatList((ticket?.fields?.components || []).map((component) => component?.name)),
  ].join(' ')));

  if (ticketTokens.size === 0) return null;

  const ticketComponents = new Set((ticket?.fields?.components || []).map((component) => String(component?.name || '').trim().toLowerCase()).filter(Boolean));
  const ticketLabels = new Set((ticket?.fields?.labels || []).map((label) => String(label || '').trim().toLowerCase()).filter(Boolean));

  let best = null;
  for (const objective of objectives || []) {
    const objectiveTokens = new Set(tokenize(objectiveIssueText(objective)));
    const objectiveComponents = new Set((objective?.fields?.components || []).map((component) => String(component?.name || '').trim().toLowerCase()).filter(Boolean));
    const objectiveLabels = new Set((objective?.fields?.labels || []).map((label) => String(label || '').trim().toLowerCase()).filter(Boolean));

    let overlap = 0;
    for (const token of ticketTokens) {
      if (objectiveTokens.has(token)) overlap += 1;
    }
    for (const component of ticketComponents) {
      if (objectiveComponents.has(component)) overlap += 2;
    }
    for (const label of ticketLabels) {
      if (objectiveLabels.has(label)) overlap += 1;
    }

    if (!best || overlap > best.score) {
      best = {
        score: overlap,
        objectiveKey: objective?.key || '',
        objectiveSummary: objective?.fields?.summary || '',
      };
    }
  }

  if (!best || best.score < 2) return null;
  return {
    ...best,
    confidence: best.score >= 6 ? 'high' : best.score >= 4 ? 'medium' : 'low',
  };
}

function refinementGapCodes(ticket, objectiveMatch) {
  const gaps = [];
  if (!extractRichText(ticket?.fields?.description)) gaps.push('description');
  if (ticket.acceptanceScore < 5) gaps.push('acceptance');
  if (!primaryComponentName(ticket)) gaps.push('product');
  if (!objectiveMatch) gaps.push('objective');
  return gaps;
}

function gapLabel(code, t) {
  const labels = {
    description: t.description,
    acceptance: t.acceptanceCriteria,
    product: t.productOrComponent,
    objective: t.objective,
  };
  return labels[code] || code;
}

function createRefinementDraft(ticket) {
  return {
    summary: ticket?.fields?.summary || '',
    description: extractRichText(ticket?.fields?.description) || '',
    acceptanceCriteria: '',
    componentName: primaryComponentName(ticket),
  };
}

function normalizeAcceptanceLines(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s*/, ''));
}

function buildDescriptionPayload(description, acceptanceCriteria) {
  const sections = [];
  const trimmedDescription = String(description || '').trim();
  if (trimmedDescription) sections.push(trimmedDescription);

  const criteria = normalizeAcceptanceLines(acceptanceCriteria);
  if (criteria.length > 0) {
    sections.push(`Acceptance Criteria\n${criteria.map((line) => `- ${line}`).join('\n')}`);
  }

  return sections.join('\n\n').trim();
}

function normalizePlainUrlToken(token) {
  const cleaned = String(token || '');
  const trimmed = cleaned.replace(/[),.;!?]+$/g, '');
  return {
    href: trimmed,
    trailing: cleaned.slice(trimmed.length),
  };
}

function renderTextWithLinks(text, jiraBaseUrl) {
  const source = String(text || '');
  if (!source) return '';

  const matcher = /\[([^\]|]+)\|(https?:\/\/[^\]\s]+)\]|\[(https?:\/\/[^\]\s]+)\]|(https?:\/\/[^\s<]+)|\b([A-Z][A-Z0-9]+-\d+)\b/g;
  const parts = [];
  let lastIndex = 0;
  let matchIndex = 0;
  let match;

  while ((match = matcher.exec(source)) !== null) {
    if (match.index > lastIndex) {
      parts.push(source.slice(lastIndex, match.index));
    }

    if (match[1] && match[2]) {
      parts.push(
        <a
          key={`comment-link-${matchIndex}`}
          className="inline-link"
          href={match[2]}
          target="_blank"
          rel="noreferrer"
        >
          {match[1]}
        </a>
      );
    } else if (match[3]) {
      parts.push(
        <a
          key={`comment-link-${matchIndex}`}
          className="inline-link"
          href={match[3]}
          target="_blank"
          rel="noreferrer"
        >
          {match[3]}
        </a>
      );
    } else if (match[4]) {
      const { href, trailing } = normalizePlainUrlToken(match[4]);
      parts.push(
        <a
          key={`comment-link-${matchIndex}`}
          className="inline-link"
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          {href}
        </a>
      );
      if (trailing) parts.push(trailing);
    } else if (match[5]) {
      parts.push(
        <TicketLink
          key={`comment-ticket-${matchIndex}`}
          ticketKey={match[5]}
          baseUrl={jiraBaseUrl}
          className="inline-link"
        />
      );
    }

    lastIndex = match.index + match[0].length;
    matchIndex += 1;
  }

  if (lastIndex < source.length) {
    parts.push(source.slice(lastIndex));
  }

  return parts;
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

function WorkflowStat({ label, value }) {
  return (
    <div className="workflow-stat">
      <div className="workflow-stat-label">{label}</div>
      <div className="workflow-stat-value">{value}</div>
    </div>
  );
}

function DefinitionChecklist({ title, items }) {
  return (
    <div className="definition-card">
      <div className="workflow-section-title">{title}</div>
      <ul className="definition-list">
        {items.map((item) => (
          <li key={`${title}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ChecklistEditor({ title, items, progressLabelText, sectionKey, values, onToggle }) {
  return (
    <div className="definition-card">
      <div className="definition-card-header">
        <div className="workflow-section-title">{title}</div>
        <span className="workflow-chip">{progressLabelText}</span>
      </div>
      <div className="checklist-grid">
        {items.map(([itemKey, label]) => (
          <label key={`${sectionKey}-${itemKey}`} className="checklist-item">
            <input
              type="checkbox"
              checked={Boolean(values[itemKey])}
              onChange={(event) => onToggle(sectionKey, itemKey, event.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function TeamStandardsPanel({ t }) {
  return (
    <div className="workflow-panel">
      <div className="workflow-panel-header">
        <div>
          <div className="workflow-panel-title">{t.teamStandardsTitle}</div>
          <div className="workflow-panel-subtitle">{t.teamStandardsSubtitle}</div>
        </div>
      </div>

      <div className="definition-grid">
        <DefinitionChecklist title={t.definitionOfReadyTitle} items={t.definitionOfReadyItems} />
        <DefinitionChecklist title={t.definitionOfDoneTitle} items={t.definitionOfDoneItems} />
      </div>
    </div>
  );
}

function TicketChecklistTool({ ticket, t, checklistState, objectiveMatch, onToggle }) {
  const defaultState = getDefaultChecklistState(ticket, objectiveMatch);
  const effectiveReady = Object.fromEntries(
    READY_CHECK_KEYS.map((key) => [key, key in (checklistState?.ready || {}) ? checklistState.ready[key] : defaultState.ready[key]])
  );
  const effectiveDone = Object.fromEntries(
    DONE_CHECK_KEYS.map((key) => [key, key in (checklistState?.done || {}) ? checklistState.done[key] : defaultState.done[key]])
  );
  const progress = checklistProgressMap(ticket, checklistState, objectiveMatch);
  const readyItems = READY_CHECK_KEYS.map((key) => [key, t.readyChecklistItems[key]]);
  const doneItems = DONE_CHECK_KEYS.map((key) => [key, t.doneChecklistItems[key]]);

  return (
    <div className="workflow-panel">
      <div className="workflow-panel-header">
        <div>
          <div className="workflow-panel-title">{t.checklistToolTitle}</div>
          <div className="workflow-panel-subtitle">{t.checklistToolSubtitle}</div>
        </div>
      </div>

      <div className="definition-grid">
        <ChecklistEditor
          title={t.definitionOfReadyTitle}
          items={readyItems}
          progressLabelText={`${t.checklistReadyProgress}: ${progressLabel(progress.ready)}`}
          sectionKey="ready"
          values={effectiveReady}
          onToggle={onToggle}
        />
        <ChecklistEditor
          title={t.definitionOfDoneTitle}
          items={doneItems}
          progressLabelText={`${t.checklistDoneProgress}: ${progressLabel(progress.done)}`}
          sectionKey="done"
          values={effectiveDone}
          onToggle={onToggle}
        />
      </div>
    </div>
  );
}

function RefinementPanel({
  candidates,
  objectiveBoardName,
  objectiveCoverage,
  missingProductCount,
  t,
  onOpenTicket,
  onGenerateRefinement,
}) {
  return (
    <div className="workflow-panel">
      <div className="workflow-panel-header">
        <div>
          <div className="workflow-panel-title">{t.refinementTitle}</div>
          <div className="workflow-panel-subtitle">{t.refinementSubtitle}</div>
        </div>
        <div className="workflow-stat-grid">
          <WorkflowStat label={t.refinementCandidates} value={candidates.length} />
          <WorkflowStat label={t.missingProductAssignment} value={missingProductCount} />
          <WorkflowStat label={t.objectiveCoverage} value={objectiveCoverage} />
        </div>
      </div>

      <div className="workflow-meta-row">
        <span className="workflow-chip">{t.objectiveBoard}: {objectiveBoardName || t.noData}</span>
        <span className="workflow-chip">{t.syncStart}</span>
      </div>

      <div className="workflow-ticket-list">
        {candidates.length === 0 && <div className="muted">{t.noIssues}</div>}
        {candidates.slice(0, 6).map(({ ticket, gaps, objectiveMatch }) => (
          <div key={ticket.key} className="workflow-ticket-item">
            <div className="workflow-ticket-main">
              <div className="workflow-ticket-head">
                <span className="ticket-key">{ticket.key}</span>
                <span className="workflow-ticket-summary">{ticket.fields.summary}</span>
              </div>
              <div className="workflow-ticket-tags">
                {gaps.map((gap) => (
                  <span key={`${ticket.key}-${gap}`} className="workflow-tag">
                    {gapLabel(gap, t)}
                  </span>
                ))}
                <span className="workflow-tag workflow-tag--dim">
                  {primaryComponentName(ticket) || t.noProductAssigned}
                </span>
                <span className={`workflow-tag${objectiveMatch ? '' : ' workflow-tag--dim'}`}>
                  {objectiveMatch ? `${objectiveMatch.objectiveKey}` : t.noObjectiveMatch}
                </span>
              </div>
            </div>
            <div className="workflow-ticket-actions">
              <button className="btn-icon" type="button" onClick={() => onOpenTicket(ticket)}>
                {t.details || t.ticket}
              </button>
              <button className="btn-primary" type="button" onClick={() => onGenerateRefinement(ticket)}>
                <Sparkles size={12} />
                {t.useLocalAi}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanningPanel({
  t,
  planning,
  onPlanningChange,
  onSaveSprintGoal,
  planningMessage,
  planningTargetSprint,
  baselineLoad,
  backlogPoints,
  targetSprintPoints,
}) {
  return (
    <div className="workflow-panel">
      <div className="workflow-panel-header">
        <div>
          <div className="workflow-panel-title">{t.planningTitle}</div>
          <div className="workflow-panel-subtitle">{t.planningSubtitle}</div>
        </div>
        <div className="workflow-stat-grid">
          <WorkflowStat label={t.teamBaselineLoad} value={baselineLoad} />
          <WorkflowStat label={t.backlogLoad} value={backlogPoints} />
          <WorkflowStat label={t.sprintLoad} value={targetSprintPoints} />
        </div>
      </div>

      <div className="workflow-checklist">
        <div className="workflow-section-title">{t.planningChecklistTitle}</div>
        <ul>
          {t.planningChecklist.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </div>

      <div className="workflow-form-grid">
        <div className="ticket-detail-field">
          <div className="ticket-detail-label">{t.sprintGoalDraft}</div>
          <textarea
            className="input workflow-textarea"
            value={planning.sprintGoalDraft}
            onChange={(event) => onPlanningChange('sprintGoalDraft', event.target.value)}
            placeholder={planningTargetSprint?.name || t.noActiveSprint}
          />
        </div>
        <div className="ticket-detail-field">
          <div className="ticket-detail-label">{t.planningOpenQuestions}</div>
          <textarea
            className="input workflow-textarea"
            value={planning.openQuestions}
            onChange={(event) => onPlanningChange('openQuestions', event.target.value)}
          />
        </div>
        <div className="ticket-detail-field">
          <div className="ticket-detail-label">{t.planningTeamAbsences}</div>
          <textarea
            className="input workflow-textarea"
            value={planning.teamAbsences}
            onChange={(event) => onPlanningChange('teamAbsences', event.target.value)}
          />
        </div>
      </div>

      <div className="workflow-actions">
        <button className="btn-primary" type="button" onClick={onSaveSprintGoal}>
          <Save size={12} />
          {t.saveSprintGoal}
        </button>
        {planningMessage && <span className="muted">{planningMessage}</span>}
      </div>
    </div>
  );
}

function DailyPanel({
  t,
  activeSprint,
  remainingDays,
  planning,
  dailyAdvice,
  onGenerateDailyAdvice,
  hasProject,
  baselineLoad,
  activeSprintPoints,
  backlogPoints,
}) {
  return (
    <div className="workflow-panel">
      <div className="workflow-panel-header">
        <div>
          <div className="workflow-panel-title">{t.dailyTitle}</div>
          <div className="workflow-panel-subtitle">{t.dailySubtitle}</div>
        </div>
        <div className="workflow-stat-grid">
          <WorkflowStat label={t.sprintBacklog} value={activeSprint?.name || t.noActiveSprint} />
          <WorkflowStat label={t.remainingSprintDays} value={remainingDays == null ? t.noData : remainingDays} />
          <WorkflowStat label={t.teamBaselineLoad} value={baselineLoad} />
          <WorkflowStat label={t.sprintLoad} value={activeSprintPoints} />
          <WorkflowStat label={t.backlogLoad} value={backlogPoints} />
        </div>
      </div>

      <div className="workflow-checklist">
        <div className="workflow-section-title">{t.dailyChecklistTitle}</div>
        <ul>
          {t.dailyChecklist.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </div>

      <div className="workflow-meta-row">
        <span className="workflow-chip">{t.dailyScrumHint}</span>
        {planning.openQuestions.trim() && <span className="workflow-chip">{t.planningOpenQuestions}: {planning.openQuestions}</span>}
        {planning.teamAbsences.trim() && <span className="workflow-chip">{t.planningTeamAbsences}: {planning.teamAbsences}</span>}
      </div>

      <div className="workflow-checklist">
        <div className="workflow-section-title">{t.dailyAiTitle}</div>
        <div className="workflow-panel-subtitle">{t.dailyAiSubtitle}</div>
        <div className="workflow-actions">
          <button className="btn-primary" type="button" onClick={onGenerateDailyAdvice} disabled={!hasProject || dailyAdvice.loading}>
            <Sparkles size={12} />
            {dailyAdvice.loading ? t.loading : t.dailyAiButton}
          </button>
          {dailyAdvice.error && <span className="error-text">{dailyAdvice.error}</span>}
        </div>

        {dailyAdvice.result && (
          <div className="daily-advice-grid">
            <TicketDetailField label={t.summary} value={dailyAdvice.result.summary || t.noData} multiline />
            <DefinitionChecklist title={t.dailyPlanChangesTitle} items={dailyAdvice.result.planChanges} />
            <DefinitionChecklist title={t.dailyCoordinationTitle} items={dailyAdvice.result.coordination} />
            <DefinitionChecklist title={t.dailyWatchItemsTitle} items={dailyAdvice.result.watchItems} />
          </div>
        )}
      </div>
    </div>
  );
}

function TicketDetailsModal({
  ticket,
  t,
  jiraBaseUrl,
  workflowMode,
  availableComponents,
  objectiveMatch,
  objectiveBoardName,
  refinementDraft,
  onRefinementDraftChange,
  onGenerateRefinement,
  onApplyRefinement,
  aiRefinement,
  checklistState,
  onToggleChecklist,
  onClose,
}) {
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
  const aiObjective = aiRefinement.result?.objectiveAlignment;
  const displayedObjective = aiObjective?.objectiveKey
    ? `${aiObjective.objectiveKey} · ${aiObjective.objectiveSummary || ''}`.trim()
    : objectiveMatch
      ? `${objectiveMatch.objectiveKey} · ${objectiveMatch.objectiveSummary || ''}`.trim()
      : t.noObjectiveMatch;

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

        <MiddleScrollArea className="ticket-modal-body">
          <div className="ticket-detail-grid">
            <TicketDetailField label={t.priority} value={ticket.fields.priority?.name || t.noData} />
            <TicketDetailField label={t.assignee} value={ticket.fields.assignee?.displayName || t.unassigned} />
            <TicketDetailField label={t.reporter} value={ticket.fields.reporter?.displayName || t.noData} />
            <TicketDetailField label={t.createdAt} value={formatDateLabel(ticket.fields.created)} />
            <TicketDetailField label={t.updatedAt} value={formatDateLabel(ticket.fields.updated)} />
            <TicketDetailField label={t.dueDate} value={formatDateLabel(ticket.fields.duedate)} />
            <TicketDetailField label={t.daysOpen} value={String(ticket.daysOpen)} />
            <TicketDetailField label={t.points} value={String(storyPoints(ticket))} />
            <TicketDetailField label={t.acceptanceCriteria} value={acceptanceMeta.text} />
            <TicketDetailField label={t.sprints} value={sprintNames || t.noData} />
            <TicketDetailField label={t.labels} value={labels || t.noData} />
            <TicketDetailField label={t.components} value={components || t.noData} />
            <TicketDetailField label={t.fixVersions} value={versions || t.noData} />
            <TicketDetailField label={t.objectiveBoard} value={objectiveBoardName || t.noData} />
            <TicketDetailField label={t.objectiveAlignment} value={displayedObjective} />
          </div>

          <TicketDetailField
            label={t.currentSprintGoal}
            value={ticket.sprints.find((sprint) => sprint.state === 'active')?.goal || ticket.sprints[0]?.goal || t.noSprintGoal}
            multiline
          />
          <TicketDetailField label={t.description} value={descriptionText || t.noData} multiline />

          <TicketChecklistTool
            ticket={ticket}
            t={t}
            checklistState={checklistState}
            objectiveMatch={objectiveMatch}
            onToggle={onToggleChecklist}
          />

          {workflowMode === 'refinement' && (
            <div className="refinement-editor">
              <div className="refinement-editor-header">
                <div>
                  <div className="workflow-panel-title">{t.aiRefinementTitle}</div>
                  <div className="workflow-panel-subtitle">{t.aiRefinementDescription}</div>
                </div>
                <button className="btn-primary" type="button" onClick={() => onGenerateRefinement(ticket)} disabled={aiRefinement.loading}>
                  <Sparkles size={12} />
                  {aiRefinement.loading ? t.loading : t.useLocalAi}
                </button>
              </div>

              <div className="workflow-form-grid">
                <div className="ticket-detail-field">
                  <div className="ticket-detail-label">{t.refinedSummary}</div>
                  <input
                    className="input"
                    value={refinementDraft.summary}
                    onChange={(event) => onRefinementDraftChange('summary', event.target.value)}
                  />
                </div>

                <div className="ticket-detail-field">
                  <div className="ticket-detail-label">{t.productOrComponent}</div>
                  <select
                    className="input"
                    value={refinementDraft.componentName}
                    onChange={(event) => onRefinementDraftChange('componentName', event.target.value)}
                  >
                    <option value="">{t.noProductAssigned}</option>
                    {availableComponents.map((component) => (
                      <option key={component.id || component.name} value={component.name}>
                        {component.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="ticket-detail-field">
                  <div className="ticket-detail-label">{t.refinedDescription}</div>
                  <textarea
                    className="input workflow-textarea workflow-textarea--lg"
                    value={refinementDraft.description}
                    onChange={(event) => onRefinementDraftChange('description', event.target.value)}
                  />
                </div>

                <div className="ticket-detail-field">
                  <div className="ticket-detail-label">{t.acceptanceCriteria}</div>
                  <textarea
                    className="input workflow-textarea"
                    value={refinementDraft.acceptanceCriteria}
                    onChange={(event) => onRefinementDraftChange('acceptanceCriteria', event.target.value)}
                  />
                </div>
              </div>

              {aiRefinement.result?.openQuestions?.length > 0 && (
                <div className="workflow-checklist">
                  <div className="workflow-section-title">{t.openQuestionsTitle}</div>
                  <ul>
                    {aiRefinement.result.openQuestions.map((question, idx) => (
                      <li key={`refine-question-${idx}`}>{question}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="workflow-actions">
                <button className="btn-primary" type="button" onClick={onApplyRefinement} disabled={aiRefinement.saving}>
                  <Save size={12} />
                  {aiRefinement.saving ? t.loading : t.applyRefinement}
                </button>
                {aiRefinement.savedMessage && <span className="muted">{aiRefinement.savedMessage}</span>}
                {aiRefinement.error && <span className="error-text">{aiRefinement.error}</span>}
              </div>
            </div>
          )}

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
                  <div className="ticket-comment-body">{renderTextWithLinks(comment.body, jiraBaseUrl)}</div>
                </div>
              ))}
            </div>
          </div>
        </MiddleScrollArea>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  count,
  points,
  laneId,
  tickets,
  t,
  onDropTicket,
  onDragStart,
  onDragEnd,
  onDragEnterLane,
  onOpenTicket,
  dropTargetLane,
  objectiveMatches,
  checklistStates,
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
        <div className="sprint-section-metrics">
          <span className="sprint-section-count">{count}</span>
          <span className="workflow-chip">{points} {t.points}</span>
        </div>
      </div>

      <div className="ticket-table">
        <div className="ticket-table-header">
          <span>{t.ticket}</span>
          <span>{t.summary}</span>
          <span>{t.productOrComponent}</span>
          <span>{t.objective}</span>
          <span>{t.points}</span>
          <span>{t.priority}</span>
          <span>{t.status}</span>
          <span>{t.readyCheck}</span>
          <span>{t.doneCheck}</span>
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
              const objectiveMatch = objectiveMatches[ticket.key] || null;
              const checklistProgress = checklistProgressMap(ticket, checklistStates[ticket.key], objectiveMatch);
              const productName = primaryComponentName(ticket);
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
                  <span className={`ticket-table-product${productName ? '' : ' ticket-table-product--missing'}`}>
                    {productName || t.noProductAssigned}
                  </span>
                  <span
                    className={`ticket-table-objective${objectiveMatch ? '' : ' ticket-table-objective--missing'}`}
                    title={objectiveMatch?.objectiveSummary || t.noObjectiveMatch}
                  >
                    {objectiveMatch ? objectiveMatch.objectiveKey : t.noObjectiveMatch}
                  </span>
                  <span className="ticket-table-points">{storyPoints(ticket)}</span>
                  <span className="ticket-table-priority" style={{ color: PRIORITY_TONE[ticket.fields.priority?.name] || '#aaa' }}>
                    {ticket.fields.priority?.name || '—'}
                  </span>
                  <span className="ticket-table-status">{ticket.fields.status?.name || '—'}</span>
                  <span className="ticket-table-progress">{progressLabel(checklistProgress.ready)}</span>
                  <span className="ticket-table-progress">{progressLabel(checklistProgress.done)}</span>
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

export default function TicketList({ issues, projectKey, t, jiraBaseUrl, workflowMode, lang, onRefresh }) {
  const [q, setQ] = useState('');
  const [showArchive, setShowArchive] = useState(true);
  const [sprints, setSprints] = useState({});
  const [placements, setPlacements] = useState({});
  const [planning, setPlanning] = useState(DEFAULT_PLANNING_STATE);
  const [checklists, setChecklists] = useState(DEFAULT_CHECKLISTS_STATE);
  const [availableComponents, setAvailableComponents] = useState([]);
  const [objectiveContext, setObjectiveContext] = useState({ board: null, issues: [] });
  const [dropTargetLane, setDropTargetLane] = useState('');
  const [persistReady, setPersistReady] = useState(false);
  const [persistError, setPersistError] = useState('');
  const [projectContextError, setProjectContextError] = useState('');
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [refinementDraft, setRefinementDraft] = useState(createRefinementDraft(null));
  const [aiRefinement, setAiRefinement] = useState(DEFAULT_AI_STATE);
  const [dailyAdvice, setDailyAdvice] = useState(DEFAULT_DAILY_ADVICE_STATE);
  const [planningMessage, setPlanningMessage] = useState('');

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
        setPlanning(DEFAULT_PLANNING_STATE);
        setChecklists(DEFAULT_CHECKLISTS_STATE);
        setPersistError('');
        setPersistReady(false);
        setSelectedTicket(null);
        setDailyAdvice(DEFAULT_DAILY_ADVICE_STATE);
        return;
      }

      setPersistReady(false);
      try {
        const state = await api.boardState(projectKey);
        if (cancelled) return;
        setShowArchive(state.showArchive !== false);
        setSprints(state.sprints || {});
        setPlacements(state.placements || {});
        setPlanning({ ...DEFAULT_PLANNING_STATE, ...(state.planning || {}) });
        setChecklists(state.checklists || DEFAULT_CHECKLISTS_STATE);
        setPersistError('');
      } catch (e) {
        if (cancelled) return;
        setShowArchive(true);
        setSprints({});
        setPlacements({});
        setPlanning(DEFAULT_PLANNING_STATE);
        setChecklists(DEFAULT_CHECKLISTS_STATE);
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
    let cancelled = false;

    async function loadProjectContext() {
      if (!projectKey) {
        setAvailableComponents([]);
        setObjectiveContext({ board: null, issues: [] });
        setProjectContextError('');
        return;
      }

      const [componentsRes, objectivesRes] = await Promise.allSettled([
        api.jiraComponents(projectKey),
        api.jiraObjectives(),
      ]);

      if (cancelled) return;

      if (componentsRes.status === 'fulfilled') {
        setAvailableComponents(componentsRes.value || []);
      } else {
        setAvailableComponents([]);
      }

      if (objectivesRes.status === 'fulfilled') {
        setObjectiveContext(objectivesRes.value || { board: null, issues: [] });
      } else {
        setObjectiveContext({ board: null, issues: [] });
      }

      const errors = [];
      if (componentsRes.status === 'rejected') errors.push(componentsRes.reason?.response?.data?.error || componentsRes.reason?.message || 'components');
      if (objectivesRes.status === 'rejected') errors.push(objectivesRes.reason?.response?.data?.error || objectivesRes.reason?.message || 'objectives');
      setProjectContextError(errors.join(' · '));
    }

    loadProjectContext();
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
    setDailyAdvice(DEFAULT_DAILY_ADVICE_STATE);
  }, [lang, projectKey]);

  useEffect(() => {
    let cancelled = false;

    async function persistBoardState() {
      if (!projectKey || !persistReady) return;
      try {
        await api.saveBoardState(projectKey, { placements, sprints, showArchive, planning, checklists });
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
  }, [checklists, placements, persistReady, planning, projectKey, showArchive, sprints]);

  const sprintList = useMemo(
    () => Object.values(sprints).sort((a, b) => sprintSortValue(a).localeCompare(sprintSortValue(b))),
    [sprints]
  );

  const activeSprint = sprintList.find((sprint) => sprint.state === 'active') || null;
  const futureSprints = sprintList.filter((sprint) => sprint.state === 'future');
  const planningTargetSprint = activeSprint || futureSprints[0] || null;

  useEffect(() => {
    if (!planning.sprintGoalDraft && planningTargetSprint?.goal) {
      setPlanning((previous) => ({ ...previous, sprintGoalDraft: planningTargetSprint.goal }));
    }
  }, [planning.sprintGoalDraft, planningTargetSprint?.goal]);

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

  const objectiveMatches = useMemo(() => {
    const out = {};
    for (const ticket of tickets) {
      const match = buildObjectiveMatch(ticket, objectiveContext.issues || []);
      if (match) out[ticket.key] = match;
    }
    return out;
  }, [objectiveContext.issues, tickets]);

  const allTicketsByLane = useMemo(() => groupTicketsByLane(tickets, placements, sprints), [tickets, placements, sprints]);
  const ticketsByLane = useMemo(() => groupTicketsByLane(filteredTickets, placements, sprints), [filteredTickets, placements, sprints]);

  const lanePoints = useMemo(() => {
    const sums = {};
    for (const [laneId, laneTickets] of Object.entries(allTicketsByLane)) {
      sums[laneId] = laneTickets.reduce((sum, ticket) => sum + storyPoints(ticket), 0);
    }
    return sums;
  }, [allTicketsByLane]);

  const visibleTicketCount = useMemo(() => {
    let count = (ticketsByLane.backlog || []).length;
    if (activeSprint) count += (ticketsByLane[`sprint:${activeSprint.id}`] || []).length;
    for (const sprint of futureSprints) {
      count += (ticketsByLane[`sprint:${sprint.id}`] || []).length;
    }
    if (showArchive && workflowMode === 'daily') count += (ticketsByLane.archive || []).length;
    return count;
  }, [activeSprint, futureSprints, showArchive, ticketsByLane, workflowMode]);

  const refinementCandidates = useMemo(
    () =>
      tickets
        .filter((ticket) => !ticket.done)
        .map((ticket) => ({
          ticket,
          objectiveMatch: objectiveMatches[ticket.key] || null,
          gaps: refinementGapCodes(ticket, objectiveMatches[ticket.key] || null),
        }))
        .filter((entry) => entry.gaps.length > 0)
        .sort((a, b) => b.gaps.length - a.gaps.length || b.ticket.daysOpen - a.ticket.daysOpen),
    [objectiveMatches, tickets]
  );

  const sprintPointStats = useMemo(() => {
    const totals = {};
    for (const ticket of tickets) {
      const points = storyPoints(ticket);
      for (const sprint of ticket.sprints) {
        if (!totals[sprint.id]) {
          totals[sprint.id] = { sprint, points: 0, donePoints: 0 };
        }
        totals[sprint.id].points += points;
        if (ticket.done) totals[sprint.id].donePoints += points;
      }
    }

    const historical = Object.values(totals).filter((entry) => entry.points > 0);
    const closed = historical.filter((entry) => entry.sprint.state === 'closed');
    const source = closed.length > 0 ? closed : historical;
    const averageLoad = source.length > 0
      ? Math.round((source.reduce((sum, entry) => sum + (closed.length > 0 ? entry.donePoints : entry.points), 0) / source.length) * 10) / 10
      : 0;

    return { bySprintId: totals, averageLoad };
  }, [tickets]);

  const currentSprintSubtitle = activeSprint
    ? [
        activeSprint.goal ? `${t.currentSprintGoal}: ${activeSprint.goal}` : `${t.currentSprintGoal}: ${t.noSprintGoal}`,
        activeSprint.endDate ? `${t.remainingSprintDays}: ${formatRemainingDays(daysRemaining(activeSprint.endDate), t)}` : '',
        activeSprint.startDate || activeSprint.endDate
          ? `${formatDateLabel(activeSprint.startDate)}${activeSprint.endDate ? ` - ${formatDateLabel(activeSprint.endDate)}` : ''}`
          : '',
      ].filter(Boolean).join(' · ')
    : t.noActiveSprint;

  function openTicket(ticket) {
    setSelectedTicket(ticket);
    setRefinementDraft(createRefinementDraft(ticket));
    setAiRefinement(DEFAULT_AI_STATE);
  }

  function onDragStart(event, ticketKey) {
    event.dataTransfer.setData('text/plain', ticketKey);
    event.dataTransfer.effectAllowed = 'move';
  }

  function onDragEnd() {
    setDropTargetLane('');
  }

  function onDropTicket(ticketKey, laneId) {
    if (!ticketKey || !laneId) return;
    const ticket = tickets.find((entry) => entry.key === ticketKey);
    const nextLane = ticket?.done ? 'archive' : laneId;
    setPlacements((previous) => ({ ...previous, [ticketKey]: nextLane }));
    setDropTargetLane('');
  }

  function toggleChecklist(sectionKey, itemKey, checked) {
    if (!selectedTicket?.key) return;
    setChecklists((previous) => ({
      ...previous,
      [selectedTicket.key]: {
        ...(previous[selectedTicket.key] || {}),
        [sectionKey]: {
          ...(previous[selectedTicket.key]?.[sectionKey] || {}),
          [itemKey]: checked,
        },
      },
    }));
  }

  async function generateDailyAdvice() {
    if (!projectKey) return;
    setDailyAdvice({ ...DEFAULT_DAILY_ADVICE_STATE, loading: true });
    try {
      const analysis = await api.analyze(projectKey, lang);
      const planChanges = (analysis.suggestions || [])
        .map((entry) => [entry?.key, entry?.text].filter(Boolean).join(': '))
        .filter(Boolean);
      const coordination = (analysis.sprintHealth?.followUps || [])
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
      const watchItems = [
        ...(analysis.sprintHealth?.blockers || []),
        ...(analysis.sprintHealth?.deliveryRisks || []),
      ]
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);

      setDailyAdvice({
        loading: false,
        error: '',
        result: {
          summary: analysis.summary || '',
          planChanges: planChanges.length > 0 ? planChanges : [t.noData],
          coordination: coordination.length > 0 ? coordination : [t.noData],
          watchItems: watchItems.length > 0 ? watchItems : [t.noData],
        },
      });
    } catch (e) {
      setDailyAdvice({
        loading: false,
        error: e?.response?.data?.error || e.message || 'Failed to generate daily advice',
        result: null,
      });
    }
  }

  function startSprint() {
    const now = new Date();
    const startDate = now.toISOString();
    const endDate = new Date(now.getTime() + 14 * 86400000).toISOString();
    const candidate = futureSprints[0];
    const draftGoal = planning.sprintGoalDraft.trim();

    if (candidate) {
      setSprints((previous) => ({
        ...previous,
        [candidate.id]: {
          ...previous[candidate.id],
          state: 'active',
          goal: draftGoal || previous[candidate.id]?.goal || '',
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
        goal: draftGoal,
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

  function onPlanningChange(field, value) {
    setPlanning((previous) => ({ ...previous, [field]: value }));
    setPlanningMessage('');
  }

  function saveSprintGoal() {
    const goal = planning.sprintGoalDraft.trim();
    if (planningTargetSprint) {
      setSprints((previous) => ({
        ...previous,
        [planningTargetSprint.id]: {
          ...previous[planningTargetSprint.id],
          goal,
        },
      }));
    }
    setPlanningMessage(t.saved);
  }

  const baselineLoad = `${sprintPointStats.averageLoad || 0} ${t.points}`;
  const backlogPoints = `${lanePoints.backlog || 0} ${t.points}`;
  const activeSprintPoints = `${activeSprint ? lanePoints[`sprint:${activeSprint.id}`] || 0 : 0} ${t.points}`;
  const planningTargetSprintPoints = `${planningTargetSprint ? lanePoints[`sprint:${planningTargetSprint.id}`] || 0 : 0} ${t.points}`;

  function onRefinementDraftChange(field, value) {
    setRefinementDraft((previous) => ({ ...previous, [field]: value }));
    setAiRefinement((previous) => ({ ...previous, error: '', savedMessage: '' }));
  }

  async function generateRefinement(ticket = selectedTicket) {
    if (!ticket) return;
    setSelectedTicket(ticket);
    setRefinementDraft(createRefinementDraft(ticket));
    setAiRefinement({ ...DEFAULT_AI_STATE, loading: true });
    try {
      const result = await api.refineTicket({
        lang,
        ticket: {
          key: ticket.key,
          summary: ticket.fields.summary || '',
          description: extractRichText(ticket.fields.description) || '',
          comments: (ticket.fields.comment?.comments || []).map((comment) => extractRichText(comment.body)).filter(Boolean),
          status: ticket.fields.status?.name || '',
          priority: ticket.fields.priority?.name || '',
          components: (ticket.fields.components || []).map((component) => component?.name).filter(Boolean),
        },
        availableComponents: availableComponents.map((component) => component.name),
        objectiveCandidates: (objectiveContext.issues || []).map((issue) => ({
          key: issue.key,
          summary: issue.fields?.summary || '',
          status: issue.fields?.status?.name || '',
        })),
      });

      setAiRefinement({ ...DEFAULT_AI_STATE, result });
      setRefinementDraft({
        summary: result.refinedSummary || ticket.fields.summary || '',
        description: result.refinedDescription || extractRichText(ticket.fields.description) || '',
        acceptanceCriteria: (result.acceptanceCriteria || []).join('\n'),
        componentName: result.productComponent?.name || primaryComponentName(ticket),
      });
    } catch (e) {
      setAiRefinement({
        ...DEFAULT_AI_STATE,
        error: e?.response?.data?.error || e.message || 'AI refinement failed',
      });
    }
  }

  async function applyRefinement() {
    if (!selectedTicket) return;
    setAiRefinement((previous) => ({ ...previous, saving: true, error: '', savedMessage: '' }));
    try {
      const selectedComponent = availableComponents.find((component) => component.name === refinementDraft.componentName);
      const fields = {
        summary: refinementDraft.summary.trim() || selectedTicket.fields.summary,
        description: buildDescriptionPayload(refinementDraft.description, refinementDraft.acceptanceCriteria),
        components: selectedComponent ? [{ id: selectedComponent.id }] : [],
      };

      await api.updateIssue(selectedTicket.key, fields);
      setAiRefinement((previous) => ({ ...previous, saving: false, savedMessage: t.refinementApplied }));
      await onRefresh?.();
    } catch (e) {
      setAiRefinement((previous) => ({
        ...previous,
        saving: false,
        error: e?.response?.data?.error || e.message || 'Failed to update ticket',
      }));
    }
  }

  return (
    <div className="ticketlist sprint-board">
      <div className="tl-search">
        <Search size={12} style={{ marginRight: 6, opacity: 0.5 }} />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} />
        <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>{visibleTicketCount}</span>
        {workflowMode === 'daily' && (
          <button className="btn-icon" onClick={() => setShowArchive((value) => !value)}>
            {showArchive ? t.hideArchive : t.showArchive}
          </button>
        )}
      </div>

      {persistError && <div className="error-text">{persistError}</div>}
      {projectContextError && workflowMode === 'refinement' && <div className="error-text">{projectContextError}</div>}

      {workflowMode === 'refinement' && (
        <RefinementPanel
          candidates={refinementCandidates}
          objectiveBoardName={objectiveContext.board?.name}
          objectiveCoverage={`${Object.keys(objectiveMatches).length}/${tickets.length || 0}`}
          missingProductCount={tickets.filter((ticket) => !primaryComponentName(ticket) && !ticket.done).length}
          t={t}
          onOpenTicket={openTicket}
          onGenerateRefinement={generateRefinement}
        />
      )}

      {workflowMode === 'planning' && (
        <PlanningPanel
          t={t}
          planning={planning}
          onPlanningChange={onPlanningChange}
          onSaveSprintGoal={saveSprintGoal}
          planningMessage={planningMessage}
          planningTargetSprint={planningTargetSprint}
          baselineLoad={baselineLoad}
          backlogPoints={backlogPoints}
          targetSprintPoints={planningTargetSprintPoints}
        />
      )}

      {workflowMode === 'daily' && (
        <DailyPanel
          t={t}
          activeSprint={activeSprint}
          remainingDays={daysRemaining(activeSprint?.endDate)}
          planning={planning}
          dailyAdvice={dailyAdvice}
          onGenerateDailyAdvice={generateDailyAdvice}
          hasProject={Boolean(projectKey)}
          baselineLoad={baselineLoad}
          activeSprintPoints={activeSprintPoints}
          backlogPoints={backlogPoints}
        />
      )}

      <TeamStandardsPanel t={t} />

      <div className="sprint-summary-card">
        <div className="sprint-summary-meta">
          <div className="sprint-summary-title">{activeSprint ? activeSprint.name : t.noActiveSprint}</div>
          <div className="sprint-summary-line">{currentSprintSubtitle}</div>
          <div className="workflow-meta-row">
            <span className="workflow-chip">{t.teamBaselineLoad}: {baselineLoad}</span>
            <span className="workflow-chip">{t.backlogLoad}: {backlogPoints}</span>
            <span className="workflow-chip">{t.sprintLoad}: {activeSprintPoints}</span>
          </div>
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
          points={activeSprint ? lanePoints[`sprint:${activeSprint.id}`] || 0 : 0}
          laneId={activeSprint ? `sprint:${activeSprint.id}` : ''}
          tickets={activeSprint ? ticketsByLane[`sprint:${activeSprint.id}`] || [] : []}
          t={t}
          onDropTicket={onDropTicket}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragEnterLane={setDropTargetLane}
          onOpenTicket={openTicket}
          dropTargetLane={dropTargetLane}
          objectiveMatches={objectiveMatches}
          checklistStates={checklists}
          allowDrop={Boolean(activeSprint)}
        />

        <Section
          title={t.backlog}
          subtitle={workflowMode === 'planning' ? t.planningSubtitle : t.backlogHint}
          count={(ticketsByLane.backlog || []).length}
          points={lanePoints.backlog || 0}
          laneId="backlog"
          tickets={ticketsByLane.backlog || []}
          t={t}
          onDropTicket={onDropTicket}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragEnterLane={setDropTargetLane}
          onOpenTicket={openTicket}
          dropTargetLane={dropTargetLane}
          objectiveMatches={objectiveMatches}
          checklistStates={checklists}
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
              points={lanePoints[`sprint:${sprint.id}`] || 0}
              laneId={`sprint:${sprint.id}`}
              tickets={ticketsByLane[`sprint:${sprint.id}`] || []}
              t={t}
              onDropTicket={onDropTicket}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragEnterLane={setDropTargetLane}
              onOpenTicket={openTicket}
              dropTargetLane={dropTargetLane}
              objectiveMatches={objectiveMatches}
              checklistStates={checklists}
              allowDrop
            />
          ))
        )}

        {showArchive && workflowMode === 'daily' && (
          <Section
            title={t.archive}
            subtitle={t.archiveHint}
            count={(ticketsByLane.archive || []).length}
            points={lanePoints.archive || 0}
            laneId="archive"
            tickets={ticketsByLane.archive || []}
            t={t}
            onDropTicket={onDropTicket}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragEnterLane={setDropTargetLane}
            onOpenTicket={openTicket}
            dropTargetLane={dropTargetLane}
            objectiveMatches={objectiveMatches}
            checklistStates={checklists}
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
              workflowMode={workflowMode}
              availableComponents={availableComponents}
              objectiveMatch={objectiveMatches[selectedTicket.key] || null}
              objectiveBoardName={objectiveContext.board?.name || ''}
              refinementDraft={refinementDraft}
              onRefinementDraftChange={onRefinementDraftChange}
              onGenerateRefinement={generateRefinement}
              aiRefinement={aiRefinement}
              checklistState={checklists[selectedTicket.key] || null}
              onToggleChecklist={toggleChecklist}
              onApplyRefinement={applyRefinement}
              onClose={() => setSelectedTicket(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
