import {
  clipMarkupSchema,
  LIMITS,
  packMetaSchema,
  PLAYER_COLORS,
  type ClipCharacter,
  type ClipLine,
  type EditorClip,
  type PackDetail,
} from '@dubparty/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Subtitles } from '../components/Subtitles';
import { Timeline } from '../components/Timeline';
import {
  Badge,
  Button,
  Card,
  cx,
  Field,
  Modal,
  Notice,
  ProgressBar,
  Select,
  Spinner,
  TextInput,
  Toggle,
} from '../components/ui';
import { formatClock, useErrorText } from '../lib/hooks';
import { forgetPackToken, packToken } from '../lib/packTokens';
import { fetchPack } from '../net/api';
import {
  addClip,
  deleteClip,
  deletePack,
  exportUrl,
  moveClip,
  probeVideoDuration,
  saveMarkup,
  trimClip,
  updatePack,
} from '../net/packsApi';
import { toast } from '../store/toasts';

const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 8)}`;
const seconds = (ms: number) => Number((ms / 1000).toFixed(2));

/** Текущее время видео, обновляется несколько раз в секунду. */
function useVideoTime(video: React.RefObject<HTMLVideoElement | null>): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      const el = video.current;
      if (el) setMs(Math.round(el.currentTime * 1000));
    }, 80);
    return () => window.clearInterval(id);
  }, [video]);
  return ms;
}

function SecondsInput({
  value,
  max,
  label,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  label: string;
  disabled?: boolean;
  onChange(ms: number): void;
}) {
  return (
    <input
      type="number"
      aria-label={label}
      title={label}
      min={0}
      max={seconds(max)}
      step={0.05}
      disabled={disabled}
      value={seconds(value)}
      onChange={(e) => {
        const next = Math.round(Number(e.target.value) * 1000);
        if (Number.isFinite(next)) onChange(Math.min(Math.max(0, next), max));
      }}
      className="h-9 w-20 rounded-lg border border-border bg-bg px-2 text-sm tabular-nums"
    />
  );
}

// ── Обрезка ───────────────────────────────────────────────────────────────

function TrimPanel({
  clip,
  disabled,
  onApply,
}: {
  clip: EditorClip;
  disabled: boolean;
  onApply(startMs: number, endMs: number): Promise<void>;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const now = useVideoTime(video);
  const [start, setStart] = useState(clip.trimStartMs);
  const [end, setEnd] = useState(clip.trimEndMs);
  const [busy, setBusy] = useState(false);
  const length = end - start;
  const valid = length >= LIMITS.clipMinDurationMs && length <= LIMITS.clipMaxDurationMs;
  const changed = start !== clip.trimStartMs || end !== clip.trimEndMs;

  const preview = () => {
    const el = video.current;
    if (!el) return;
    el.currentTime = start / 1000;
    void el.play();
  };
  // Предпросмотр останавливается на выбранном конце.
  useEffect(() => {
    const el = video.current;
    if (el && !el.paused && now >= end) el.pause();
  }, [now, end]);

  return (
    <div className="flex flex-col gap-3">
      <video
        ref={video}
        src={clip.sourceUrl}
        controls
        playsInline
        preload="metadata"
        className="aspect-video w-full rounded-2xl bg-black"
      />
      <div className="relative h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <div
          className="absolute inset-y-0 bg-accent"
          style={{
            left: `${(start / clip.sourceDurationMs) * 100}%`,
            width: `${(length / clip.sourceDurationMs) * 100}%`,
          }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-danger"
          style={{ left: `${(now / clip.sourceDurationMs) * 100}%` }}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('editor.trimStart')}</span>
          <div className="flex gap-1.5">
            <SecondsInput
              value={start}
              max={clip.sourceDurationMs}
              label={t('editor.trimStart')}
              disabled={disabled}
              onChange={setStart}
            />
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => setStart(Math.min(now, end - 100))}
            >
              {t('editor.fromCurrent')}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t('editor.trimEnd')}</span>
          <div className="flex gap-1.5">
            <SecondsInput
              value={end}
              max={clip.sourceDurationMs}
              label={t('editor.trimEnd')}
              disabled={disabled}
              onChange={setEnd}
            />
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => setEnd(Math.max(now, start + 100))}
            >
              {t('editor.fromCurrent')}
            </Button>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={preview}>
          ▶ {t('editor.previewTrim')}
        </Button>
      </div>
      <p
        className={cx('text-sm', valid ? 'text-muted' : 'font-semibold text-danger')}
        role="status"
      >
        {t('editor.trimLength', {
          length: seconds(Math.max(0, length)),
          min: LIMITS.clipMinDurationMs / 1000,
          max: LIMITS.clipMaxDurationMs / 1000,
        })}
      </p>
      {!disabled && (
        <Button
          variant="primary"
          className="self-start"
          disabled={!valid || !changed}
          loading={busy}
          onClick={() => {
            setBusy(true);
            void onApply(start, end).finally(() => setBusy(false));
          }}
        >
          ✂ {t('editor.applyTrim')}
        </Button>
      )}
    </div>
  );
}

// ── Разметка ──────────────────────────────────────────────────────────────

function MarkupPanel({
  clip,
  readOnly,
  onDirty,
  onSave,
}: {
  clip: EditorClip;
  readOnly: boolean;
  onDirty(dirty: boolean): void;
  onSave(markup: { title: string; characters: ClipCharacter[]; lines: ClipLine[] }): Promise<void>;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const now = useVideoTime(video);
  const [title, setTitle] = useState(clip.title);
  const [characters, setCharacters] = useState<ClipCharacter[]>(clip.characters);
  const [lines, setLines] = useState<ClipLine[]>(clip.lines);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const dirty = useMemo(
    () =>
      title !== clip.title ||
      JSON.stringify(characters) !== JSON.stringify(clip.characters) ||
      JSON.stringify(lines) !== JSON.stringify(clip.lines),
    [title, characters, lines, clip],
  );
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const sorted = useMemo(() => [...lines].sort((a, b) => a.startMs - b.startMs), [lines]);
  const patchLine = (id: string, patch: Partial<ClipLine>) =>
    setLines((all) => all.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const seek = (ms: number) => {
    if (video.current) video.current.currentTime = ms / 1000;
  };

  const addLine = () => {
    const startMs = Math.min(now, clip.durationMs - 500);
    const line: ClipLine = {
      id: newId('l'),
      characterId: characters[0]!.id,
      startMs: Math.max(0, startMs),
      endMs: Math.min(clip.durationMs, Math.max(0, startMs) + 2000),
      text: '',
    };
    setLines((all) => [...all, line]);
    setSelected(line.id);
  };

  const addCharacter = () =>
    setCharacters((all) => [
      ...all,
      {
        id: newId('c'),
        name: t('editor.characterDefault', { n: all.length + 1 }),
        color: PLAYER_COLORS[all.length % PLAYER_COLORS.length]!,
      },
    ]);

  const removeCharacter = (id: string) => {
    setCharacters((all) => all.filter((c) => c.id !== id));
    setLines((all) => all.filter((l) => l.characterId !== id));
  };

  async function save() {
    const parsed = clipMarkupSchema.safeParse({
      title,
      characters,
      lines: sorted,
      attribution: clip.attribution,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path[0];
      setProblem(
        where === 'lines'
          ? t('editor.problemLine', { n: Number(issue?.path[1] ?? 0) + 1 })
          : where === 'characters'
            ? t('editor.problemCharacter')
            : t('editor.problemTitle'),
      );
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      await onSave({
        title: parsed.data.title,
        characters: parsed.data.characters,
        lines: parsed.data.lines,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <video
          ref={video}
          src={clip.videoUrl}
          controls
          playsInline
          preload="metadata"
          muted={!clip.hasMusic}
          className="aspect-video w-full rounded-2xl bg-black"
        />
        <div className="flex min-h-0 flex-col">
          <p className="mb-1.5 text-sm font-medium">{t('editor.preview')}</p>
          <Subtitles
            video={video}
            lines={sorted.filter((l) => l.text.trim())}
            characters={characters}
            mine={null}
            className="max-h-64 lg:max-h-none lg:flex-1"
          />
        </div>
      </div>

      <Timeline
        durationMs={clip.durationMs}
        lines={lines}
        characters={characters}
        currentMs={now}
        selectedId={selected}
        readOnly={readOnly}
        onSelect={setSelected}
        onChange={(id, startMs, endMs) => patchLine(id, { startMs, endMs })}
        onSeek={seek}
      />

      {!readOnly && (
        <Field label={t('editor.clipTitle')}>
          {(props) => (
            <TextInput
              {...props}
              value={title}
              maxLength={LIMITS.titleMax}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
      )}

      <section aria-labelledby="chars-title">
        <h3 id="chars-title" className="mb-2 font-bold">
          {t('editor.characters')}
        </h3>
        <ul className="flex flex-wrap gap-2">
          {characters.map((c, i) => (
            <li
              key={c.id}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-surface-2 p-1.5"
            >
              <input
                type="color"
                value={c.color}
                disabled={readOnly}
                aria-label={t('editor.characterColor', { name: c.name })}
                onChange={(e) =>
                  setCharacters((all) =>
                    all.map((x) => (x.id === c.id ? { ...x, color: e.target.value } : x)),
                  )
                }
                className="size-8 cursor-pointer rounded-lg border-0 bg-transparent p-0"
              />
              <input
                value={c.name}
                maxLength={40}
                disabled={readOnly}
                aria-label={t('editor.characterName', { n: i + 1 })}
                onChange={(e) =>
                  setCharacters((all) =>
                    all.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)),
                  )
                }
                className="h-8 w-32 rounded-lg border border-border bg-bg px-2 text-sm"
              />
              {!readOnly && characters.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('editor.removeCharacter', { name: c.name })}
                  onClick={() => removeCharacter(c.id)}
                >
                  <span aria-hidden="true">✕</span>
                </Button>
              )}
            </li>
          ))}
          {!readOnly && characters.length < LIMITS.maxCharacters && (
            <li>
              <Button size="sm" className="h-full" onClick={addCharacter}>
                + {t('editor.addCharacter')}
              </Button>
            </li>
          )}
        </ul>
      </section>

      <section aria-labelledby="lines-title">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 id="lines-title" className="font-bold">
            {t('editor.lines')} <span className="font-normal text-muted">({lines.length})</span>
          </h3>
          {!readOnly && (
            <Button
              size="sm"
              variant="primary"
              onClick={addLine}
              disabled={lines.length >= LIMITS.maxLinesPerClip}
            >
              + {t('editor.addLine', { time: formatClock(now) })}
            </Button>
          )}
        </div>
        {sorted.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted">
            {t('editor.noLines')}
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {sorted.map((line, i) => (
              <li
                key={line.id}
                onFocus={() => setSelected(line.id)}
                className={cx(
                  'flex flex-wrap items-center gap-1.5 rounded-xl border p-1.5',
                  selected === line.id
                    ? 'border-accent bg-accent-soft'
                    : 'border-border bg-surface-2/60',
                )}
              >
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('editor.jumpToLine', { n: i + 1 })}
                  title={t('editor.jumpToLine', { n: i + 1 })}
                  onClick={() => {
                    setSelected(line.id);
                    seek(line.startMs);
                  }}
                >
                  <span aria-hidden="true">▶</span>
                </Button>
                <Select
                  value={line.characterId}
                  disabled={readOnly}
                  aria-label={t('editor.lineCharacter', { n: i + 1 })}
                  onChange={(e) => patchLine(line.id, { characterId: e.target.value })}
                  className="!min-h-9 !w-32 text-sm"
                >
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <SecondsInput
                  value={line.startMs}
                  max={line.endMs - 100}
                  label={t('editor.lineStart', { n: i + 1 })}
                  disabled={readOnly}
                  onChange={(startMs) => patchLine(line.id, { startMs })}
                />
                <SecondsInput
                  value={line.endMs}
                  max={clip.durationMs}
                  label={t('editor.lineEnd', { n: i + 1 })}
                  disabled={readOnly}
                  onChange={(endMs) =>
                    patchLine(line.id, { endMs: Math.max(endMs, line.startMs + 100) })
                  }
                />
                {!readOnly && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('editor.startNow')}
                      aria-label={t('editor.startNowOf', { n: i + 1 })}
                      onClick={() =>
                        patchLine(line.id, { startMs: Math.min(now, line.endMs - 100) })
                      }
                    >
                      <span aria-hidden="true">⇤</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('editor.endNow')}
                      aria-label={t('editor.endNowOf', { n: i + 1 })}
                      onClick={() =>
                        patchLine(line.id, { endMs: Math.max(now, line.startMs + 100) })
                      }
                    >
                      <span aria-hidden="true">⇥</span>
                    </Button>
                  </>
                )}
                <input
                  value={line.text}
                  maxLength={LIMITS.lineTextMax}
                  disabled={readOnly}
                  placeholder={t('editor.lineTextPlaceholder')}
                  aria-label={t('editor.lineText', { n: i + 1 })}
                  aria-invalid={!line.text.trim() || undefined}
                  onChange={(e) => patchLine(line.id, { text: e.target.value })}
                  className={cx(
                    'h-9 min-w-40 flex-1 rounded-lg border bg-bg px-2 text-sm',
                    line.text.trim() ? 'border-border' : 'border-danger',
                  )}
                />
                {!readOnly && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('editor.removeLine', { n: i + 1 })}
                    onClick={() => setLines((all) => all.filter((l) => l.id !== line.id))}
                  >
                    <span aria-hidden="true">🗑</span>
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {!readOnly && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-lg">
          <Button variant="primary" disabled={!dirty} loading={saving} onClick={() => void save()}>
            {t('editor.saveMarkup')}
          </Button>
          <span role="status" className="text-sm text-muted">
            {dirty ? t('editor.unsaved') : t('editor.saved')}
          </span>
          {problem && (
            <span role="alert" className="text-sm font-semibold text-danger">
              {problem}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Добавление клипа ──────────────────────────────────────────────────────

function AddClip({
  onAdd,
}: {
  onAdd(
    file: File,
    title: string,
    keepAudio: boolean,
    onProgress: (f: number) => void,
  ): Promise<void>;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [keepAudio, setKeepAudio] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(next: File | undefined) {
    setProblem(null);
    if (!next) return;
    if (next.size > LIMITS.clipUploadMaxBytes) {
      setProblem(
        t('editor.fileTooLarge', { mb: Math.round(LIMITS.clipUploadMaxBytes / 1024 / 1024) }),
      );
      return;
    }
    const duration = await probeVideoDuration(next);
    if (duration !== null && duration < LIMITS.clipMinDurationMs) {
      setProblem(t('editor.fileTooShort'));
      return;
    }
    if (duration !== null && duration > LIMITS.sourceMaxDurationMs) {
      setProblem(t('editor.fileTooLong', { minutes: LIMITS.sourceMaxDurationMs / 60_000 }));
      return;
    }
    setFile(next);
    if (!title) setTitle(next.name.replace(/\.[^.]+$/, '').slice(0, LIMITS.titleMax));
  }

  async function submit() {
    if (!file || !title.trim()) return;
    setProgress(0);
    try {
      await onAdd(file, title.trim(), keepAudio, setProgress);
      setFile(null);
      setTitle('');
      if (input.current) input.current.value = '';
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={input}
        id="clip-file"
        type="file"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
        className="sr-only"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <Button onClick={() => input.current?.click()} disabled={progress !== null}>
        🎞 {file ? file.name : t('editor.chooseVideo')}
      </Button>
      <p className="text-sm text-muted">
        {t('editor.videoLimits', {
          mb: Math.round(LIMITS.clipUploadMaxBytes / 1024 / 1024),
          seconds: LIMITS.clipMaxDurationMs / 1000,
        })}
      </p>
      {problem && (
        <Notice tone="danger" role="alert">
          {problem}
        </Notice>
      )}
      {file && (
        <>
          <Field label={t('editor.clipTitle')}>
            {(props) => (
              <TextInput
                {...props}
                value={title}
                maxLength={LIMITS.titleMax}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <Toggle
            label={t('editor.keepAudio')}
            description={t('editor.keepAudioHint')}
            checked={keepAudio}
            onChange={setKeepAudio}
          />
          {progress === null ? (
            <Button variant="primary" disabled={!title.trim()} onClick={() => void submit()}>
              ⬆ {t('editor.upload')}
            </Button>
          ) : (
            <div role="status">
              <ProgressBar value={progress} label={t('editor.uploading')} />
              <p className="mt-1.5 text-sm text-muted">
                {progress < 1 ? t('editor.uploading') : t('editor.processing')}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Страница ──────────────────────────────────────────────────────────────

export function PackEditorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const { id = '' } = useParams();
  const [pack, setPack] = useState<PackDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [clipId, setClipId] = useState<string | null>(null);
  const [tab, setTab] = useState<'markup' | 'trim'>('markup');
  const [dirty, setDirty] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const token = packToken(id);
  const readOnly = !token || !!pack?.builtin;

  const reload = useCallback(
    () =>
      fetchPack(id)
        .then((p) => {
          setPack(p);
          setClipId((current) =>
            p.clips.some((c) => c.id === current) ? current : (p.clips[0]?.id ?? null),
          );
        })
        .catch(() => setFailed(true)),
    [id],
  );
  useEffect(() => void reload(), [reload]);

  // Несохранённая разметка: предупреждаем при закрытии вкладки.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const guard = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await action();
    } catch (err) {
      toast.error(errorText(err));
      return undefined;
    }
  };
  const replaceClip = (next: EditorClip) =>
    setPack((p) => (p ? { ...p, clips: p.clips.map((c) => (c.id === next.id ? next : c)) } : p));

  if (failed) {
    return (
      <Page width="sm">
        <Card className="mt-10 text-center">
          <h1 className="text-2xl font-bold">{t('editor.notFound')}</h1>
          <Link to="/packs" className="mt-4 inline-block font-semibold text-accent underline">
            {t('editor.backToPacks')}
          </Link>
        </Card>
      </Page>
    );
  }
  if (!pack) {
    return (
      <Page width="sm">
        <div className="mt-20 flex justify-center" role="status">
          <Spinner className="size-8" />
        </div>
      </Page>
    );
  }

  const clip = pack.clips.find((c) => c.id === clipId) ?? null;
  const select = (next: string) => {
    if (dirty && !window.confirm(t('editor.discardConfirm'))) return;
    setDirty(false);
    setClipId(next);
    setTab('markup');
  };

  return (
    <Page width="xl">
      <div className="mt-2 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to="/packs" className="text-sm font-medium text-muted underline">
            ← {t('editor.backToPacks')}
          </Link>
          <h1 className="truncate text-3xl font-black">{pack.title}</h1>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge>{t('lobby.clipCount', { count: pack.clipCount })}</Badge>
            {pack.builtin && <Badge tone="accent">{t('packs.builtin')}</Badge>}
            {readOnly ? (
              <Badge tone="warn">{t('editor.readOnly')}</Badge>
            ) : (
              <Badge tone="success">{t('packs.yours')}</Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!readOnly && (
            <Button onClick={() => setMetaOpen(true)}>{t('editor.packSettings')}</Button>
          )}
          {pack.clipCount > 0 && (
            <a href={exportUrl(pack.id)} download>
              <Button>⬇ {t('packs.export')}</Button>
            </a>
          )}
          {!readOnly && (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {t('editor.deletePack')}
            </Button>
          )}
        </div>
      </div>

      {readOnly && (
        <div className="mb-4">
          <Notice tone="info">{t('editor.readOnlyHint')}</Notice>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="flex flex-col gap-4">
          <Card as="section" aria-labelledby="clips-title" className="!p-3">
            <h2 id="clips-title" className="mb-2 px-1 font-bold">
              {t('editor.clips')}
            </h2>
            {pack.clips.length === 0 && (
              <p className="px-1 text-sm text-muted">{t('editor.noClips')}</p>
            )}
            <ol className="flex flex-col gap-1.5">
              {pack.clips.map((c, i) => (
                <li key={c.id} className="flex items-stretch gap-1">
                  <button
                    type="button"
                    aria-current={c.id === clipId ? 'true' : undefined}
                    onClick={() => select(c.id)}
                    className={cx(
                      'flex min-w-0 flex-1 items-center gap-2 rounded-xl border p-1.5 text-left',
                      c.id === clipId
                        ? 'border-accent bg-accent-soft'
                        : 'border-transparent hover:bg-surface-2',
                    )}
                  >
                    <img
                      src={c.posterUrl}
                      alt=""
                      className="aspect-video w-16 shrink-0 rounded-lg object-cover"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{c.title}</span>
                      <span className="block text-xs text-muted tabular-nums">
                        {formatClock(c.durationMs)} · {c.lines.length} 💬{c.hasMusic ? ' · ♪' : ''}
                      </span>
                    </span>
                  </button>
                  {!readOnly && (
                    <div className="flex flex-col">
                      <button
                        type="button"
                        disabled={i === 0}
                        aria-label={t('editor.moveUp', { title: c.title })}
                        onClick={() =>
                          void guard(() => moveClip(pack.id, c.id, token!, 'up')).then(
                            (p) => p && setPack(p),
                          )
                        }
                        className="flex-1 rounded px-1.5 text-xs hover:bg-surface-2 disabled:opacity-30"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={i === pack.clips.length - 1}
                        aria-label={t('editor.moveDown', { title: c.title })}
                        onClick={() =>
                          void guard(() => moveClip(pack.id, c.id, token!, 'down')).then(
                            (p) => p && setPack(p),
                          )
                        }
                        className="flex-1 rounded px-1.5 text-xs hover:bg-surface-2 disabled:opacity-30"
                      >
                        ▼
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </Card>

          {!readOnly && pack.clips.length < LIMITS.maxClipsPerPack && (
            <Card as="section" aria-labelledby="add-title" className="!p-4">
              <h2 id="add-title" className="mb-3 font-bold">
                {t('editor.addClip')}
              </h2>
              <AddClip
                onAdd={async (file, title, keepAudio, onProgress) => {
                  const added = await guard(() =>
                    addClip(pack.id, token!, file, { title, keepAudio }, onProgress),
                  );
                  if (!added) return;
                  toast.success(t('editor.clipAdded'));
                  await reload();
                  setClipId(added.id);
                  // Длинное видео нужно сначала обрезать до допустимой длины.
                  setTab(added.sourceDurationMs > LIMITS.clipMaxDurationMs ? 'trim' : 'markup');
                }}
              />
            </Card>
          )}
        </div>

        {clip ? (
          <Card className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div
                role="tablist"
                aria-label={t('editor.sections')}
                className="flex gap-1 rounded-xl bg-surface-2 p-1"
              >
                {(['markup', 'trim'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => {
                      if (key === 'trim' && dirty && !window.confirm(t('editor.discardConfirm')))
                        return;
                      if (key === 'trim') setDirty(false);
                      setTab(key);
                    }}
                    className={cx(
                      'rounded-lg px-4 py-1.5 text-sm font-bold',
                      tab === key ? 'bg-surface shadow-sm' : 'text-muted hover:text-text',
                    )}
                  >
                    {t(`editor.tab.${key}`)}
                  </button>
                ))}
              </div>
              {!readOnly && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (!window.confirm(t('editor.deleteClipConfirm', { title: clip.title })))
                      return;
                    void guard(() => deleteClip(pack.id, clip.id, token!)).then((ok) => {
                      if (!ok) return;
                      setDirty(false);
                      void reload();
                    });
                  }}
                >
                  {t('editor.deleteClip')}
                </Button>
              )}
            </div>

            {tab === 'markup' ? (
              <MarkupPanel
                key={`${clip.id}:${clip.videoUrl}`}
                clip={clip}
                readOnly={readOnly}
                onDirty={setDirty}
                onSave={async (markup) => {
                  const saved = await guard(() => saveMarkup(pack.id, clip.id, token!, markup));
                  if (!saved) return;
                  replaceClip(saved);
                  toast.success(t('editor.markupSaved'));
                }}
              />
            ) : (
              <TrimPanel
                key={`${clip.id}:${clip.trimStartMs}:${clip.trimEndMs}`}
                clip={clip}
                disabled={readOnly}
                onApply={async (startMs, endMs) => {
                  const trimmed = await guard(() =>
                    trimClip(pack.id, clip.id, token!, { startMs, endMs }),
                  );
                  if (!trimmed) return;
                  replaceClip(trimmed);
                  toast.success(t('editor.trimApplied'));
                  setTab('markup');
                }}
              />
            )}
          </Card>
        ) : (
          <Card className="grid place-items-center text-center text-muted">
            <p>{readOnly ? t('editor.noClips') : t('editor.emptyHint')}</p>
          </Card>
        )}
      </div>

      {metaOpen && (
        <PackMetaModal
          pack={pack}
          onClose={() => setMetaOpen(false)}
          onSave={async (meta) => {
            const updated = await guard(() => updatePack(pack.id, token!, meta));
            if (!updated) return;
            setPack(updated);
            setMetaOpen(false);
          }}
        />
      )}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('editor.deletePackTitle', { title: pack.title })}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() =>
                void guard(() => deletePack(pack.id, token!)).then((ok) => {
                  if (!ok) return;
                  forgetPackToken(pack.id);
                  navigate('/packs');
                })
              }
            >
              {t('editor.deletePack')}
            </Button>
          </>
        }
      >
        <p className="text-muted">{t('editor.deletePackText')}</p>
      </Modal>
    </Page>
  );
}

function PackMetaModal({
  pack,
  onClose,
  onSave,
}: {
  pack: PackDetail;
  onClose(): void;
  onSave(meta: {
    title: string;
    description: string;
    author: string;
    license: string;
    language: string;
  }): Promise<void>;
}) {
  const { t } = useTranslation();
  const [meta, setMeta] = useState({
    title: pack.title,
    description: pack.description,
    author: pack.author,
    license: pack.license,
    language: pack.language,
  });
  const [busy, setBusy] = useState(false);
  const valid = packMetaSchema.safeParse(meta).success;
  const field = (key: keyof typeof meta, max: number) => (
    <Field label={t(`editor.meta.${key}`)}>
      {(props) => (
        <TextInput
          {...props}
          value={meta[key]}
          maxLength={max}
          onChange={(e) => setMeta((m) => ({ ...m, [key]: e.target.value }))}
        />
      )}
    </Field>
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={t('editor.packSettings')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!valid}
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onSave(meta).finally(() => setBusy(false));
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {field('title', LIMITS.titleMax)}
        {field('description', LIMITS.descriptionMax)}
        {field('author', 80)}
        {field('license', 80)}
        <Field label={t('editor.meta.language')} hint={t('editor.meta.languageHint')}>
          {(props) => (
            <TextInput
              {...props}
              value={meta.language}
              maxLength={5}
              onChange={(e) => setMeta((m) => ({ ...m, language: e.target.value }))}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}
