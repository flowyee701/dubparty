import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Card } from '../components/ui';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Page width="sm">
      <Card className="mt-10 text-center">
        <p className="text-5xl" aria-hidden="true">
          🙈
        </p>
        <h1 className="mt-3 text-2xl font-bold">{t('notFound.title')}</h1>
        <p className="mt-2 text-muted">{t('notFound.text')}</p>
        <Link to="/" className="mt-5 inline-block font-semibold text-accent underline">
          {t('common.toHome')}
        </Link>
      </Card>
    </Page>
  );
}
