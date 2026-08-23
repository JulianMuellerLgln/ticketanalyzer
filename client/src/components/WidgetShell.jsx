import { motion, AnimatePresence } from 'framer-motion';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { useState, useRef } from 'react';
import Draggable from 'react-draggable';

export default function WidgetShell({ id, title, children, defaultPos, onClose }) {
  const [expanded, setExpanded] = useState(false);
  const nodeRef = useRef(null);

  return (
    <AnimatePresence>
      <Draggable
        nodeRef={nodeRef}
        handle=".widget-header"
        defaultPosition={defaultPos || { x: 0, y: 0 }}
        disabled={expanded}
        bounds="parent"
      >
        <motion.div
          ref={nodeRef}
          layout
          className={`widget ${expanded ? 'widget--expanded' : ''}`}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.2 }}
        >
          <div className="widget-header">
            <span className="widget-title">{title}</span>
            <div className="widget-controls">
              <button
                className="icon-btn"
                onClick={() => setExpanded((v) => !v)}
                title={expanded ? 'Minimize' : 'Maximize'}
              >
                {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
              {onClose && (
                <button className="icon-btn" onClick={() => onClose(id)} title="Close">
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
          <div className="widget-body">{children}</div>
        </motion.div>
      </Draggable>
    </AnimatePresence>
  );
}
