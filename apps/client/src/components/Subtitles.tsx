import { activeLineIndex, type ClipCharacter, type ClipLine } from '@dubparty/shared';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrefersReducedMotion } from '../lib/hooks';
import { cx } from './ui';

/** Номер текущей реплики и ближайшей следующей по времени видео. */
export function useLineCursor(
  video: RefObject<HTMLVideoElement | null>,
  lines: readonly ClipLine[],
): { active: number; upcoming: number } {
  const [cursor, setCursor] = useState({ active: -1, upcoming: -1 });

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = video.current;
      if (el) {
        const tMs = el.currentTime * 1000;
        const active = activeLineIndex(lines, tMs);
        // «На подходе» — реплика, до которой осталось меньше полутора секунд.
        const upcoming = lines.findIndex((l) => l.startMs > tMs && l.startMs - tMs < 1500);
        setCursor((prev) =>
          prev.active === active && prev.upcoming === upcoming ? prev : { active, upcoming },
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video, lines]);

  return cursor;
}

/**
 * Подсказки с репликами: текущая подсвечена, следующая помечена «готовься».
 * В режиме ролей чужие реплики приглушены.
 */
export function Subtitles({
  video,
  lines,
  characters,
  mine,
  className,
}: {
  video: RefObject<HTMLVideoElement | null>;
  lines: readonly ClipLine[];
  characters: readonly ClipCharacter[];
  /** Персонажи игрока (режим ролей); null — озвучивает всех. */
  mine: readonly string[] | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const { active, upcoming } = useLineCursor(video, lines);
  const reduced = usePrefersReducedMotion();
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const index = active >= 0 ? active : upcoming;
    if (index < 0) return;
    const item = list.current?.children[index] as HTMLElement | undefined;
    // Прокручиваем только список, а не всю страницу.
    const box = list.current;
    if (!item || !box) return;
    const top = item.offsetTop - box.clientHeight / 2 + item.clientHeight / 2;
    box.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
  }, [active, upcoming, reduced]);

  if (lines.length === 0) {
    return (
      <div
        className={cx(
          'grid place-items-center rounded-2xl border border-dashed border-border p-6 text-center',
          className,
        )}
      >
        <p className="text-muted">{t('studio.noLines')}</p>
      </div>
    );
  }

  return (
    <ol
      ref={list}
      aria-label={t('studio.lines')}
      className={cx('relative flex flex-col gap-1.5 overflow-y-auto scroll-smooth pr-1', className)}
    >
      {lines.map((line, i) => {
        const character = characters.find((c) => c.id === line.characterId);
        const isMine = !mine || mine.includes(line.characterId);
        const isActive = i === active;
        const isNext = i === upcoming && active !== i;
        return (
          <li
            key={line.id}
            aria-current={isActive ? 'true' : undefined}
            className={cx(
              'rounded-xl border px-3 py-2 transition-[background-color,opacity,transform] duration-150',
              isActive
                ? 'scale-[1.01] border-accent bg-accent-soft'
                : isNext && isMine
                  ? 'border-warn/60 bg-warn-soft'
                  : 'border-transparent bg-surface-2/60',
              !isMine && 'opacity-45',
            )}
          >
            <div className="flex items-center gap-2 text-xs font-bold">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ backgroundColor: character?.color ?? '#888' }}
              />
              <span>{character?.name ?? line.characterId}</span>
              {mine && isMine && <span className="text-accent">· {t('studio.yourLine')}</span>}
              {isNext && isMine && (
                <span className="ml-auto text-warn">{t('studio.getReady')}</span>
              )}
            </div>
            <p className={cx('mt-0.5 text-pretty', isActive ? 'text-lg font-bold' : 'text-base')}>
              {line.text}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
