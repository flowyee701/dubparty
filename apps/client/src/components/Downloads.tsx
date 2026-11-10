import type { HistoryRound, RoomState } from '@dubparty/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorText } from '../lib/hooks';
import { downloadFile } from '../net/api';
import { useRoom } from '../store/room';
import { toast } from '../store/toasts';
import { authorNames } from './PlayerChips';
import { Button } from './ui';

/** Кнопки скачивания: игроку — свои озвучки, хосту — ещё и все озвучки раунда архивом. */
export function RoundDownloads({ state, round }: { state: RoomState; round: HistoryRound }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const token = useRoom((s) => s.token);
  const [busy, setBusy] = useState<string | null>(null);
  const isHost = state.hostId === state.youId;
  // Хосту доступны все записи по отдельности, остальным — только свои.
  const entries = round.entries.filter((e) => isHost || e.authorIds.includes(state.youId));

  if (!token || (entries.length === 0 && !isHost)) return null;

  const download = async (key: string, path: string, fallback: string) => {
    setBusy(key);
    try {
      await downloadFile(path, token, fallback);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {entries.map((entry) => {
        const mine = entry.authorIds.includes(state.youId);
        return (
          <Button
            key={entry.id}
            size="sm"
            loading={busy === entry.id}
            onClick={() =>
              void download(
                entry.id,
                `/api/rooms/${state.code}/entries/${entry.id}/download`,
                `dubparty-r${round.index + 1}.mp4`,
              )
            }
          >
            ⬇{' '}
            {mine
              ? t('results.downloadMine')
              : t('results.downloadOf', { names: authorNames(state.players, entry.authorIds) })}
          </Button>
        );
      })}
      {isHost && round.entries.length > 0 && (
        <Button
          size="sm"
          variant="secondary"
          loading={busy === 'all'}
          onClick={() =>
            void download(
              'all',
              `/api/rooms/${state.code}/rounds/${round.index}/download`,
              `dubparty-r${round.index + 1}.zip`,
            )
          }
        >
          🗜 {t('results.downloadAll')}
        </Button>
      )}
    </div>
  );
}
