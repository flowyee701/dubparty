import { MODES } from '@dubparty/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Card } from '../components/ui';

const STEP_ICONS = ['🚪', '🎬', '🎙', '🍿', '🏆'];
const MODE_ICONS = { parallel: '🎤', roles: '🎭', free: '🌀' } as const;

/** Содержимое «Как играть» — используется и на отдельной странице, и в онбординге. */
export function HowToPlay() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col gap-3">
        {STEP_ICONS.map((icon, i) => (
          <li key={i} className="flex gap-3">
            <span
              aria-hidden="true"
              className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-2xl"
            >
              {icon}
            </span>
            <div>
              <p className="font-bold">{t(`how.steps.${i}.title`)}</p>
              <p className="text-pretty text-muted">{t(`how.steps.${i}.text`)}</p>
            </div>
          </li>
        ))}
      </ol>
      <section aria-labelledby="how-modes">
        <h2 id="how-modes" className="mb-2 text-lg font-bold">
          {t('how.modesTitle')}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-3">
          {MODES.map((mode) => (
            <li key={mode} className="rounded-2xl border border-border bg-surface-2 p-3">
              <p className="font-bold">
                <span aria-hidden="true">{MODE_ICONS[mode]}</span> {t(`modes.${mode}.name`)}
              </p>
              <p className="mt-1 text-sm text-muted">{t(`modes.${mode}.description`)}</p>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="how-tips">
        <h2 id="how-tips" className="mb-2 text-lg font-bold">
          {t('how.tipsTitle')}
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          {[0, 1, 2, 3].map((i) => (
            <li key={i}>{t(`how.tips.${i}`)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function HowToPlayPage() {
  const { t } = useTranslation();
  return (
    <Page width="md">
      <Card className="mt-4">
        <h1 className="mb-5 text-3xl font-black">{t('how.title')}</h1>
        <HowToPlay />
        <div className="mt-6 flex flex-wrap gap-4 font-semibold">
          <Link to="/" className="text-accent underline">
            {t('how.cta')}
          </Link>
          <Link to="/mic" className="text-muted underline">
            {t('home.linkMic')}
          </Link>
        </div>
      </Card>
    </Page>
  );
}
