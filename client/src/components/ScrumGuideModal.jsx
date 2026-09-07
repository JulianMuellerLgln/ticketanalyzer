import { useEffect } from 'react';
import { X } from 'lucide-react';
import MiddleScrollArea from './MiddleScrollArea';

export default function ScrumGuideModal({ open, onClose, t }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ticket-modal-overlay" onClick={onClose}>
      <div className="ticket-modal scrum-guide-modal" onClick={(event) => event.stopPropagation()}>
        <div className="ticket-modal-header">
          <div>
            <div className="ticket-modal-title-row">
              <h3 className="ticket-modal-title">{t.scrumGuideTitle}</h3>
            </div>
            <div className="ticket-modal-subtitle">{t.scrumGuideSubtitle}</div>
          </div>
          <button className="icon-btn" onClick={onClose} title={t.close}>
            <X size={16} />
          </button>
        </div>

        <MiddleScrollArea className="ticket-modal-body scrum-guide-body">
          <section className="guide-section">
            <h4>{t.scrumValuesTitle}</h4>
            <ul>
              {t.scrumValueMeanings.map((entry) => (
                <li key={entry.value}>
                  <strong>{entry.value}</strong>
                  <div className="guide-value-meaning">{entry.meaning}</div>
                </li>
              ))}
            </ul>
          </section>

          <section className="guide-section">
            <h4>{t.scrumGuideUpdatesTitle}</h4>
            <ul>
              {t.scrumGuideUpdates.map((entry, idx) => (
                <li key={`guide-update-${idx}`}>{entry}</li>
              ))}
            </ul>
          </section>

          <section className="guide-section">
            <h4>{t.scrumGuideRefinementTitle}</h4>
            <ul>
              {t.scrumGuideRefinement.map((entry, idx) => (
                <li key={`guide-refinement-${idx}`}>{entry}</li>
              ))}
            </ul>
          </section>

          <section className="guide-section">
            <h4>{t.scrumGuidePlanningTitle}</h4>
            <ul>
              {t.scrumGuidePlanning.map((entry, idx) => (
                <li key={`guide-planning-${idx}`}>{entry}</li>
              ))}
            </ul>
          </section>

          <section className="guide-section">
            <h4>{t.scrumGuideDailyTitle}</h4>
            <ul>
              {t.scrumGuideDaily.map((entry, idx) => (
                <li key={`guide-daily-${idx}`}>{entry}</li>
              ))}
            </ul>
          </section>
        </MiddleScrollArea>
      </div>
    </div>
  );
}
