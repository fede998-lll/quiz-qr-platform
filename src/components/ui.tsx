import { useEffect, useId, useMemo, useRef, useState, type PropsWithChildren, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getAvatarChoice, type AvatarChoice } from "../lib/avatars";

export function AppFrame(props: PropsWithChildren<{ title: string; subtitle?: string; actions?: ReactNode; eyebrow?: string | null; className?: string }>) {
  return (
    <div className={`app-shell ${props.className ?? ""}`.trim()}>
      <header className={`hero-shell ${props.actions ? "app-topbar" : "landing-hero"}`}>
        <div>
          {props.eyebrow !== null ? <p className="eyebrow">{props.eyebrow ?? "Quiz QR Classroom"}</p> : null}
          <h1>{props.title}</h1>
          {props.subtitle ? <p className="hero-copy">{props.subtitle}</p> : null}
        </div>
        {props.actions ? <div className="hero-actions">{props.actions}</div> : null}
      </header>
      <main className="app-content">{props.children}</main>
    </div>
  );
}

export function Panel(props: PropsWithChildren<{ title?: string; description?: string; className?: string; actions?: ReactNode }>) {
  return (
    <section className={`panel ${props.className ?? ""}`.trim()}>
      {props.title || props.actions ? (
        <div className="panel-header">
          {props.title ? <h2>{props.title}</h2> : <span />}
          {props.actions ? <div className="panel-actions">{props.actions}</div> : null}
        </div>
      ) : null}
      {props.description ? <p className="panel-copy">{props.description}</p> : null}
      {props.children}
    </section>
  );
}

export function Button(props: PropsWithChildren<{
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "ghost" | "danger" | "draft" | "draftDanger";
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
}>) {
  return (
    <button
      type={props.type ?? "button"}
      className={`button ${props.variant ?? "primary"} ${props.className ?? ""}`.trim()}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input value={props.value} placeholder={props.placeholder} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}

export function TextAreaField(props: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <textarea
        rows={4}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const selectedOption = useMemo(
    () => props.options.find((option) => option.value === props.value) ?? props.options[0] ?? null,
    [props.options, props.value],
  );

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className="field">
      <span>{props.label}</span>
      <div ref={rootRef} className={`custom-select ${isOpen ? "open" : ""}`}>
        <button
          type="button"
          className="custom-select-trigger"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          disabled={props.disabled}
          onClick={() => !props.disabled && setIsOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setIsOpen(true);
            }
          }}
        >
          <span className="custom-select-value">{selectedOption?.label ?? ""}</span>
          <span className="custom-select-chevron" aria-hidden="true" />
        </button>
        <div className="custom-select-menu" role="listbox" id={listboxId} aria-label={props.label}>
          {props.options.map((option) => {
            const isSelected = option.value === selectedOption?.value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`custom-select-option ${isSelected ? "selected" : ""}`}
                onClick={() => {
                  props.onChange(option.value);
                  setIsOpen(false);
                }}
              >
                <span>{option.label}</span>
                {isSelected ? <span className="custom-select-check">Selected</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function KpiCard(props: { label: string; value: ReactNode }) {
  return (
    <div className="kpi-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

export function StatusPill(props: { tone: "open" | "closed" | "info"; children: ReactNode }) {
  return <span className={`status-pill ${props.tone}`}>{props.children}</span>;
}

export function EmptyState(props: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{props.title}</h3>
      <p>{props.body}</p>
      {props.action}
    </div>
  );
}

export function LoadingState(props: { label: string }) {
  return (
    <div className="loading-state" aria-live="polite">
      <div className="spinner" />
      <span>{props.label}</span>
    </div>
  );
}

export function Dialog(props: PropsWithChildren<{
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h3 id="dialog-title">{props.title}</h3>
        <p>{props.body}</p>
        {props.children}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={props.onCancel}>
            {props.cancelLabel}
          </Button>
          <Button variant="danger" onClick={props.onConfirm}>
            {props.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function QrPanel(props: { title: string; value: string; href: string; isLinkVisible?: boolean }) {
  return (
    <div className={`qr-panel ${props.isLinkVisible ? "link-visible" : ""}`}>
      <div className="qr-card">
        <QRCodeSVG value={props.value} size={180} includeMargin />
      </div>
      <div className="qr-copy" aria-hidden={!props.isLinkVisible}>
        <strong>{props.title}</strong>
        <div className="qr-link-row">
          <a href={props.href}>{props.href}</a>
          <button
            type="button"
            className="qr-copy-button"
            aria-label="Copy student link"
            onClick={() => void navigator.clipboard.writeText(props.href)}
          >
            ⧉
          </button>
        </div>
      </div>
    </div>
  );
}

export function BarChart(props: {
  items: Array<{ label: string; value: number; percentage: number; isCorrect: boolean }>;
  showCorrectHighlight?: boolean;
}) {
  return (
    <div className="chart-stack">
      {props.items.map((item) => {
        const answerStateClass =
          props.showCorrectHighlight === true
            ? item.isCorrect
              ? "correct"
              : "incorrect"
            : "";
        return (
          <div key={item.label} className={`chart-row ${answerStateClass}`.trim()}>
            <div className="chart-meta">
              <span>{item.label}</span>
              <strong>{item.percentage}%</strong>
            </div>
            <span className="chart-count">{item.value} responses</span>
            <div className="chart-bar">
              <div className="chart-fill" style={{ width: `${item.percentage}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProgressRail(props: { current: number; total: number }) {
  const current = Math.min(Math.max(props.current, 0), props.total);
  const percentage = props.total === 0 ? 0 : Math.round((current / props.total) * 100);
  return (
    <div className="progress-rail" aria-label={`${current} of ${props.total} answers completed`}>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percentage}%` }} />
      </div>
      <span>
        {current}/{props.total}
      </span>
    </div>
  );
}

export function AvatarPicker(props: {
  value: string;
  options: AvatarChoice[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="avatar-grid">
      {props.options.map((option) => {
        const active = option.id === props.value;
        return (
          <button
            key={option.id}
            type="button"
            className={`avatar-choice ${active ? "active" : ""}`}
            aria-label={option.label}
            onClick={() => props.onChange(option.id)}
          >
            <img className="avatar-image" src={option.imageSrc} alt="" />
          </button>
        );
      })}
    </div>
  );
}

export function ParticipantBadge(props: { avatarId: string | null; label: string }) {
  const avatar = getAvatarChoice(props.avatarId);
  return (
    <div className="participant-badge">
      <img className="avatar-dot" src={avatar.imageSrc} alt="" />
      <span>{props.label}</span>
    </div>
  );
}
