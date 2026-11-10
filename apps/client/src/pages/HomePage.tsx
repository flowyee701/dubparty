import { nicknameSchema, ROOM_CODE_LENGTH, roomCodeSchema } from '@dubparty/shared';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { unlockAudio } from '../audio/sfx';
import { Page } from '../components/Layout';
import { ProfileEditor } from '../components/ProfileEditor';
import { Button, Card, Field, TextInput } from '../components/ui';
import { useErrorText } from '../lib/hooks';
import { usePrefs } from '../store/prefs';
import { useRoom } from '../store/room';
import { toast } from '../store/toasts';

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const prefs = usePrefs();
  const createRoom = useRoom((s) => s.create);
  const [code, setCode] = useState('');
  const [nickError, setNickError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  const profile = { nickname: prefs.nickname, avatar: prefs.avatar, color: prefs.color };

  function validNickname(): string | null {
    const parsed = nicknameSchema.safeParse(prefs.nickname);
    if (!parsed.success) {
      toast.error(t('profile.nicknameRequired'));
      setNickError(t('profile.nicknameRequired'));
      return null;
    }
    setNickError(null);
    return parsed.data;
  }

  async function onCreate() {
    unlockAudio();
    const nickname = validNickname();
    if (!nickname) return;
    setBusy('create');
    try {
      const roomCode = await createRoom({ ...profile, nickname });
      navigate(`/r/${roomCode}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  function onJoin(e: FormEvent) {
    e.preventDefault();
    unlockAudio();
    const parsed = roomCodeSchema.safeParse(code);
    if (!parsed.success) {
      setCodeError(t('home.codeInvalid', { count: ROOM_CODE_LENGTH }));
      return;
    }
    setCodeError(null);
    // Ник и вход — уже на странице комнаты: там же обработается «комната не найдена».
    navigate(`/r/${parsed.data}`);
  }

  return (
    <Page width="lg">
      <section className="pt-4 text-center sm:pt-10">
        <h1 className="animate-rise text-4xl font-black tracking-tight text-balance sm:text-6xl">
          {t('home.title')}
        </h1>
        <p className="mx-auto mt-4 max-w-xl animate-rise text-lg text-pretty text-muted">
          {t('home.tagline')}
        </p>
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card as="section" aria-labelledby="create-title">
          <h2 id="create-title" className="mb-4 text-xl font-bold">
            {t('home.yourProfile')}
          </h2>
          <ProfileEditor
            value={profile}
            error={nickError}
            onChange={(next) => {
              prefs.setProfile(next);
              if (nickError) setNickError(null);
            }}
          />
          <Button
            variant="primary"
            size="lg"
            block
            className="mt-6"
            loading={busy === 'create'}
            onClick={() => void onCreate()}
          >
            {t('home.createRoom')}
          </Button>
        </Card>

        <div className="flex flex-col gap-4">
          <Card as="form" onSubmit={onJoin} aria-labelledby="join-title">
            <h2 id="join-title" className="mb-4 text-xl font-bold">
              {t('home.joinTitle')}
            </h2>
            <Field label={t('home.codeLabel')} error={codeError} hint={t('home.codeHint')}>
              {(props) => (
                <TextInput
                  {...props}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                  maxLength={ROOM_CODE_LENGTH}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ABCD"
                  className="text-center font-mono text-2xl font-black tracking-[0.4em] uppercase"
                />
              )}
            </Field>
            <Button type="submit" size="lg" block className="mt-4">
              {t('home.join')}
            </Button>
          </Card>

          <Card as="section" aria-labelledby="more-title">
            <h2 id="more-title" className="mb-3 text-xl font-bold">
              {t('home.moreTitle')}
            </h2>
            <ul className="flex flex-col gap-1 text-base">
              {(
                [
                  ['/how', '📖', 'home.linkHow'],
                  ['/mic', '🎙', 'home.linkMic'],
                  ['/solo', '🎬', 'home.linkSolo'],
                  ['/packs', '🧩', 'home.linkPacks'],
                ] as const
              ).map(([to, icon, key]) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium hover:bg-surface-2"
                  >
                    <span aria-hidden="true" className="text-xl">
                      {icon}
                    </span>
                    {t(key)}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}
