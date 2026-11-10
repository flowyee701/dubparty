import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { resumeAudio } from '../audio/context';
import { createRecorder, type TakeRecorder } from '../audio/recorder';
import { Page } from '../components/Layout';
import { MicSetup, useMic } from '../components/MicSetup';
import { Button, Card, Notice } from '../components/ui';
import { usePrefs } from '../store/prefs';

const SAMPLE_MS = 4000;

/** Проверка микрофона: выбор устройства, уровень и короткая пробная запись. */
export function MicCheck({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation();
  const mic = useMic();
  const recorder = useRef<TakeRecorder | null>(null);
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle');
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);

  useEffect(
    () => () => {
      recorder.current?.cancel();
      if (sampleUrl) URL.revokeObjectURL(sampleUrl);
    },
    [sampleUrl],
  );

  async function recordSample() {
    if (!mic.stream) return;
    const ctx = await resumeAudio();
    const rec = await createRecorder(mic.stream, ctx);
    recorder.current = rec;
    setState('recording');
    await rec.start();
    window.setTimeout(() => {
      if (recorder.current !== rec) return;
      void rec.stop().then((blob) => {
        recorder.current = null;
        setSampleUrl(URL.createObjectURL(blob));
        setState('done');
      });
    }, SAMPLE_MS);
  }

  return (
    <div className="flex flex-col gap-4">
      <MicSetup mic={mic} />
      {!mic.error && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void recordSample()}
              disabled={!mic.stream || state === 'recording'}
              loading={state === 'recording'}
            >
              {state === 'recording' ? t('mic.sampleRecording') : t('mic.sampleRecord')}
            </Button>
            {sampleUrl && state === 'done' && (
              <audio
                controls
                src={sampleUrl}
                className="h-10 max-w-full"
                aria-label={t('mic.sample')}
              />
            )}
          </div>
          <Notice tone="info">{t('mic.tips')}</Notice>
        </>
      )}
      {onDone && (
        <Button variant="primary" size="lg" onClick={onDone}>
          {mic.error ? t('mic.continueAnyway') : t('mic.allGood')}
        </Button>
      )}
    </div>
  );
}

export function MicCheckPage() {
  const { t } = useTranslation();
  const setOnboarded = usePrefs((s) => s.setOnboarded);
  return (
    <Page width="sm">
      <Card className="mt-4">
        <h1 className="mb-1 text-2xl font-bold">{t('mic.title')}</h1>
        <p className="mb-5 text-muted">{t('mic.text')}</p>
        <MicCheck />
        <div className="mt-5 flex justify-between text-sm font-medium">
          <Link to="/" className="text-muted underline" onClick={() => setOnboarded(true)}>
            {t('common.toHome')}
          </Link>
          <Link to="/solo" className="text-accent underline">
            {t('home.linkSolo')} →
          </Link>
        </div>
      </Card>
    </Page>
  );
}
