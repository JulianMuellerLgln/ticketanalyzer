import { useEffect, useRef } from 'react';

function canPanTarget(target) {
  return !(target instanceof HTMLElement && target.closest('a, input, textarea, select, option'));
}

export default function MiddleScrollArea({ className = '', children, ...props }) {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const state = {
      active: false,
      startX: 0,
      startY: 0,
      startTop: 0,
      startLeft: 0,
    };

    const stop = () => {
      if (!state.active) return;
      state.active = false;
      element.classList.remove('middle-scroll-area--panning');
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('blur', stop);
    };

    const onMouseMove = (event) => {
      if (!state.active) return;
      element.scrollLeft = state.startLeft - (event.clientX - state.startX);
      element.scrollTop = state.startTop - (event.clientY - state.startY);
    };

    const onMouseDown = (event) => {
      if (event.button !== 1 || !canPanTarget(event.target)) return;
      if (element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth) return;
      event.preventDefault();
      state.active = true;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.startTop = element.scrollTop;
      state.startLeft = element.scrollLeft;
      element.classList.add('middle-scroll-area--panning');
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', stop);
      window.addEventListener('blur', stop);
    };

    const onAuxClick = (event) => {
      if (event.button === 1 && canPanTarget(event.target)) {
        event.preventDefault();
      }
    };

    element.addEventListener('mousedown', onMouseDown);
    element.addEventListener('auxclick', onAuxClick);

    return () => {
      stop();
      element.removeEventListener('mousedown', onMouseDown);
      element.removeEventListener('auxclick', onAuxClick);
    };
  }, []);

  return (
    <div ref={ref} className={['middle-scroll-area', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  );
}
