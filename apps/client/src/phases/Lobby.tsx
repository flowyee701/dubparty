import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  MODES,
  nicknameSchema,
  PLAYER_COLORS,
  RECORD_SECONDS_MAX,
  RECORD_SECONDS_MIN,
  ROUNDS_MAX,
  ROUNDS_MIN,
  type GameMode,
  type PlayerColor,
  type PublicPlayer,
  type RoomState,
  type Settings,
} from '@dubparty/shared';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileEditor, type ProfileDraft } from '../components/ProfileEditor';
import { RoomCode } from '../components/RoomCode';
import {
  AvatarBubble,
  Badge,
  Button,
  Card,
  cx,
  Modal,
  Notice,
  Select,
  TextInput,
  Toggle,
} from '../components/ui';
import { useErrorText } from '../lib/hooks';
import { usePacks } from '../lib/packs';
import { request } from '../net/socket';
import { usePrefs } from '../store/prefs';
import { useRoom } from '../store/room';
import { toast } from '../store/toasts';

const MODE_ICONS: Record<GameMode, string> = { parallel: '🎤', roles: '🎭', free: '🌀' };

function PlayerRow({
  player,
  state,
  onEdit,
}: {
  player: PublicPlayer;
  state: RoomState;
  onEdit(): void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [confirmKick, setConfirmKick] = useState(false);
  const isYou = player.id === state.youId;
  const isHost = player.id === state.hostId;
  const youAreHost = state.hostId === state.youId;

  const act = (fn: () => Promise<unknown>) => fn().catch((err) => toast.error(errorText(err)));

  return (
    <li className="flex animate-rise items-center gap-3 rounded-2xl border border-border bg-surface-2/60 p-2.5">
      <AvatarBubble avatar={player.avatar} color={player.color} dim={!player.connected} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{player.nickname}</p>
        <div className="flex flex-wrap gap-1">
          {isHost && <Badge tone="accent">👑 {t('lobby.host')}</Badge>}
          {isYou && <Badge>{t('lobby.you')}</Badge>}
          {!player.connected && <Badge tone="warn">{t('lobby.offline')}</Badge>}
        </div>
      </div>
      {isYou && (
        <Button size="sm" variant="ghost" onClick={onEdit}>
          {t('lobby.editProfile')}
        </Button>
      )}
      {youAreHost && !isYou && (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={!player.connected}
            aria-label={t('lobby.makeHostOf', { name: player.nickname })}
            title={t('lobby.makeHost')}
            onClick={() => void act(() => request('lobby:transferHost', { playerId: player.id }))}
          >
            <span aria-hidden="true">👑</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('lobby.kickOf', { name: player.nickname })}
            title={t('lobby.kick')}
            onClick={() => setConfirmKick(true)}
          >
            <span aria-hidden="true">✕</span>
          </Button>
        </div>
      )}
      <Modal
        open={confirmKick}
        onClose={() => setConfirmKick(false)}
        title={t('lobby.kickTitle', { name: player.nickname })}
        footer={
          <>
            <Button onClick={() => setConfirmKick(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmKick(false);
                void act(() => request('lobby:kick', { playerId: player.id }));
              }}
            >
              {t('lobby.kick')}
            </Button>
          </>
        }
      >
        <p className="text-muted">{t('lobby.kickText')}</p>
      </Modal>
    </li>
  );
}

function RangeSetting({
  label,
  value,
  min,
  max,
  step,
  format,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format(value: number): string;
  onCommit(value: number): void;
}) {
  const id = useId();
  // Пока ползунок тянут, показываем локальное значение; на сервер уходит итог.
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <output htmlFor={id} className="text-sm font-bold tabular-nums">
          {format(shown)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        aria-valuetext={format(shown)}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="mt-1 w-full"
      />
    </div>
  );
}

