import { useEffect } from 'react';
import { X } from 'lucide-react';
import MiddleScrollArea from './MiddleScrollArea';

export default function TeamStandardsModal({ open, onClose, t }) {
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
              <h3 className="ticket-modal-title">{t.teamStandardsTitle}</h3>
            </div>
            <div className="ticket-modal-subtitle">{t.teamStandardsSubtitle}</div>
          </div>
          <button className="icon-btn" onClick={onClose} title={t.close}>
            <X size={16} />
          </button>
        </div>

        <MiddleScrollArea className="ticket-modal-body scrum-guide-body">
          <section className="guide-section">
            <h4>{t.definitionOfReadyTitle}</h4>
            <ul>
              {t.definitionOfReadyItems.map((item, idx) => (
                <li key={`ready-standard-${idx}`}>{item}</li>
              ))}
            </ul>
          </section>
          <section className="guide-section">
            <h4>{t.definitionOfDoneTitle}</h4>
            <ul>
              {t.definitionOfDoneItems.map((item, idx) => (
                <li key={`done-standard-${idx}`}>{item}</li>
              ))}
            </ul>
          </section>
        </MiddleScrollArea>
      </div>
    </div>
  );
}
