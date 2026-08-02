/**
 * 画面をまたいで使う小さな部品。
 *
 * 10.1 の原則に合わせ、状態は色だけでなく必ず文言でも示す。
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function Spinner({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="row" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Notice({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'error';
  title?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={tone === 'error' ? 'notice notice--error' : 'notice'}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {title !== undefined && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  // 条件によって渡したり渡さなかったりするため、undefined を明示的に許す。
  hint?: string | undefined;
  autoComplete?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onEnter?: () => void;
}

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  autoComplete,
  placeholder,
  disabled,
  required,
  inputRef,
  onEnter,
}: TextFieldProps): React.JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint !== undefined && (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input
          id={id}
          ref={inputRef}
          className="input"
          type={isPassword && !revealed ? 'password' : 'text'}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          required={required}
          aria-describedby={hint !== undefined ? hintId : undefined}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onEnter) {
              event.preventDefault();
              onEnter();
            }
          }}
        />
        {isPassword && (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              setRevealed((current) => !current);
            }}
            aria-pressed={revealed}
          >
            {revealed ? '隠す' : '表示'}
          </button>
        )}
      </div>
    </div>
  );
}

/** 破壊的な操作の前に必ず挟む確認（10.1）。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      dialogRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-4)',
        zIndex: 10,
      }}
    >
      <div
        className="card"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={dialogRef}
        style={{ maxWidth: '28rem', width: '100%' }}
      >
        <div className="stack">
          <h2>{title}</h2>
          <p className="muted">{description}</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="button" onClick={onCancel}>
              やめる
            </button>
            <button type="button" className="button button--danger" onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** バイト数を人が読める形にする（FR-DASH-001）。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 端末のローカル時刻で日本語表記にする（NFR-007）。 */
export function formatDateTime(value: string | number): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '不明';
  }
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '不明';
  }
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}
