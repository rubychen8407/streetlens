import { useId, type ReactNode } from 'react';

export function DockButton({ label, active, onClick, children, expanded }: {
  label: string; active: boolean; onClick: () => void; children: ReactNode; expanded?: boolean;
}) {
  const tooltipId = useId();
  return <button type="button" className="dock-button" onClick={onClick} aria-label={label}
    aria-pressed={active} aria-expanded={expanded} aria-haspopup={expanded == null ? undefined : 'dialog'} aria-describedby={tooltipId}>
    {children}<span id={tooltipId} role="tooltip" className="dock-tooltip">{label}</span>
  </button>;
}
