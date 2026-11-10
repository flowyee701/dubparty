import { LIMITS, type PackSummary } from '@dubparty/shared';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Page } from '../components/Layout';
import {
  Badge,
  Button,
  Card,
  Field,
  Notice,
  ProgressBar,
  Spinner,
  TextInput,
} from '../components/ui';
import { useErrorText } from '../lib/hooks';
import { usePacks } from '../lib/packs';
import { packToken, savePackToken } from '../lib/packTokens';
import { createPack, exportUrl, importPack } from '../net/packsApi';
import { toast } from '../store/toasts';

function PackCard({ pack }: { pack: PackSummary }) {
  const { t } = useTranslation();
  const owned = !!packToken(pack.id);
  return (
    <li className="flex gap-3 rounded-3xl border border-border bg-surface p-3 shadow-sm">
      <div className="aspect-video w-32 shrink-0 overflow-hidden rounded-2xl bg-surface-2 sm:w-44">
        {pack.posterUrl && (
          <img src={pack.posterUrl} alt="" className="size-full object-cover" loading="lazy" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="truncate text-lg font-black">{pack.title}</h3>
        <div className="flex flex-wrap gap-1">
          <Badge>{t('lobby.clipCount', { count: pack.clipCount })}</Badge>
          {pack.builtin && <Badge tone="accent">{t('packs.builtin')}</Badge>}
          {owned && <Badge tone="success">{t('packs.yours')}</Badge>}
        </div>
        {pack.description && <p className="line-clamp-2 text-sm text-muted">{pack.description}</p>}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Link to={`/packs/${pack.id}`}>
            <Button size="sm" variant={owned ? 'primary' : 'secondary'}>
              {owned ? t('packs.edit') : t('packs.view')}
            </Button>
          </Link>
          {pack.clipCount > 0 && (
            <a href={exportUrl(pack.id)} download>
              <Button size="sm" variant="ghost">
                ⬇ {t('packs.export')}
              </Button>
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

export function PacksPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const { packs, loading } = usePacks();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importProgress, setImportProgress] = useState<number | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setTitleError(t('packs.titleRequired'));
      return;
    }
    setCreating(true);
    try {
      const { pack, ownerToken } = await createPack({ title });
      savePackToken(pack.id, ownerToken);
      navigate(`/packs/${pack.id}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    if (file.size > LIMITS.packZipMaxBytes) {
      toast.error(t('errors.TOO_LARGE'));
      return;
    }
    setImportProgress(0);
    try {
      const { pack, ownerToken } = await importPack(file, setImportProgress);
      savePackToken(pack.id, ownerToken);
      toast.success(t('packs.imported'));
      navigate(`/packs/${pack.id}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setImportProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <Page width="lg">
      <h1 className="mt-2 text-3xl font-black">{t('packs.title')}</h1>
      <p className="mt-1 mb-5 max-w-2xl text-pretty text-muted">{t('packs.text')}</p>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="packs-list">
          <h2 id="packs-list" className="sr-only">
            {t('packs.list')}
          </h2>
          {loading ? (
            <div className="flex justify-center py-10" role="status">
              <Spinner className="size-8" />
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {packs.map((pack) => (
                <PackCard key={pack.id} pack={pack} />
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-4">
          <Card as="form" onSubmit={onCreate}>
            <h2 className="mb-3 text-xl font-bold">{t('packs.createTitle')}</h2>
            <Field label={t('packs.packTitle')} error={titleError}>
              {(props) => (
                <TextInput
                  {...props}
                  value={title}
                  maxLength={LIMITS.titleMax}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setTitleError(null);
                  }}
                  placeholder={t('packs.packTitlePlaceholder')}
                />
              )}
            </Field>
            <Button type="submit" variant="primary" block className="mt-4" loading={creating}>
              {t('packs.create')}
            </Button>
          </Card>

          <Card>
            <h2 className="mb-1 text-xl font-bold">{t('packs.importTitle')}</h2>
            <p className="mb-3 text-sm text-muted">{t('packs.importText')}</p>
            <input
              ref={fileInput}
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              id="pack-import"
              aria-label={t('packs.import')}
              tabIndex={-1}
              onChange={(e) => void onImport(e.target.files?.[0])}
            />
            {importProgress === null ? (
              <Button block onClick={() => fileInput.current?.click()}>
                ⬆ {t('packs.import')}
              </Button>
            ) : (
              <div role="status">
                <ProgressBar value={importProgress} label={t('packs.importing')} />
                <p className="mt-2 text-sm text-muted">
                  {importProgress < 1 ? t('packs.importing') : t('packs.processing')}
                </p>
              </div>
            )}
          </Card>
          <Notice tone="info">{t('packs.ownershipNote')}</Notice>
        </div>
      </div>
    </Page>
  );
}
