import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, XCircle, Circle, RefreshCw, Upload } from 'lucide-react';
import { api } from '../api';
import TicketLink from './TicketLink';

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
  idle: <Circle size={12} style={{ color: '#666' }} />,
  done: <CheckCircle size={12} style={{ color: '#4caf50' }} />,
  error: <XCircle size={12} style={{ color: '#e53e3e' }} />,
  retrying: <RetryIcon />,
};

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

function optionLabel(v) {
  return v?.name || v?.value || v?.displayName || v?.key || v?.id || '';
}

function optionValue(v) {
  return String(v?.id ?? v?.key ?? v?.value ?? v?.name ?? '');
}

function optionReactKey(v, idx, fieldId) {
  const raw = optionValue(v);
  const safeFieldId = fieldId && String(fieldId).trim() ? String(fieldId) : 'field';
  if (raw && raw.trim()) return `${safeFieldId}-${raw}`;
  return `${safeFieldId}-opt-${idx}`;
}

function isEmpty(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return String(v).trim() === '';
}

function toJiraRef(option) {
  if (!option || typeof option !== 'object') return option;
  if (option.id) return { id: option.id };
  if (option.key) return { key: option.key };
  if (option.value) return { value: option.value };
  if (option.name) return { name: option.name };
  return option;
}

function buildFieldsPayload(values, fieldMeta) {
  const fields = {};
  for (const [fieldId, meta] of Object.entries(fieldMeta || {})) {
    const raw = values[fieldId];
    if (isEmpty(raw)) continue;

    const schemaType = meta?.schema?.type;
    const allowed = Array.isArray(meta?.allowedValues) ? meta.allowedValues : [];
    if (fieldId === 'labels') {
      const labels = String(raw)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      if (labels.length > 0) fields[fieldId] = labels;
      continue;
    }

    if (schemaType === 'array') {
      if (allowed.length > 0) {
        const selected = Array.isArray(raw) ? raw : [raw];
        const mapped = selected
          .map((key) => allowed.find((opt) => optionValue(opt) === String(key)))
          .filter(Boolean)
          .map((opt) => toJiraRef(opt));
        if (mapped.length > 0) fields[fieldId] = mapped;
      } else if (meta?.schema?.items === 'string') {
        fields[fieldId] = String(raw)
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
      }
      continue;
    }

    if (allowed.length > 0) {
      const picked = allowed.find((opt) => optionValue(opt) === String(raw));
      if (picked) fields[fieldId] = toJiraRef(picked);
      continue;
    }

    if (schemaType === 'number') {
      fields[fieldId] = Number(raw);
      continue;
    }

    fields[fieldId] = raw;
  }
  return fields;
}

