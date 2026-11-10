import {
  AVATARS,
  NICKNAME_MAX,
  PLAYER_COLORS,
  type Avatar,
  type PlayerColor,
} from '@dubparty/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { AVATAR_EMOJI, AvatarBubble, cx, Field, TextInput } from './ui';

export interface ProfileDraft {
  nickname: string;
  avatar: Avatar;
  color: PlayerColor;
}

export function ProfileEditor({
  value,
  onChange,
  error,
  autoFocus,
}: {
  value: ProfileDraft;
  onChange(next: ProfileDraft): void;
  error?: string | null;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const avatarGroup = useId();
  const colorGroup = useId();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <AvatarBubble avatar={value.avatar} color={value.color} size="lg" />
        <div className="min-w-0 flex-1">
          <Field label={t('profile.nickname')} error={error}>
            {(props) => (
              <TextInput
                {...props}
                value={value.nickname}
                maxLength={NICKNAME_MAX}
                autoComplete="nickname"
                autoCapitalize="words"
                enterKeyHint="done"
                autoFocus={autoFocus}
                placeholder={t('profile.nicknamePlaceholder')}
                onChange={(e) => onChange({ ...value, nickname: e.target.value })}
              />
            )}
          </Field>
        </div>
      </div>

      <fieldset>
        <legend id={avatarGroup} className="mb-1.5 text-sm font-medium">
          {t('profile.avatar')}
        </legend>
        <div
          role="radiogroup"
          aria-labelledby={avatarGroup}
          className="grid grid-cols-6 gap-2 sm:grid-cols-12"
        >
          {AVATARS.map((avatar) => (
            <button
              key={avatar}
              type="button"
              role="radio"
              aria-checked={value.avatar === avatar}
              aria-label={t(`avatars.${avatar}`)}
              title={t(`avatars.${avatar}`)}
              onClick={() => onChange({ ...value, avatar })}
              className={cx(
                'grid aspect-square place-items-center rounded-xl border text-2xl transition-transform hover:scale-110',
                value.avatar === avatar
                  ? 'border-accent bg-accent-soft ring-2 ring-accent'
                  : 'border-border bg-surface-2',
              )}
            >
              <span aria-hidden="true">{AVATAR_EMOJI[avatar]}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend id={colorGroup} className="mb-1.5 text-sm font-medium">
          {t('profile.color')}
        </legend>
        <div role="radiogroup" aria-labelledby={colorGroup} className="flex flex-wrap gap-2">
          {PLAYER_COLORS.map((color, i) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={value.color === color}
              aria-label={t(`colors.${i}`)}
              title={t(`colors.${i}`)}
              onClick={() => onChange({ ...value, color })}
              className={cx(
                'size-9 rounded-full border-2 transition-transform hover:scale-110',
                value.color === color ? 'border-text ring-2 ring-text/40' : 'border-transparent',
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}
