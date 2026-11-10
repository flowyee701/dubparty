import type { ClipPublic, EffectId, TakeStatus } from '@dubparty/shared';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecorderBackend } from '../audio/recorder';
import { playSfx } from '../audio/sfx';
import { TakePreview, TakeSession, type Take } from '../audio/takeSession';
import { formatClock, useErrorText, useLatest, useRemainingMs } from '../lib/hooks';
import { toast } from '../store/toasts';
import { EffectPicker } from './EffectPicker';
import { MicSetup, useMic } from './MicSetup';
import { LineOverlay, Subtitles } from './Subtitles';
import { Badge, Button, cx, Notice } from './ui';

type Phase = 'idle' | 'countdown' | 'recording' | 'review';

declare global {
  interface Window {
    /** Отладочная информация о последнем дубле — её читают e2e-тесты синхронизации. */
    __dubparty?: {
      lastTake?: Take | null;
      /** Состояние синхронного просмотра: отклонение от времени сервера. */
      sync?: { driftMs: number; entryId: string | null; playing: boolean };
    };
  }
}

function VideoProgress({ video }: { video: RefObject<HTMLVideoElement | null> }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = video.current;
      if (el && bar.current && el.duration > 0) {
        bar.current.style.transform = `scaleX(${Math.min(1, el.currentTime / el.duration)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video]);
  return (
    <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/20" aria-hidden="true">
      <div ref={bar} className="h-full origin-left bg-accent" style={{ transform: 'scaleX(0)' }} />
    </div>
  );
}

export interface StudioProps {
  clip: ClipPublic;
  /** Персонажи игрока в режиме ролей; null — озвучивает клип целиком. */
  mine: string[] | null;
  effectsEnabled: boolean;
  /** В игре: отправка дубля на сервер. В тренировке не задаётся. */
  onSubmit?: (take: Take, effect: EffectId) => Promise<void>;
  /** Время сервера, когда запись закончится. */
  deadline?: number | null;
  /** Что сервер знает о дубле игрока. */
  serverStatus?: TakeStatus;
  forceBackend?: RecorderBackend;
}

const COUNTDOWN_STEP_MS = 750;

/**
 * Студия записи: клип, подсказки, отсчёт 3-2-1, запись синхронно с видео,
 * предпрослушивание с эффектом и отправка.
 */
export function Studio({
  clip,
  mine,
  effectsEnabled,
  onSubmit,
  deadline = null,
  serverStatus = 'none',
  forceBackend,
}: StudioProps) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<TakeSession | null>(null);
  const preview = useRef<TakePreview | null>(null);
  const countdownTimer = useRef(0);

  // Музыка клипа звучит из колонок — без подавления эха она попадёт в запись.
  const mic = useMic({ echoCancellation: clip.hasMusic });
  const [phase, setPhase] = useState<Phase>('idle');
  const [count, setCount] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [sentTake, setSentTake] = useState<Take | null>(null);
  const [effect, setEffect] = useState<EffectId>('none');
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);

  const remaining = useRemainingMs(deadline);
  const timeUp = remaining !== null && remaining <= 0;
  const sent = !!take && take === sentTake;

  const stopPreview = useCallback(() => {
    preview.current?.stop();
    preview.current = null;
    setPreviewing(false);
  }, []);

  const finish = useCallback(async (): Promise<Take | null> => {
    const current = session.current;
    if (!current?.recording) return null;
    try {
      const recorded = await current.stop();
      session.current = null;
      window.__dubparty = { ...window.__dubparty, lastTake: recorded };
      if (recorded.blob.size < 1000) {
        toast.error(t('studio.tooShort'));
        setPhase('idle');
        return null;
      }
      setTake(recorded);
      setPhase('review');
      return recorded;
    } catch {
      session.current = null;
      setPhase('idle');
      toast.error(t('studio.recordFailed'));
      return null;
    }
  }, [t]);

  const cancel = useCallback(() => {
    window.clearTimeout(countdownTimer.current);
    session.current?.cancel();
    session.current = null;
    setPhase((p) => (p === 'countdown' || p === 'recording' ? 'idle' : p));
  }, []);

  async function start() {
    const el = video.current;
    if (!el || !mic.stream || busy) return;
    stopPreview();
    setBusy(true);
    try {
      const next = new TakeSession(el, mic.stream, forceBackend);
      session.current = next;
      await next.prepare();
      if (session.current !== next) return;
      setTake(null);
      setPhase('countdown');

      const step = (n: number) => {
        if (session.current !== next) return;
        if (n > 0) {
          setCount(n);
          playSfx('tick');
          countdownTimer.current = window.setTimeout(() => step(n - 1), COUNTDOWN_STEP_MS);
          return;
        }
        setPhase('recording');
        next.start().catch(() => {
          if (session.current === next) session.current = null;
          setPhase('idle');
          toast.error(t('studio.recordFailed'));
        });
      };
      step(3);
    } catch {
      session.current = null;
      setPhase('idle');
      toast.error(t('studio.videoFailed'));
    } finally {
      setBusy(false);
    }
  }

  const submit = useCallback(
    async (target: Take, withEffect: EffectId) => {
      if (!onSubmit) return;
      setSubmitting(true);
      try {
        await onSubmit(target, withEffect);
        setSentTake(target);
        playSfx('success');
      } catch (err) {
        toast.error(errorText(err));
      } finally {
        setSubmitting(false);
      }
    },
    [onSubmit, errorText],
  );

  async function togglePreview(nextEffect = effect) {
    const el = video.current;
    if (!el || !take) return;
    if (previewing && nextEffect === effect) {
      stopPreview();
      return;
    }
    stopPreview();
    const player = new TakePreview(el, take);
    preview.current = player;
    setPreviewing(true);
    try {
      await player.play(nextEffect, () => setPreviewing(false));
    } catch {
      stopPreview();
      toast.error(t('studio.previewFailed'));
    }
  }

  // Клип доиграл — запись закончена.
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const onEnded = () => void finish();
    el.addEventListener('ended', onEnded);
    return () => el.removeEventListener('ended', onEnded);
  }, [finish]);

  // Время вышло: останавливаем запись и отправляем то, что есть.
  const latest = useLatest({ phase, take, sent, effect, submitting });
  useEffect(() => {
    if (!timeUp || !onSubmit) return;
    const now = latest.current;
    if (now.phase === 'countdown') cancel();
    else if (now.phase === 'recording') {
      void finish().then((recorded) => recorded && submit(recorded, latest.current.effect));
    } else if (now.phase === 'review' && now.take && !now.sent && !now.submitting) {
      stopPreview();
      void submit(now.take, now.effect);
    }
  }, [timeUp, onSubmit, cancel, finish, submit, stopPreview, latest]);

  useEffect(
    () => () => {
      window.clearTimeout(countdownTimer.current);
      session.current?.cancel();
      preview.current?.stop();
    },
    [],
  );

  const canRecord = !!mic.stream && !timeUp;
  const hasServerTake = serverStatus === 'ready';

  return (
    // На телефоне порядок: клип с кнопками → реплики → микрофон; на широком экране реплики справа.
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <div className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-1">
        <div className="relative aspect-video overflow-hidden rounded-3xl bg-black shadow-lg">
          <video
            ref={video}
            src={clip.videoUrl}
            poster={clip.posterUrl}
            // Оригинальной речи в клипе нет; звук включён только у клипов с музыкой.
            muted={!clip.hasMusic}
            playsInline
            preload="auto"
            disablePictureInPicture
            className="size-full object-contain"
            aria-label={t('studio.clip', { title: clip.title })}
          />
          {phase === 'countdown' && (
            <div
              className="absolute inset-0 grid place-items-center bg-black/55"
              aria-live="assertive"
            >
              <span
                key={count}
                className="animate-count text-8xl font-black text-white tabular-nums"
              >
                {count}
              </span>
            </div>
          )}
          {phase === 'recording' && (
            <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-sm font-bold text-white">
              <span
                className="size-3 animate-pulse-ring rounded-full bg-red-500"
                aria-hidden="true"
              />
              {t('studio.recording')}
            </div>
          )}
          {remaining !== null && (
            <div
              className={cx(
                'absolute top-3 right-3 rounded-full px-3 py-1.5 text-sm font-bold tabular-nums',
                remaining < 15_000 ? 'bg-danger text-white' : 'bg-black/70 text-white',
              )}
              role="timer"
              aria-label={t('studio.timeLeft')}
            >
              ⏱ {formatClock(remaining)}
            </div>
          )}
          {(phase === 'recording' || previewing) && (
            <LineOverlay
              video={video}
              lines={clip.lines}
              characters={clip.characters}
              mine={mine}
            />
          )}
          <VideoProgress video={video} />
        </div>

        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t('studio.controls')}
        >
          {(phase === 'idle' || phase === 'review') && (
            <Button
              variant={phase === 'idle' ? 'primary' : 'secondary'}
              size="lg"
              disabled={!canRecord || submitting}
              loading={busy}
              onClick={() => void start()}
            >
              <span aria-hidden="true">●</span>
              {phase === 'idle' && !hasServerTake ? t('studio.record') : t('studio.rerecord')}
            </Button>
          )}
          {(phase === 'countdown' || phase === 'recording') && (
            <Button
              variant="danger"
              size="lg"
              onClick={() => (phase === 'recording' ? void finish() : cancel())}
            >
              <span aria-hidden="true">■</span>
              {phase === 'recording' ? t('studio.stop') : t('common.cancel')}
            </Button>
          )}
          {phase === 'review' && take && (
            <>
              <Button
                size="lg"
                disabled={!take.buffer || submitting}
                onClick={() => void togglePreview()}
              >
                <span aria-hidden="true">{previewing ? '■' : '▶'}</span>
                {previewing ? t('studio.stopPreview') : t('studio.preview')}
              </Button>
              {onSubmit && (
                <Button
                  variant="primary"
                  size="lg"
                  disabled={sent}
                  loading={submitting}
                  onClick={() => {
                    stopPreview();
                    void submit(take, effect);
                  }}
                >
                  {sent ? `✓ ${t('studio.sent')}` : t('studio.submit')}
                </Button>
              )}
            </>
          )}
        </div>

        <div aria-live="polite" className="empty:hidden">
          {onSubmit && sent && <Badge tone="success">{t('studio.sentHint')}</Badge>}
          {onSubmit && !sent && hasServerTake && phase === 'review' && (
            <Badge tone="warn">{t('studio.unsentHint')}</Badge>
          )}
          {onSubmit && serverStatus === 'failed' && !take && (
            <Badge tone="danger">{t('studio.serverFailed')}</Badge>
          )}
        </div>

        {phase === 'review' && take && effectsEnabled && (
          <EffectPicker
            value={effect}
            disabled={submitting}
            onChange={(next) => {
              setEffect(next);
              // Выбранный эффект уже отправлен не был — снимаем отметку «отправлено».
              if (sent) setSentTake(null);
              if (take.buffer) void togglePreview(next);
            }}
          />
        )}
      </div>

      <Subtitles
        video={video}
        lines={clip.lines}
        characters={clip.characters}
        mine={mine}
        className="max-h-[38dvh] lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[70dvh]"
      />

      <div className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-2">
        <div className="rounded-2xl border border-border bg-surface p-3">
          <MicSetup mic={mic} compact />
        </div>
        {clip.hasMusic && !mic.error && <Notice tone="info">{t('studio.headphones')}</Notice>}
      </div>
    </div>
  );
}
