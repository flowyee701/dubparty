import { EFFECT_IDS, type EffectId } from '@dubparty/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from './ui';

const ICONS: Record<EffectId, string> = {
  none: '🙂',
  pitchUp: '🐭',
  pitchDown: '🐻',
  robot: '🤖',
  echo: '🏔',
  radio: '📻',
  helium: '🎈',
};

export function EffectPicker({
  value,
  onChange,
  disabled,
}: {
  value: EffectId;
  onChange(effect: EffectId): void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  return (
    <div>
      <p id={labelId} className="mb-1.5 text-sm font-medium">
        {t('effects.title')}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {EFFECT_IDS.map((effect) => (
          <button
            key={effect}
            type="button"
            role="radio"
            aria-checked={value === effect}
            disabled={disabled}
            onClick={() => onChange(effect)}
            className={cx(
              'flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors disabled:opacity-50',
              value === effect
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-border bg-surface-2 hover:border-accent/60',
            )}
          >
            <span aria-hidden="true">{ICONS[effect]}</span>
            {t(`effects.${effect}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
