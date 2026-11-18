import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SheetModal } from '../components/SheetModal';
import { useI18n } from '../i18n';
import { spacing } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Button, IconButton, Text, TextField } from '../ui';
import { cleanPollDraft, POLL_OPTIONS_MAX } from './social-logic';

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: (poll: { question: string; options: string[]; multiple: boolean }) => void;
  busy?: boolean;
}

/** Création d'un sondage : question, 2 à 6 options, choix multiple. La clôture programmée reste à l'API. */
export function PollSheet({ visible, onClose, onConfirm, busy }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (visible) {
      setQuestion('');
      setOptions(['', '']);
      setMultiple(false);
      setInvalid(false);
    }
  }, [visible]);

  function submit() {
    const d = cleanPollDraft({ question, options, multiple });
    if (!d.ok) return setInvalid(true);
    setInvalid(false);
    onConfirm({ question: d.question, options: d.options, multiple });
  }

  return (
    <SheetModal visible={visible} onClose={onClose}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm }}>
        <Text variant="heading" accessibilityRole="header">
          {t('social.poll.title')}
        </Text>
        <TextField label={t('social.poll.question')} value={question} onChangeText={setQuestion} maxLength={200} multiline />
        {options.map((o, i) => (
          <View key={i} style={styles.row}>
            <View style={{ flex: 1 }}>
              <TextField label={t('social.poll.option', { n: i + 1 })} value={o} onChangeText={(v) => setOptions((all) => all.map((x, j) => (j === i ? v : x)))} maxLength={80} />
            </View>
            {options.length > 2 ? (
              <IconButton icon="close" label={t('social.poll.removeOption', { n: i + 1 })} onPress={() => setOptions((all) => all.filter((_, j) => j !== i))} />
            ) : null}
          </View>
        ))}
        {options.length < POLL_OPTIONS_MAX ? <Button variant="secondary" label={t('social.poll.addOption')} onPress={() => setOptions((all) => [...all, ''])} /> : null}
        <View style={styles.row}>
          <Text style={{ flex: 1 }}>{t('social.poll.multiple')}</Text>
          <Switch accessibilityLabel={t('social.poll.multiple')} value={multiple} onValueChange={setMultiple} trackColor={{ true: colors.primary, false: colors.border }} />
        </View>
        {invalid ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="assertive">
            {t('social.poll.invalid')}
          </Text>
        ) : null}
        <Button label={t('social.poll.create')} onPress={submit} loading={busy} />
      </ScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
