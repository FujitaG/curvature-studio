import { useEffect, useRef, useState, type ReactNode } from 'react';

let lastTooltipVisibleAt = 0;

interface TooltipProps {
  children: ReactNode;
  className?: string;
  content: string;
  disabled?: boolean;
  placement?: 'bottom' | 'right';
}

export function Tooltip({ children, className = '', content, disabled = false, placement = 'bottom' }: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const show = () => {
    if (disabled) return;
    clearTimer();
    const delay = Date.now() - lastTooltipVisibleAt <= 500 ? 0 : 400;
    timerRef.current = window.setTimeout(() => {
      lastTooltipVisibleAt = Date.now();
      setVisible(true);
    }, delay);
  };

  const hide = () => {
    clearTimer();
    if (visible) lastTooltipVisibleAt = Date.now();
    setVisible(false);
  };

  useEffect(() => {
    return () => clearTimer();
  }, []);

  return (
    <span className={`tooltip-anchor tooltip-${placement}${className ? ` ${className}` : ''}`} onBlur={hide} onFocus={show} onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && !disabled ? (
        <span className="ui-tooltip panel" role="tooltip">
          {content}
        </span>
      ) : null}
    </span>
  );
}
