import type { PublicPlayer } from '@dubparty/shared';
import { useTranslation } from 'react-i18next';
import { AvatarBubble, cx } from './ui';

/** Строка игроков с отметкой «готов» — кто уже сдал дубль или проголосовал. */
export function PlayerChips({
  players,
  doneIds,
  doneLabel,
  pendingLabel,
}: {
  players: PublicPlayer[];
  doneIds: readonly string[];
  doneLabel: string;
  pendingLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-2">
      {players
        .filter((p) => !p.left)
        .map((p) => {
          const done = doneIds.includes(p.id);
          return (
            <li
              key={p.id}
              className={cx(
                'flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-sm font-semibold transition-colors',
                done ? 'border-success/50 bg-success-soft' : 'border-border bg-surface-2',
              )}
            >
              <AvatarBubble avatar={p.avatar} color={p.color} size="sm" dim={!p.connected} />
              <span className="max-w-28 truncate">{p.nickname}</span>
              <span aria-hidden="true">{done ? '✓' : p.connected ? '…' : '⚠'}</span>
              <span className="sr-only">
                {!p.connected ? t('lobby.offline') : done ? doneLabel : pendingLabel}
              </span>
            </li>
          );
        })}
    </ul>
  );
}

/** Имена авторов записи через запятую. */
export function authorNames(players: PublicPlayer[], authorIds: readonly string[]): string {
  return authorIds.map((id) => players.find((p) => p.id === id)?.nickname ?? '?').join(', ');
}

export function Authors({
  players,
  authorIds,
  size = 'md',
}: {
  players: PublicPlayer[];
  authorIds: readonly string[];
  size?: 'sm' | 'md' | 'lg';
}) {
  const authors = authorIds.flatMap((id) => players.find((p) => p.id === id) ?? []);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex shrink-0 -space-x-2">
        {authors.map((p) => (
          <AvatarBubble key={p.id} avatar={p.avatar} color={p.color} size={size} />
        ))}
      </span>
      <span className="min-w-0 truncate font-bold">
        {authors.map((p) => p.nickname).join(', ')}
      </span>
    </span>
  );
}
