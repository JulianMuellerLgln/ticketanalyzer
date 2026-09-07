import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../api';
import MiddleScrollArea from './MiddleScrollArea';

function formatNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function trendDirectionLabel(trend, t) {
  if (!trend || trend.direction === 'flat') return t.agileHiveTrendDirectionFlat;
  return trend.direction === 'up' ? t.agileHiveTrendDirectionUp : t.agileHiveTrendDirectionDown;
}

function trendDirectionClass(trend, invert = false) {
  const direction = trend?.direction || 'flat';
  if (direction === 'flat') return 'agile-hive-trend-pill--flat';
  const positive = invert ? direction === 'down' : direction === 'up';
  return positive ? 'agile-hive-trend-pill--up' : 'agile-hive-trend-pill--down';
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function MetricCard({ label, value, detail, warn = false }) {
  return (
    <div className={`agile-hive-card${warn ? ' agile-hive-card--warn' : ''}`}>
      <div className="agile-hive-card-value">{value}</div>
      <div className="agile-hive-card-label">{label}</div>
      {detail ? <div className="agile-hive-card-detail">{detail}</div> : null}
    </div>
  );
}

export default function AgileHiveModal({ open, onClose, t, projectKey }) {
  const [state, setState] = useState({ loading: false, error: '', data: null });

  const load = useCallback(async () => {
    if (!projectKey) return;
    setState({ loading: true, error: '', data: null });
    try {
      const data = await api.jiraAgileHive(projectKey, { historyCount: 3 });
      setState({ loading: false, error: '', data });
    } catch (error) {
      const message = error?.response?.data?.error || error?.response?.data?.details || error?.message || t.error;
      setState({ loading: false, error: message, data: null });
    }
  }, [projectKey, t.error]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !projectKey) return;
    load();
  }, [open, projectKey, load]);

  if (!open) return null;

  const metrics = state.data?.metrics || null;
  const interval = state.data?.interval || null;
  const trend = state.data?.sprintTrend || null;
  const trendItems = trend?.items || [];
  const loadWarn = metrics?.loadVsCap?.percent > 100;
  const maxDelivered = trendItems.reduce((max, item) => Math.max(max, Number(item?.metrics?.spBurned?.progress) || 0), 0) || 1;

  return (
    <div className="ticket-modal-overlay" onClick={onClose}>
      <div className="ticket-modal scrum-guide-modal agile-hive-modal" onClick={(event) => event.stopPropagation()}>
        <div className="ticket-modal-header">
          <div>
            <div className="ticket-modal-title-row">
              <h3 className="ticket-modal-title">{t.agileHiveTitle}</h3>
            </div>
            <div className="ticket-modal-subtitle">{t.agileHiveSubtitle}</div>
          </div>
          <button className="icon-btn" onClick={onClose} title={t.close}>
            <X size={16} />
          </button>
        </div>

        <MiddleScrollArea className="ticket-modal-body scrum-guide-body">
          <section className="guide-section">
            {!projectKey && <div className="muted">{t.syncNoProject}</div>}
            {projectKey && (
              <div className="agile-hive-toolbar">
                <span className="workflow-chip">{projectKey}</span>
                {interval?.name ? <span className="workflow-chip">{interval.name}</span> : null}
                {interval?.strategy ? <span className="workflow-chip">{interval.strategy}</span> : null}
                <button className="btn-icon" type="button" onClick={load} disabled={state.loading}>
                  {state.loading ? t.loading : t.refresh}
                </button>
              </div>
            )}
            {interval?.startDate && interval?.endDate ? (
              <div className="muted agile-hive-interval">
                {new Date(interval.startDate).toLocaleDateString()} - {new Date(interval.endDate).toLocaleDateString()}
              </div>
            ) : null}
            {state.error ? <div className="error-text">{state.error}</div> : null}
          </section>

          {metrics && (
            <section className="guide-section">
              <div className="agile-hive-grid">
                <MetricCard
                  label={t.agileHiveSpPerDay}
                  value={formatNumber(metrics.spPerDay, 2)}
                />
                <MetricCard
                  label={t.agileHiveVelocity}
                  value={formatNumber(metrics.velocity)}
                />
                <MetricCard
                  label={t.agileHiveSpBurned}
                  value={`${formatNumber(metrics.spBurned?.percent)}%`}
                  detail={`${formatNumber(metrics.spBurned?.progress, 1)} / ${formatNumber(metrics.spBurned?.total, 1)}`}
                />
                <MetricCard
                  label={t.agileHiveDaysPassed}
                  value={`${formatNumber(metrics.daysPassed?.percent)}%`}
                  detail={`${formatNumber(metrics.daysPassed?.progress, 1)} / ${formatNumber(metrics.daysPassed?.total, 1)}`}
                />
                <MetricCard
                  label={t.agileHiveBusinessValue}
                  value={`${formatNumber(metrics.businessValue?.percent)}%`}
                  detail={`${formatNumber(metrics.businessValue?.progress, 1)} / ${formatNumber(metrics.businessValue?.total, 1)}`}
                />
                <MetricCard
                  label={t.agileHiveLoadVsCap}
                  value={`${formatNumber(metrics.loadVsCap?.percent)}%`}
                  detail={`${formatNumber(metrics.loadVsCap?.progress, 1)} / ${formatNumber(metrics.loadVsCap?.total, 1)}`}
                  warn={loadWarn}
                />
              </div>
            </section>
          )}

          {trendItems.length > 0 && (
            <section className="guide-section">
              <h4>{t.agileHiveTrendTitle}</h4>
              <div className="muted">{t.agileHiveTrendSubtitle}</div>

              <div className="agile-hive-trend-summary">
                <MetricCard
                  label={t.agileHiveTrendAvgVelocity}
                  value={formatNumber(trend?.averages?.velocity, 1)}
                />
                <MetricCard
                  label={t.agileHiveTrendAvgDelivered}
                  value={formatNumber(trend?.averages?.deliveredSp, 1)}
                />
                <MetricCard
                  label={t.agileHiveTrendAvgCompletion}
                  value={`${formatNumber(trend?.averages?.completionRate)}%`}
                />
              </div>

              <div className="agile-hive-trend-pills">
                <span className={`agile-hive-trend-pill ${trendDirectionClass(trend?.trends?.velocity)}`}>
                  {t.agileHiveTrendVelocity}: {trendDirectionLabel(trend?.trends?.velocity, t)} ({trend?.trends?.velocity?.delta > 0 ? '+' : ''}{formatNumber(trend?.trends?.velocity?.delta, 1)})
                </span>
                <span className={`agile-hive-trend-pill ${trendDirectionClass(trend?.trends?.deliveredSp)}`}>
                  {t.agileHiveTrendDelivered}: {trendDirectionLabel(trend?.trends?.deliveredSp, t)} ({trend?.trends?.deliveredSp?.delta > 0 ? '+' : ''}{formatNumber(trend?.trends?.deliveredSp?.delta, 1)})
                </span>
                <span className={`agile-hive-trend-pill ${trendDirectionClass(trend?.trends?.completionRate)}`}>
                  {t.agileHiveTrendCompletion}: {trendDirectionLabel(trend?.trends?.completionRate, t)} ({trend?.trends?.completionRate?.delta > 0 ? '+' : ''}{formatNumber(trend?.trends?.completionRate?.delta, 1)})
                </span>
                <span className={`agile-hive-trend-pill ${trendDirectionClass(trend?.trends?.loadVsCap, true)}`}>
                  {t.agileHiveTrendLoad}: {trendDirectionLabel(trend?.trends?.loadVsCap, t)} ({trend?.trends?.loadVsCap?.delta > 0 ? '+' : ''}{formatNumber(trend?.trends?.loadVsCap?.delta, 1)})
                </span>
              </div>

              <div className="agile-hive-sprint-list">
                {trendItems.map((item) => {
                  const delivered = Number(item?.metrics?.spBurned?.progress) || 0;
                  const completion = Number(item?.metrics?.spBurned?.percent) || 0;
                  const loadPercent = Number(item?.metrics?.loadVsCap?.percent) || 0;
                  const deliveredWidth = clampPercent((delivered / maxDelivered) * 100);
                  const completionWidth = clampPercent(completion);
                  const loadWidth = clampPercent((loadPercent / 150) * 100);
                  return (
                    <div key={item.id} className="agile-hive-sprint-row">
                      <div className="agile-hive-sprint-head">
                        <strong>{item.name}</strong>
                        <span className="muted">
                          {item.startDate ? new Date(item.startDate).toLocaleDateString() : ''} {item.endDate ? `- ${new Date(item.endDate).toLocaleDateString()}` : ''}
                        </span>
                      </div>
                      <div className="agile-hive-sprint-bars">
                        <div className="agile-hive-bar">
                          <span className="agile-hive-bar-label">{t.agileHiveTrendDeliveredBar}</span>
                          <div className="agile-hive-bar-track">
                            <div className="agile-hive-bar-fill agile-hive-bar-fill--delivered" style={{ width: `${deliveredWidth}%` }} />
                          </div>
                          <span className="agile-hive-bar-value">{formatNumber(delivered, 1)}</span>
                        </div>
                        <div className="agile-hive-bar">
                          <span className="agile-hive-bar-label">{t.agileHiveTrendCompletionBar}</span>
                          <div className="agile-hive-bar-track">
                            <div className="agile-hive-bar-fill agile-hive-bar-fill--completion" style={{ width: `${completionWidth}%` }} />
                          </div>
                          <span className="agile-hive-bar-value">{formatNumber(completion)}%</span>
                        </div>
                        <div className="agile-hive-bar">
                          <span className="agile-hive-bar-label">{t.agileHiveTrendLoadBar}</span>
                          <div className="agile-hive-bar-track">
                            <div className={`agile-hive-bar-fill ${loadPercent > 100 ? 'agile-hive-bar-fill--load-warn' : 'agile-hive-bar-fill--load-ok'}`} style={{ width: `${loadWidth}%` }} />
                          </div>
                          <span className="agile-hive-bar-value">{formatNumber(loadPercent)}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </MiddleScrollArea>
      </div>
    </div>
  );
}
