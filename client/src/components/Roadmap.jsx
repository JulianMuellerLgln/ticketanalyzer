import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2 } from 'lucide-react';

const STATUS_COLOR = { open: '#555', 'in progress': '#888', done: '#e53e3e' };

let nextId = 1;

export default function Roadmap({ t }) {
  const [milestones, setMilestones] = useState([
    { id: nextId++, title: 'MVP', date: '2025-Q1', status: 'done' },
    { id: nextId++, title: 'Beta Release', date: '2025-Q2', status: 'in progress' },
  ]);
  const [form, setForm] = useState({ title: '', date: '', status: 'open' });

  function add() {
    if (!form.title.trim()) return;
    setMilestones((m) => [...m, { id: nextId++, ...form }]);
    setForm({ title: '', date: '', status: 'open' });
  }

  function remove(id) {
    setMilestones((m) => m.filter((ms) => ms.id !== id));
  }

  return (
    <div className="roadmap">
      <div className="roadmap-timeline">
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
                <span className="milestone-title">{ms.title}</span>
                {ms.date && <span className="milestone-date">{ms.date}</span>}
                <span
                  className="milestone-status"
                  style={{ color: STATUS_COLOR[ms.status] || '#888' }}
                >
                  {ms.status}
                </span>
              </div>
              <button className="icon-btn" onClick={() => remove(ms.id)}>
                <Trash2 size={11} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="roadmap-form">
        <input
          className="input"
          style={{ flex: 2 }}
          placeholder={t.roadmapTitle}
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder={t.roadmapDate}
          value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
        />
        <select
          className="input"
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
          style={{ flex: 1 }}
        >
          <option value="open">{t.open}</option>
          <option value="in progress">{t.inProgress}</option>
          <option value="done">{t.done}</option>
        </select>
        <button className="btn-primary" onClick={add}>{t.add}</button>
      </div>
    </div>
  );
}
