import type { ConsentKind } from '@caselind/contracts';
import { StyleSheet, View } from 'react-native';
import { SheetModal } from '../components/SheetModal';
import { useI18n } from '../i18n';
import { spacing } from '../theme/tokens';
import { Button, Text } from '../ui';

/** Information avant le premier envoi à un fournisseur d'IA : ce qui part, ce qui ne part pas, accepter ou refuser. */
export function ConsentSheet({
  kind,
  busy,
  onAccept,
  onRefuse,
}: {
  kind: Extract<ConsentKind, 'translation' | 'ai_processing'> | null;
  busy?: boolean;
  onAccept: () => void;
  onRefuse: () => void;
}) {
  const { t } = useI18n();
  const p = kind === 'translation' ? 'consentsheet.translation' : 'consentsheet.ai';
  return (
    <SheetModal visible={kind !== null} onClose={onRefuse}>
      <View style={styles.body}>
        <Text variant="heading" accessibilityRole="header">
          {t(`${p}.title` as 'consentsheet.ai.title')}
        </Text>
        <Text>{t(`${p}.body` as 'consentsheet.ai.body')}</Text>
        <Button label={t(`${p}.accept` as 'consentsheet.ai.accept')} onPress={onAccept} loading={busy} />
        <Button variant="secondary" label={t('consentsheet.refuse')} onPress={onRefuse} disabled={busy} />
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({ body: { gap: spacing.md, paddingTop: spacing.sm } });
