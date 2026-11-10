import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAudioContext } from '../audio/context';
import {
  closeMic,
  listMics,
  MicError,
  micPrecheck,
  openMic,
  type MicErrorKind,
} from '../audio/mic';
import { usePrefs } from '../store/prefs';
import { Button, cx, Notice, Select } from './ui';

export interface MicState {
  stream: MediaStream | null;
  error: MicErrorKind | null;
  loading: boolean;
  devices: MediaDeviceInfo[];
  deviceId: string | null;
  setDeviceId(id: string): void;
  retry(): void;
}

/**
 * Микрофон на время жизни компонента: запрашивает доступ, переоткрывает поток при смене
 * устройства и освобождает его при размонтировании.
 */
export function useMic({ echoCancellation = false, enabled = true } = {}): MicState {
  const deviceId = usePrefs((s) => s.micDeviceId);
  const setDeviceId = usePrefs((s) => s.setMicDeviceId);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<MicErrorKind | null>(() => micPrecheck());
  const [loading, setLoading] = useState(enabled);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let opened: MediaStream | null = null;
    setLoading(true);
    openMic({ deviceId, echoCancellation })
      .then(async (s) => {
        if (cancelled) return closeMic(s);
        opened = s;
        setStream(s);
        setError(null);
        setDevices(await listMics());
      })
      .catch((err) => {
        if (cancelled) return;
        setStream(null);
        setError(err instanceof MicError ? err.kind : 'unknown');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      closeMic(opened);
      setStream(null);
    };
  }, [deviceId, echoCancellation, enabled, attempt]);

  // Подключили или вынули гарнитуру — обновляем список.
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.addEventListener) return;
    const onChange = () => void listMics().then(setDevices);
    media.addEventListener('devicechange', onChange);
    return () => media.removeEventListener('devicechange', onChange);
  }, []);

  return {
    stream,
    error,
    loading,
    devices,
    deviceId: stream?.getAudioTracks()[0]?.getSettings().deviceId ?? deviceId,
    setDeviceId,
    retry: () => setAttempt((n) => n + 1),
  };
}

/** Индикатор уровня микрофона. Обновляется напрямую через DOM, без перерисовок React. */
export function MicMeter({
  stream,
  className,
}: {
  stream: MediaStream | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stream) return;
    const ctx = getAudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let raf = 0;
    let shown = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      // Логарифмическая шкала: −50 дБ → 0, 0 дБ → 1.
      const level = peak > 0 ? Math.min(1, Math.max(0, 1 + (20 * Math.log10(peak)) / 50)) : 0;
      shown = level > shown ? level : shown * 0.9 + level * 0.1;
      if (bar.current) {
        bar.current.style.transform = `scaleX(${shown.toFixed(3)})`;
        bar.current.dataset.hot = shown > 0.92 ? '1' : '0';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
    };
  }, [stream]);

  return (
    <div
      role="img"
      aria-label={t('mic.level')}
      className={cx('h-3 overflow-hidden rounded-full bg-surface-2', className)}
    >
      <div
        ref={bar}
        data-testid="mic-level"
        className="h-full origin-left rounded-full bg-success transition-colors data-[hot=1]:bg-danger"
        style={{ transform: 'scaleX(0)' }}
      />
    </div>
  );
}

export function MicProblem({ kind, onRetry }: { kind: MicErrorKind; onRetry(): void }) {
  const { t } = useTranslation();
  return (
    <Notice tone="danger" role="alert" title={t(`mic.errors.${kind}.title`)}>
      <p>{t(`mic.errors.${kind}.text`)}</p>
      {kind !== 'insecure' && kind !== 'unsupported' && (
        <Button size="sm" className="mt-3" onClick={onRetry}>
          {t('mic.retry')}
        </Button>
      )}
    </Notice>
  );
}

/** Выбор устройства ввода и индикатор уровня. */
export function MicSetup({ mic, compact = false }: { mic: MicState; compact?: boolean }) {
  const { t } = useTranslation();
  const selectId = useId();

  if (mic.error) return <MicProblem kind={mic.error} onRetry={mic.retry} />;

  return (
    <div className={cx('flex gap-3', compact ? 'flex-row items-center' : 'flex-col')}>
      <div className={cx('flex flex-col gap-1.5', compact && 'min-w-0 flex-1')}>
        <label htmlFor={selectId} className={cx('text-sm font-medium', compact && 'sr-only')}>
          {t('mic.device')}
        </label>
        <Select
          id={selectId}
          value={mic.deviceId ?? ''}
          disabled={mic.loading || mic.devices.length === 0}
          onChange={(e) => mic.setDeviceId(e.target.value)}
          className={cx(compact && 'min-h-9 text-sm')}
        >
          {mic.devices.length === 0 && <option value="">{t('mic.requesting')}</option>}
          {mic.devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('mic.unnamed', { n: i + 1 })}
            </option>
          ))}
        </Select>
      </div>
      <div className={cx(compact ? 'w-24 shrink-0 sm:w-40' : 'w-full')}>
        {!compact && <p className="mb-1.5 text-sm font-medium">{t('mic.level')}</p>}
        <MicMeter stream={mic.stream} />
        {!compact && <p className="mt-1.5 text-sm text-muted">{t('mic.levelHint')}</p>}
      </div>
    </div>
  );
}
