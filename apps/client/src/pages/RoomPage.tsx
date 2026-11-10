import { nicknameSchema, roomCodeSchema, type RoomState } from '@dubparty/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { unlockAudio } from '../audio/sfx';
import { Page } from '../components/Layout';
import { ProfileEditor } from '../components/ProfileEditor';
import { Button, Card, Notice, Spinner } from '../components/ui';
import { useErrorText } from '../lib/hooks';
import { ApiErr } from '../net/socket';
import { Lobby } from '../phases/Lobby';
import { usePrefs } from '../store/prefs';
import { useRoom, type ClosedReason } from '../store/room';
import { toast } from '../store/toasts';

function JoinForm({ code }: { code: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const prefs = usePrefs();
  const join = useRoom((s) => s.join);
  const [busy, setBusy] = useState(false);
  const [nickError, setNickError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    unlockAudio();
    const nickname = nicknameSchema.safeParse(prefs.nickname);
    if (!nickname.success) {
      setNickError(t('profile.nicknameRequired'));
      return;
    }
    setBusy(true);
    setFatal(null);
    try {
      await join(code, { nickname: nickname.data, avatar: prefs.avatar, color: prefs.color });
    } catch (err) {
      const code = err instanceof ApiErr ? err.code : null;
      if (code === 'ROOM_NOT_FOUND' || code === 'GAME_IN_PROGRESS' || code === 'ROOM_FULL') {
        setFatal(errorText(err));
      } else {
        toast.error(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="form" onSubmit={onSubmit} className="mx-auto mt-6 max-w-lg animate-rise">
      <h1 className="text-2xl font-bold">{t('join.title', { code })}</h1>
      <p className="mt-1 mb-5 text-muted">{t('join.text')}</p>
      <ProfileEditor
        value={{ nickname: prefs.nickname, avatar: prefs.avatar, color: prefs.color }}
        error={nickError}
        autoFocus
        onChange={(next) => {
          prefs.setProfile(next);
          setNickError(null);
        }}
      />
      {fatal && (
        <div className="mt-4">
          <Notice tone="danger" role="alert">
            {fatal}
          </Notice>
        </div>
      )}
      <Button type="submit" variant="primary" size="lg" block className="mt-6" loading={busy}>
        {t('join.submit')}
      </Button>
      <Link to="/" className="mt-4 block text-center text-sm font-medium text-muted underline">
        {t('common.toHome')}
      </Link>
    </Card>
  );
}

function ClosedScreen({ reason, onReturn }: { reason: ClosedReason; onReturn(): void }) {
  const { t } = useTranslation();
  return (
    <Card className="mx-auto mt-10 max-w-md animate-pop text-center">
      <p className="text-5xl" aria-hidden="true">
        {reason === 'kicked' ? '🚪' : reason === 'replaced' ? '🪟' : '⌛'}
      </p>
      <h1 className="mt-3 text-2xl font-bold" role="alert">
        {t(`closed.${reason}.title`)}
      </h1>
      <p className="mt-2 text-pretty text-muted">{t(`closed.${reason}.text`)}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {reason === 'replaced' && (
          <Button variant="primary" onClick={onReturn}>
            {t('closed.returnHere')}
          </Button>
        )}
        <Link to="/">
          <Button variant={reason === 'replaced' ? 'secondary' : 'primary'}>
            {t('common.toHome')}
          </Button>
        </Link>
      </div>
    </Card>
  );
}

export function ConnectionBanner() {
  const { t } = useTranslation();
  const status = useRoom((s) => s.status);
  if (status !== 'reconnecting') return null;
  return (
    <div
      role="status"
      className="sticky top-2 z-40 mx-auto mb-3 flex w-fit items-center gap-2 rounded-full border border-warn/40 bg-warn-soft px-4 py-2 text-sm font-semibold shadow-lg"
    >
      <Spinner /> {t('room.reconnecting')}
    </div>
  );
}

function RoomView({ state }: { state: RoomState }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const leave = useRoom((s) => s.leave);
  return (
    <>
      <ConnectionBanner />
      {state.phase === 'lobby' && (
        <Lobby
          state={state}
          footer={
            <div className="flex justify-center">
              <Button
                variant="ghost"
                onClick={() => {
                  void leave().then(() => navigate('/'));
                }}
              >
                {t('room.leave')}
              </Button>
            </div>
          }
        />
      )}
    </>
  );
}

export function RoomPage() {
  const { t } = useTranslation();
  const params = useParams();
  const parsed = roomCodeSchema.safeParse(params.code ?? '');
  const code = parsed.success ? parsed.data : null;
  const state = useRoom((s) => s.state);
  const closedReason = useRoom((s) => s.closedReason);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!code) return;
    const store = useRoom.getState();
    if (store.state?.code === code) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    store
      .resume(code)
      .catch(() => false)
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (code) document.title = `DubParty`;
  }, [code]);

  if (!code) {
    return (
      <Page width="sm">
        <Card className="mt-10 text-center">
          <h1 className="text-2xl font-bold">{t('join.badCode')}</h1>
          <Link to="/" className="mt-4 inline-block font-semibold text-accent underline">
            {t('common.toHome')}
          </Link>
        </Card>
      </Page>
    );
  }

  const inRoom = state?.code === code;
  return (
    <Page width={inRoom ? 'xl' : 'md'} compactHeader>
      {inRoom ? (
        <RoomView state={state} />
      ) : closedReason ? (
        <ClosedScreen
          reason={closedReason}
          onReturn={() => {
            setChecking(true);
            void useRoom
              .getState()
              .resume(code)
              .catch(() => false)
              .finally(() => setChecking(false));
          }}
        />
      ) : checking ? (
        <div className="mt-20 flex justify-center text-muted" role="status">
          <Spinner className="size-8" />
          <span className="sr-only">{t('common.loading')}</span>
        </div>
      ) : (
        <JoinForm code={code} />
      )}
    </Page>
  );
}
