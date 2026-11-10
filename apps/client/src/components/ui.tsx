import type { Avatar } from '@dubparty/shared';
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
} from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm shadow-accent/30 disabled:shadow-none',
  secondary: 'bg-surface-2 text-text hover:bg-border border border-border',
  ghost: 'bg-transparent text-text hover:bg-surface-2',
  danger: 'bg-danger-soft text-danger hover:brightness-95 border border-danger/30',
};
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-sm gap-1.5 rounded-lg',
  md: 'min-h-11 px-4 text-base gap-2 rounded-xl',
  lg: 'min-h-14 px-6 text-lg gap-2.5 rounded-2xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  block = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center font-semibold transition-[background-color,transform,filter] duration-150 select-none active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
    />
  );
}

export function Card({
  children,
  className,
  as: Tag = 'div',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'form';
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cx('rounded-3xl border border-border bg-surface p-4 shadow-sm sm:p-6', className)}
      {...(rest as object)}
    >
      {children}
    </Tag>
  );
}

const INPUT_CLASS =
  'w-full min-h-11 rounded-xl border border-border bg-bg px-3 text-base text-text placeholder:text-muted/70 disabled:opacity-60';

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  className,
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cx(INPUT_CLASS, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(INPUT_CLASS, 'pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange(value: boolean): void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <span id={id} className="block text-sm font-medium">
          {label}
        </span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-50',
          checked ? 'border-accent bg-accent' : 'border-border bg-surface-2',
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            'absolute top-0.5 left-0.5 size-5.5 rounded-full shadow transition-transform',
            checked ? 'translate-x-5 bg-accent-fg' : 'bg-muted',
          )}
        />
      </button>
    </div>
  );
}

export const AVATAR_EMOJI: Record<Avatar, string> = {
  fox: '🦊',
  cat: '🐱',
  dog: '🐶',
  owl: '🦉',
  frog: '🐸',
  bear: '🐻',
  robot: '🤖',
  alien: '👽',
  ghost: '👻',
  unicorn: '🦄',
  panda: '🐼',
  octopus: '🐙',
};

const AVATAR_SIZES = {
  sm: 'size-8 text-lg',
  md: 'size-11 text-2xl',
  lg: 'size-16 text-4xl',
  xl: 'size-24 text-6xl',
};

export function AvatarBubble({
  avatar,
  color,
  size = 'md',
  dim = false,
  className,
}: {
  avatar: Avatar;
  color: string;
  size?: keyof typeof AVATAR_SIZES;
  dim?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full leading-none ring-2 ring-surface transition-opacity',
        AVATAR_SIZES[size],
        dim && 'opacity-40 grayscale',
        className,
      )}
      style={{ backgroundColor: color }}
    >
      {AVATAR_EMOJI[avatar]}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-surface-2 text-muted',
    accent: 'bg-accent-soft text-accent',
    success: 'bg-success-soft text-success',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
  role,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'success';
  title?: string;
  children?: ReactNode;
  role?: 'alert' | 'status';
}) {
  const tones = {
    info: 'border-border bg-surface-2 text-text',
    warn: 'border-warn/40 bg-warn-soft text-text',
    danger: 'border-danger/40 bg-danger-soft text-text',
    success: 'border-success/40 bg-success-soft text-text',
  };
  return (
    <div role={role} className={cx('rounded-2xl border p-3 text-sm sm:p-4', tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cx(title && 'mt-1', 'text-pretty')}>{children}</div>}
    </div>
  );
}

/** Модальное окно на нативном <dialog>: фокус-ловушка и Esc работают из коробки. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-3xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-pop"
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            <h2 id={titleId} className="text-lg font-bold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="✕"
              className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-200"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Чёрный или белый текст — какой лучше читается на данном фоне (по относительной яркости WCAG). */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  const n = parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(n)) return '#ffffff';
  const channel = (shift: number) => {
    const v = ((n >> shift) & 0xff) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  // Контраст с чёрным выше, чем с белым, когда яркость фона больше ~0.179.
  return luminance > 0.179 ? '#000000' : '#ffffff';
}
