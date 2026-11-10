import type { ClipCharacter, ClipLine } from '@dubparty/shared';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cx, readableOn } from './ui';

const LANE_PX = 30;
const MIN_LINE_MS = 200;
const SNAP_MS = 50;

type DragMode = 'move' | 'start' | 'end';

/**
 * Таймлайн клипа: по дорожке на персонажа, реплики — блоки, которые можно двигать
 * и растягивать за края. Точные значения и управление с клавиатуры — в таблице реплик.
 */
export function Timeline({
  durationMs,
  lines,
  characters,
  currentMs,
  selectedId,
  readOnly,
  onSelect,
  onChange,
  onSeek,
}: {
  durationMs: number;
  lines: readonly ClipLine[];
  characters: readonly ClipCharacter[];
  currentMs: number;
  selectedId: string | null;
  readOnly?: boolean;
  onSelect(lineId: string): void;
  onChange(lineId: string, startMs: number, endMs: number): void;
  onSeek(ms: number): void;
}) {
  const { t } = useTranslation();
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: string;
    mode: DragMode;
    x: number;
    startMs: number;
    endMs: number;
  } | null>(null);

  const snap = (ms: number) => Math.round(ms / SNAP_MS) * SNAP_MS;
  const pct = (ms: number) => `${(Math.min(Math.max(ms, 0), durationMs) / durationMs) * 100}%`;

  const begin = (event: React.PointerEvent, line: ClipLine, mode: DragMode) => {
    if (readOnly) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: line.id,
      mode,
      x: event.clientX,
      startMs: line.startMs,
      endMs: line.endMs,
    };
    onSelect(line.id);
  };

  const move = (event: React.PointerEvent) => {
    const state = drag.current;
    const width = track.current?.clientWidth ?? 0;
    if (!state || width === 0) return;
    const delta = ((event.clientX - state.x) / width) * durationMs;
    let { startMs, endMs } = state;
    if (state.mode === 'move') {
      const length = endMs - startMs;
      startMs = snap(Math.min(Math.max(0, startMs + delta), durationMs - length));
      endMs = startMs + length;
    } else if (state.mode === 'start') {
      startMs = snap(Math.min(Math.max(0, startMs + delta), endMs - MIN_LINE_MS));
    } else {
      endMs = snap(Math.max(Math.min(durationMs, endMs + delta), startMs + MIN_LINE_MS));
    }
    onChange(state.id, startMs, endMs);
  };

  const end = () => {
    drag.current = null;
  };

  const seekFromPointer = (event: React.PointerEvent) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    onSeek(
      Math.min(Math.max(0, ((event.clientX - rect.left) / rect.width) * durationMs), durationMs),
    );
  };

  const seconds = Math.floor(durationMs / 1000);
  const tickEvery = seconds > 30 ? 5 : seconds > 12 ? 2 : 1;

  return (
    <div className="select-none" aria-label={t('editor.timeline')} role="group">
      <div className="flex">
        <div className="w-24 shrink-0" aria-hidden="true" />
        <div className="relative h-5 flex-1 text-[10px] text-muted" aria-hidden="true">
          {Array.from({ length: Math.floor(seconds / tickEvery) + 1 }, (_, i) => i * tickEvery).map(
            (s) => (
              <span
                key={s}
                className="absolute -translate-x-1/2 tabular-nums"
                style={{ left: pct(s * 1000) }}
              >
                {s}s
              </span>
            ),
          )}
        </div>
      </div>
      <div className="flex">
        <ul className="w-24 shrink-0" aria-hidden="true">
          {characters.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-1.5 truncate pr-2 text-xs font-semibold"
              style={{ height: LANE_PX }}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              <span className="truncate">{c.name}</span>
            </li>
          ))}
        </ul>
        <div
          ref={track}
          className="relative flex-1 cursor-pointer overflow-hidden rounded-xl border border-border bg-surface-2"
          style={{ height: Math.max(1, characters.length) * LANE_PX }}
          onPointerDown={seekFromPointer}
        >
          {characters.map((c, lane) => (
            <div
              key={c.id}
              aria-hidden="true"
              className={cx('absolute inset-x-0', lane % 2 === 1 && 'bg-border/30')}
              style={{ top: lane * LANE_PX, height: LANE_PX }}
            />
          ))}
          {lines.map((line) => {
            const lane = Math.max(
              0,
              characters.findIndex((c) => c.id === line.characterId),
            );
            const color = characters[lane]?.color ?? '#888888';
            const selected = line.id === selectedId;
            return (
              <div
                key={line.id}
                data-line={line.id}
                title={line.text}
                onPointerDown={(e) => begin(e, line, 'move')}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                className={cx(
                  'absolute flex items-center overflow-hidden rounded-md text-[11px] font-semibold',
                  readOnly ? 'cursor-default' : 'cursor-grab touch-none active:cursor-grabbing',
                  selected && 'z-10 ring-2 ring-text',
                )}
                style={{
                  top: lane * LANE_PX + 3,
                  height: LANE_PX - 6,
                  left: pct(line.startMs),
                  width: `${((line.endMs - line.startMs) / durationMs) * 100}%`,
                  backgroundColor: color,
                  color: readableOn(color),
                }}
              >
                {!readOnly && (
                  <span
                    onPointerDown={(e) => begin(e, line, 'start')}
                    onPointerMove={move}
                    onPointerUp={end}
                    className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-black/30"
                  />
                )}
                <span className="pointer-events-none truncate px-2.5">{line.text}</span>
                {!readOnly && (
                  <span
                    onPointerDown={(e) => begin(e, line, 'end')}
                    onPointerMove={move}
                    onPointerUp={end}
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/30"
                  />
                )}
              </div>
            );
          })}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-danger"
            style={{ left: pct(currentMs) }}
          />
        </div>
      </div>
    </div>
  );
}