export default function JiraSync({ projectKey, t, jiraBaseUrl }) {
  const [issueTypes, setIssueTypes] = useState([]);
  const [issueType, setIssueType] = useState('');
  const [meta, setMeta] = useState({ fields: {} });
  const [formValues, setFormValues] = useState({});
  const [loadingMeta, setLoadingMeta] = useState(false);

  const [status, setStatus] = useState('idle');
  const [statusText, setStatusText] = useState('');
  const [createdKey, setCreatedKey] = useState('');
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [maxRetries, setMaxRetries] = useState(0);
  const [syncError, setSyncError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const remaining = useCountdown(waitSeconds);

  const streamRef = useRef(null);

  useEffect(() => {
    setIssueTypes([]);
    setIssueType('');
    setMeta({ fields: {} });
    setFormValues({});
    setStatus('idle');
    setStatusText('');
    setCreatedKey('');
    setSyncError('');
    if (!projectKey) return;

    api.jiraIssueTypes(projectKey)
      .then((types) => {
        setIssueTypes(types || []);
        const story = (types || []).find((it) => it.name === 'Story');
        setIssueType(story?.name || types?.[0]?.name || '');
      })
      .catch((e) => {
        setSyncError(e?.response?.data?.error || e.message || 'Could not load issue types');
      });
  }, [projectKey]);

  useEffect(() => {
    if (!projectKey || !issueType) return;
    setLoadingMeta(true);
    setSyncError('');
    api.jiraCreateMeta(projectKey, issueType)
      .then((m) => {
        setMeta(m || { fields: {} });
      })
      .catch((e) => {
        setMeta({ fields: {} });
        setSyncError(e?.response?.data?.error || e.message || 'Could not load Jira create fields');
      })
      .finally(() => setLoadingMeta(false));
  }, [projectKey, issueType]);

  const orderedFields = useMemo(() => {
    const entries = Object.entries(meta?.fields || {}).filter(([id]) => id !== 'project' && id !== 'issuetype');
    entries.sort((a, b) => {
      if (a[1].required !== b[1].required) return a[1].required ? -1 : 1;
      return String(a[1].name || a[0]).localeCompare(String(b[1].name || b[0]));
    });
    return entries;
  }, [meta]);

  function setFieldValue(fieldId, value) {
    setFormValues((v) => ({ ...v, [fieldId]: value }));
  }

  async function startSync() {
    if (!projectKey) return;
    const fields = buildFieldsPayload(formValues, meta?.fields || {});
    if (!fields.summary || !String(fields.summary).trim()) {
      setSyncError('Summary is required');
      return;
    }

    fields.issuetype = { name: issueType };

    setSyncing(true);
    setStatus('idle');
    setStatusText('');
    setCreatedKey('');
    setSyncError('');

    const stream = await api.syncToJira(projectKey, [{ fields, summary: fields.summary, issuetype: issueType }], {
      onProgress: ({ index, status, key, error }) => {
        if (index !== 0) return;
        setStatus(status || 'idle');
        setStatusText(error || '');
        setWaitSeconds(0);
        if (status === 'done' && key) setCreatedKey(key);
      },
      onRetrying: ({ index, attempt, maxRetries, waitSeconds, error }) => {
        if (index !== 0) return;
        setStatus('retrying');
        setAttempt(attempt || 0);
        setMaxRetries(maxRetries || 0);
        setWaitSeconds(waitSeconds || 0);
        setStatusText(error || '');
      },
      onDone: () => {
        setSyncing(false);
      },
      onError: (msg) => {
        setSyncing(false);
        setStatus('error');
        setSyncError(msg || 'Sync failed');
      },
    });
    streamRef.current = stream;
  }

  function cancel() {
    streamRef.current?.close();
    setSyncing(false);
    setStatus('idle');
    setWaitSeconds(0);
  }

  function renderDynamicField(fieldId, field, fieldIndex) {
    const safeFieldId = fieldId && String(fieldId).trim() ? String(fieldId) : `field-${fieldIndex}`;
    const allowed = Array.isArray(field.allowedValues) ? field.allowedValues : [];
    const schemaType = field?.schema?.type;
    const value = formValues[fieldId] ?? (schemaType === 'array' ? [] : '');
    const label = `${field.name || fieldId}${field.required ? ' *' : ''}`;

    if (allowed.length > 0 && schemaType === 'array') {
      return (
        <div className="js-field" key={safeFieldId}>
          <label className="js-label">{label}</label>
          <select
            multiple
            className="input js-input"
            value={Array.isArray(value) ? value : []}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
              setFieldValue(fieldId, selected);
            }}
            disabled={syncing}
          >
            {allowed.map((opt, idx) => (
              <option key={optionReactKey(opt, idx, safeFieldId)} value={optionValue(opt)}>
                {optionLabel(opt)}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (allowed.length > 0) {
      return (
        <div className="js-field" key={safeFieldId}>
          <label className="js-label">{label}</label>
          <select
            className="input js-input"
            value={String(value)}
            onChange={(e) => setFieldValue(fieldId, e.target.value)}
            disabled={syncing}
          >
            <option value="">--</option>
            {allowed.map((opt, idx) => (
              <option key={optionReactKey(opt, idx, safeFieldId)} value={optionValue(opt)}>
                {optionLabel(opt)}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (schemaType === 'number') {
      return (
        <div className="js-field" key={safeFieldId}>
          <label className="js-label">{label}</label>
          <input
            className="input js-input"
            type="number"
            value={value}
            onChange={(e) => setFieldValue(fieldId, e.target.value)}
            disabled={syncing}
          />
        </div>
      );
    }

    if (schemaType === 'date') {
      return (
        <div className="js-field" key={safeFieldId}>
          <label className="js-label">{label}</label>
          <input
            className="input js-input"
            type="date"
            value={value}
            onChange={(e) => setFieldValue(fieldId, e.target.value)}
            disabled={syncing}
          />
        </div>
      );
    }

    const isLongText = fieldId === 'description' || /description|akzeptanz|acceptance/i.test(field.name || fieldId);
    if (isLongText) {
      return (
        <div className="js-field js-field-wide" key={safeFieldId}>
          <label className="js-label">{label}</label>
          <textarea
            className="input js-textarea"
            value={value}
            onChange={(e) => setFieldValue(fieldId, e.target.value)}
            disabled={syncing}
            rows={4}
          />
        </div>
      );
    }

    const placeholder = schemaType === 'array' ? 'comma,separated,values' : '';
    return (
      <div className="js-field" key={safeFieldId}>
        <label className="js-label">{label}</label>
        <input
          className="input js-input"
          value={Array.isArray(value) ? value.join(', ') : value}
          placeholder={placeholder}
          onChange={(e) => setFieldValue(fieldId, e.target.value)}
          disabled={syncing}
        />
      </div>
    );
  }

  return (
    <div className="jirasync">
      <div className="js-head-row">
        <span className="js-status-icon">{STATUS_ICON[status] || STATUS_ICON.idle}</span>
        {status === 'retrying' && (
          <span className="js-retry-info muted">
            {t.syncRetrying.replace('{attempt}', attempt).replace('{max}', maxRetries).replace('{s}', remaining)}
          </span>
        )}
        {createdKey && (
          <TicketLink className="js-key" ticketKey={createdKey} baseUrl={jiraBaseUrl} />
        )}
      </div>

      {!projectKey && (
        <p className="muted" style={{ fontSize: 11 }}>{t.syncNoProject}</p>
      )}

      {projectKey && (
        <>
          <div className="js-field">
            <label className="js-label">Issue Type *</label>
            <select
              className="input js-input"
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
              disabled={syncing || issueTypes.length === 0}
            >
              {issueTypes.map((it, idx) => (
                <option key={(it.id || it.name) ? `issuetype-${it.id || it.name}` : `issuetype-${idx}`} value={it.name}>{it.name}</option>
              ))}
            </select>
          </div>

          {loadingMeta ? (
            <p className="muted" style={{ fontSize: 11 }}>{t.loading}</p>
          ) : (
            <div className="js-form-grid">
              {orderedFields.map(([fieldId, field], idx) => renderDynamicField(fieldId, field, idx))}
            </div>
          )}
        </>
      )}

      {syncError && <div className="error-text">{syncError}</div>}
      {statusText && status === 'error' && <div className="error-text">{statusText}</div>}

      <div className="js-actions">
        {syncing ? (
          <button className="btn-icon" onClick={cancel} title={t.cancel}>
            ✕ {t.cancel}
          </button>
        ) : (
          <button
            className="btn-primary"
            onClick={startSync}
            disabled={!projectKey || !issueType || loadingMeta}
            title={!projectKey ? t.syncNoProject : undefined}
          >
            <Upload size={12} style={{ marginRight: 5 }} />
            {t.syncStart}
          </button>
        )}
      </div>
    </div>
  );
}