function SettingsPanel({ state }: { state: RoomState }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const updateSettings = useRoom((s) => s.updateSettings);
  const { packs, loading } = usePacks();
  const modeGroup = useId();
  const packId = useId();
  const { settings } = state;
  const isHost = state.hostId === state.youId;
  const pack = packs.find((p) => p.id === settings.packId);

  const update = (patch: Partial<Settings>) =>
    void updateSettings(patch).catch((err) => toast.error(errorText(err)));

  if (!isHost) {
    return (
      <Card as="section" aria-labelledby="settings-title">
        <h2 id="settings-title" className="mb-3 text-xl font-bold">
          {t('lobby.settings')}
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">{t('lobby.mode')}</dt>
          <dd className="font-semibold">
            {MODE_ICONS[settings.mode]} {t(`modes.${settings.mode}.name`)}
          </dd>
          <dt className="text-muted">{t('lobby.rounds')}</dt>
          <dd className="font-semibold">{settings.rounds}</dd>
          <dt className="text-muted">{t('lobby.recordTime')}</dt>
          <dd className="font-semibold">
            {t('common.seconds', { count: settings.recordSeconds })}
          </dd>
          <dt className="text-muted">{t('lobby.pack')}</dt>
          <dd className="truncate font-semibold">{pack?.title ?? settings.packId}</dd>
          <dt className="text-muted">{t('lobby.effects')}</dt>
          <dd className="font-semibold">
            {settings.effectsEnabled ? t('common.on') : t('common.off')}
          </dd>
        </dl>
        <p className="mt-3 text-sm text-muted">{t(`modes.${settings.mode}.description`)}</p>
      </Card>
    );
  }

  return (
    <Card as="section" aria-labelledby="settings-title" className="flex flex-col gap-5">
      <h2 id="settings-title" className="text-xl font-bold">
        {t('lobby.settings')}
      </h2>

      <fieldset>
        <legend id={modeGroup} className="mb-2 text-sm font-medium">
          {t('lobby.mode')}
        </legend>
        <div role="radiogroup" aria-labelledby={modeGroup} className="grid gap-2 sm:grid-cols-3">
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={settings.mode === mode}
              onClick={() => update({ mode })}
              className={cx(
                'rounded-2xl border p-3 text-left transition-colors',
                settings.mode === mode
                  ? 'border-accent bg-accent-soft ring-1 ring-accent'
                  : 'border-border bg-surface-2 hover:border-accent/50',
              )}
            >
              <span className="flex items-center gap-2 font-bold">
                <span aria-hidden="true">{MODE_ICONS[mode]}</span>
                {t(`modes.${mode}.name`)}
              </span>
              <span className="mt-1 block text-sm text-muted">
                {t(`modes.${mode}.description`)}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <RangeSetting
        label={t('lobby.rounds')}
        value={settings.rounds}
        min={ROUNDS_MIN}
        max={ROUNDS_MAX}
        step={1}
        format={(v) => String(v)}
        onCommit={(rounds) => update({ rounds })}
      />
      <RangeSetting
        label={t('lobby.recordTime')}
        value={settings.recordSeconds}
        min={RECORD_SECONDS_MIN}
        max={RECORD_SECONDS_MAX}
        step={15}
        format={(v) => t('common.seconds', { count: v })}
        onCommit={(recordSeconds) => update({ recordSeconds })}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={packId} className="text-sm font-medium">
          {t('lobby.pack')}
        </label>
        <Select
          id={packId}
          value={settings.packId}
          disabled={loading}
          onChange={(e) => update({ packId: e.target.value })}
        >
          {!pack && <option value={settings.packId}>{settings.packId}</option>}
          {packs.map((p) => (
            <option key={p.id} value={p.id} disabled={p.clipCount === 0}>
              {p.title} — {t('lobby.clipCount', { count: p.clipCount })}
            </option>
          ))}
        </Select>
        {pack?.description && <p className="text-sm text-muted">{pack.description}</p>}
        {pack && settings.mode === 'roles' && pack.multiRoleClipCount === 0 && (
          <Notice tone="warn">{t('lobby.noRolesInPack')}</Notice>
        )}
      </div>

      <Toggle
        label={t('lobby.effects')}
        description={t('lobby.effectsHint')}
        checked={settings.effectsEnabled}
        onChange={(effectsEnabled) => update({ effectsEnabled })}
      />
      <Toggle
        label={t('lobby.hideCode')}
        description={t('lobby.hideCodeHint')}
        checked={settings.hideCode}
        onChange={(hideCode) => update({ hideCode })}
      />
    </Card>
  );
}

