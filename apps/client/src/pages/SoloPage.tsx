import type { ClipPublic, EditorClip, PackDetail } from '@dubparty/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type { RecorderBackend } from '../audio/recorder';
import { unlockAudio } from '../audio/sfx';
import { Page } from '../components/Layout';
import { Studio } from '../components/Studio';
import { Button, Card, cx, Notice, Spinner, Toggle } from '../components/ui';
import { fetchPack } from '../net/api';

function toClip(clip: EditorClip, withLines: boolean): ClipPublic {
  return {
    id: clip.id,
    title: clip.title,
    videoUrl: clip.videoUrl,
    posterUrl: clip.posterUrl,
    hasMusic: clip.hasMusic,
    durationMs: clip.durationMs,
    characters: clip.characters,
    lines: withLines ? clip.lines : [],
  };
}

/** Тренировка в одиночку: тот же экран записи, что и в игре, но без комнаты и отправки. */
export function SoloPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const packId = params.get('pack') ?? 'demo';
  const clipId = params.get('clip');
  const backend = params.get('backend');
  const forceBackend: RecorderBackend | undefined =
    backend === 'wav' || backend === 'media' ? backend : undefined;
  const [pack, setPack] = useState<PackDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [withLines, setWithLines] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchPack(packId)
      .then((p) => !cancelled && setPack(p))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [packId]);

  const clip = pack?.clips.find((c) => c.id === clipId) ?? null;

  return (
    <Page width="xl">
      <h1 className="mt-2 text-3xl font-black">{t('solo.title')}</h1>
      <p className="mt-1 mb-5 text-muted">{t('solo.text')}</p>

      {failed && <Notice tone="danger">{t('solo.loadFailed')}</Notice>}
      {!pack && !failed && (
        <div className="flex justify-center py-10" role="status">
          <Spinner className="size-8" />
        </div>
      )}

      {pack && !clip && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {pack.clips.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  unlockAudio();
                  setParams({ pack: packId, clip: c.id, ...(backend ? { backend } : {}) });
                }}
                className="group w-full overflow-hidden rounded-3xl border border-border bg-surface text-left shadow-sm transition-transform hover:-translate-y-0.5"
              >
                <img
                  src={c.posterUrl}
                  alt=""
                  className="aspect-video w-full object-cover"
                  loading="lazy"
                />
                <span className="block p-3">
                  <span className="block font-bold group-hover:text-accent">{c.title}</span>
                  <span className="block text-sm text-muted">
                    {t('solo.clipMeta', {
                      seconds: Math.round(c.durationMs / 1000),
                      count: c.characters.length,
                    })}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {pack && clip && (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-wrap items-center justify-between gap-3 !p-3">
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={() => setParams({ pack: packId, ...(backend ? { backend } : {}) })}
              >
                ← {t('solo.otherClip')}
              </Button>
              <h2 className="text-lg font-bold">{clip.title}</h2>
            </div>
            <div className={cx('w-full sm:w-72')}>
              <Toggle label={t('solo.showLines')} checked={withLines} onChange={setWithLines} />
            </div>
          </Card>
          <Studio
            key={`${clip.id}:${withLines}`}
            clip={toClip(clip, withLines)}
            mine={null}
            effectsEnabled
            forceBackend={forceBackend}
          />
        </div>
      )}
    </Page>
  );
}
