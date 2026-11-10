import { useTranslation } from 'react-i18next';
import { Page } from '../components/Layout';

export function HomePage() {
  const { t } = useTranslation();
  return (
    <Page width="md">
      <section className="pt-6 text-center sm:pt-12">
        <h1 className="text-4xl font-black tracking-tight text-balance sm:text-6xl">
          {t('home.title')}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-pretty text-muted">{t('home.tagline')}</p>
      </section>
    </Page>
  );
}
