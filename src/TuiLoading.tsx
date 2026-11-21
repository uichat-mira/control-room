import "./tui-loading.css";

/**
 * Shared non-blocking, indeterminate read state for Control Room.
 * The frame/cursor are visual only: no invented percentage, ETA or progress.
 */
export function TuiSpinner() {
  return <span className="tui-spinner" aria-hidden="true" />;
}

export function TuiLoading({
  title,
  detail,
  command = "MIRA / READ",
  compact = false,
}: {
  title: string;
  detail?: string;
  command?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={compact ? "tui-loading tui-loading-compact" : "tui-loading"}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="tui-loading-terminal" aria-hidden="true">
        <span className="tui-loading-prompt">&gt;</span>
        <span className="tui-loading-command">{command}</span>
        <TuiSpinner />
      </div>
      <div className="tui-loading-copy">
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </div>
      <div className="tui-loading-activity" aria-hidden="true">
        <span className="tui-loading-track"><span className="tui-loading-sweep" /></span>
        <span className="tui-loading-state">READING<span className="tui-loading-cursor">_</span></span>
      </div>
    </div>
  );
}
