import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SheetModal } from '../components/SheetModal';
import { useI18n } from '../i18n';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, Text, TextField } from '../ui';
import { checkSchedule, formatDateField, formatTimeField, parseLocalDateTime } from './extras-logic';

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: (at: Date) => void;
  busy?: boolean;
}

/**
 * Sélecteur de date et d'heure de 1 minute à 30 jours. Champs simples (AAAA-MM-JJ / HH:MM) sur toutes les
 * plateformes : aucun module de sélecteur natif n'est installé dans l'application.
 */
export function ScheduleSheet({ visible, onClose, onConfirm, busy }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fill = (d: Date) => {
    setDate(formatDateField(d));
    setTime(formatTimeField(d));
    setError(null);
  };
  useEffect(() => {
    if (visible) fill(new Date(Date.now() + 3600_000));
  }, [visible]);

  const quick = [
    { label: t('messagesX.schedule.in15'), at: () => new Date(Date.now() + 15 * 60_000) },
    { label: t('messagesX.schedule.in1h'), at: () => new Date(Date.now() + 3600_000) },
    {
      label: t('messagesX.schedule.tomorrow'),
      at: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d;
      },
    },
    { label: t('messagesX.schedule.in7d'), at: () => new Date(Date.now() + 7 * 86400_000) },
  ];

  function submit() {
    const at = parseLocalDateTime(date, time);
    const check = checkSchedule(at, Date.now());
    if (check !== 'ok' || !at) {
      setError(t(check === 'too_soon' ? 'messagesX.schedule.too_soon' : check === 'too_far' ? 'messagesX.schedule.too_far' : 'messagesX.schedule.invalid'));
      return;
    }
    setError(null);
    onConfirm(at);
  }

  return (
    <SheetModal visible={visible} onClose={onClose}>
      <View style={{ gap: spacing.sm }}>
        <Text variant="heading" accessibilityRole="header">
          {t('messagesX.schedule.title')}
        </Text>
        <View style={styles.chips}>
          {quick.map((q) => (
            <Button key={q.label} variant="secondary" label={q.label} onPress={() => fill(q.at())} style={styles.chip} />
          ))}
        </View>
        <TextField label={t('messagesX.schedule.date')} value={date} onChangeText={setDate} placeholder="2026-12-24" keyboardType="numbers-and-punctuation" autoCorrect={false} />
        <TextField label={t('messagesX.schedule.time')} value={time} onChangeText={setTime} placeholder="09:30" keyboardType="numbers-and-punctuation" autoCorrect={false} />
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}
        <Button label={t('messagesX.schedule.confirm')} onPress={submit} loading={busy} />
        <Button variant="ghost" label={t('common.cancel')} onPress={onClose} />
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md },
});