/** Режим стримера: зрители Twitch голосуют командами в чате. */
function TwitchPanel({ state }: { state: RoomState }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const inputId = useId();
  const [channel, setChannel] = useState(state.twitch.channel ?? '');
  const [busy, setBusy] = useState(false);
  const { twitch } = state;
  const isHost = state.hostId === state.youId;
  if (!twitch.enabled || (!isHost && twitch.status === 'off')) return null;

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    action()
      .catch((err) => toast.error(errorText(err)))
      .finally(() => setBusy(false));
  };
  const tone = {
    off: 'neutral',
    connecting: 'warn',
    connected: 'success',
    error: 'danger',
  } as const;

  return (
    <Card as="section" aria-labelledby="twitch-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="twitch-title" className="text-xl font-bold">
          <span aria-hidden="true">📺</span> {t('twitch.title')}
        </h2>
        <span role="status">
          <Badge tone={tone[twitch.status]}>
            {t(`twitch.status.${twitch.status}`, { channel: twitch.channel ?? '' })}
          </Badge>
        </span>
      </div>
      <p className="text-sm text-pretty text-muted">{t('twitch.text')}</p>
      {isHost &&
        (twitch.status === 'connected' || twitch.status === 'connecting' ? (
          <Button
            className="self-start"
            loading={busy}
            onClick={() => run(() => request('twitch:disconnect'))}
          >
            {t('twitch.disconnect')}
          </Button>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (channel.trim()) run(() => request('twitch:connect', { channel }));
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor={inputId} className="text-sm font-medium">
                {t('twitch.channel')}
              </label>
              <TextInput
                id={inputId}
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="my_channel"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
            <Button type="submit" variant="primary" loading={busy} disabled={!channel.trim()}>
              {t('twitch.connect')}
            </Button>
          </form>
        ))}
      {twitch.status === 'error' && (
        <Notice tone="danger" role="alert">
          {t('twitch.error')}
        </Notice>
      )}
    </Card>
  );
}

function EditProfileModal({
  open,
  onClose,
  me,
}: {
  open: boolean;
  onClose(): void;
  me: PublicPlayer;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const setProfile = usePrefs((s) => s.setProfile);
  const [draft, setDraft] = useState<ProfileDraft>({
    nickname: me.nickname,
    avatar: me.avatar,
    color: PLAYER_COLORS.find((c) => c === me.color) ?? (PLAYER_COLORS[0] as PlayerColor),
  });
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const nickname = nicknameSchema.safeParse(draft.nickname);
    if (!nickname.success) {
      setError(t('profile.nicknameRequired'));
      return;
    }
    try {
      await request('player:update', { ...draft, nickname: nickname.data });
      setProfile({ ...draft, nickname: nickname.data });
      onClose();
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('lobby.editProfile')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <ProfileEditor value={draft} onChange={setDraft} error={error} />
    </Modal>
  );
}

export function Lobby({ state, footer }: { state: RoomState; footer?: React.ReactNode }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const me = state.players.find((p) => p.id === state.youId)!;
  const players = state.players.filter((p) => !p.left);

  return (
    <div className="flex flex-col gap-4">
      <Card className="animate-rise">
        <RoomCode code={state.code} hidden={state.settings.hideCode} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card as="section" aria-labelledby="players-title">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="players-title" className="text-xl font-bold">
              {t('lobby.players')}
            </h2>
            <span className="text-sm font-semibold text-muted tabular-nums">
              {players.length}/{MAX_PLAYERS}
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {players.map((p) => (
              <PlayerRow key={p.id} player={p} state={state} onEdit={() => setEditing(true)} />
            ))}
          </ul>
          {players.length < MIN_PLAYERS && (
            <p className="mt-3 text-sm text-muted" role="status">
              {t('lobby.needMore', { count: MIN_PLAYERS })}
            </p>
          )}
        </Card>

        <SettingsPanel state={state} />
      </div>

      <TwitchPanel state={state} />

      {footer}

      {editing && <EditProfileModal open onClose={() => setEditing(false)} me={me} />}
    </div>
  );
}
