import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../store/toasts';
import { Button, cx } from './ui';

export function inviteLink(code: string): string {
  return `${window.location.origin}/r/${code}`;
}

/**
 * Код комнаты и приглашение. В режиме стримера код скрыт точками и показывается
 * только пока удерживается кнопка — на трансляцию он не попадёт. Копирование работает всегда.
 */
export function RoomCode({ code, hidden }: { code: string; hidden: boolean }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const masked = hidden && !revealed;

  async function copy(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error(t('lobby.copyFailed'));
    }
  }

  async function share() {
    const url = inviteLink(code);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'DubParty', text: t('lobby.shareText'), url });
        return;
      } catch {
        // Пользователь закрыл системное окно — просто копируем ссылку.
      }
    }
    await copy(url, t('lobby.linkCopied'));
  }

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="text-sm font-medium text-muted">{t('lobby.roomCode')}</p>
      <div className="flex items-center gap-2" aria-live="polite">
        <span className="sr-only">{masked ? t('lobby.codeHidden') : code.split('').join(' ')}</span>
        <div aria-hidden="true" className="flex gap-1.5 sm:gap-2">
          {code.split('').map((ch, i) => (
            <span
              key={i}
              className={cx(
                'grid h-14 w-12 place-items-center rounded-2xl border border-border bg-surface-2 font-mono text-3xl font-black sm:h-16 sm:w-14 sm:text-4xl',
                masked && 'text-muted',
              )}
            >
              {masked ? '•' : ch}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {hidden && (
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={revealed}
            onPointerDown={() => setRevealed(true)}
            onPointerUp={() => setRevealed(false)}
            onPointerLeave={() => setRevealed(false)}
            onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setRevealed(true)}
            onKeyUp={() => setRevealed(false)}
            onBlur={() => setRevealed(false)}
          >
            👁 {t('lobby.holdToReveal')}
          </Button>
        )}
        <Button size="sm" onClick={() => void copy(code, t('lobby.codeCopied'))}>
          {t('lobby.copyCode')}
        </Button>
        <Button size="sm" variant="primary" onClick={() => void share()}>
          {t('lobby.invite')}
        </Button>
      </div>
    </div>
  );
}
