import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HowToPlay } from '../pages/HowToPlayPage';
import { MicCheck } from '../pages/MicCheckPage';
import { usePrefs } from '../store/prefs';
import { Button, Modal } from './ui';

/**
 * Онбординг перед первой игрой: как играть и проверка микрофона.
 * Показывается один раз; позже оба экрана доступны с главной страницы.
 */
export function Onboarding() {
  const { t } = useTranslation();
  const onboarded = usePrefs((s) => s.onboarded);
  const setOnboarded = usePrefs((s) => s.setOnboarded);
  const [step, setStep] = useState<'how' | 'mic'>('how');

  if (onboarded) return null;
  const finish = () => setOnboarded(true);

  return (
    <Modal
      open
      onClose={finish}
      title={step === 'how' ? t('onboarding.howTitle') : t('onboarding.micTitle')}
      footer={
        step === 'how' ? (
          <>
            <Button variant="ghost" onClick={finish}>
              {t('onboarding.skip')}
            </Button>
            <Button variant="primary" onClick={() => setStep('mic')}>
              {t('onboarding.toMic')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setStep('how')}>
            ← {t('common.back')}
          </Button>
        )
      }
    >
      {step === 'how' ? <HowToPlay compact /> : <MicCheck onDone={finish} />}
    </Modal>
  );
}
