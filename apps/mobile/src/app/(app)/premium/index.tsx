import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useI18n } from '../../../i18n';
import { PlanPanel } from '../../../premium/PlanPanel';
import { Card } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, Text } from '../../../ui';
import { SandboxBanner } from '../../../wallet/ui';

/** Premium : le seul avantage est le badge sur le profil (dit clairement). Paiement en mode test par le portefeuille. */
export default function Premium() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Stack.Screen options={{ title: t('mon.premium.title') }} />
      <SandboxBanner />
      <View style={{ alignItems: 'center', gap: spacing.sm, marginVertical: spacing.md }}>
        <View style={{ width: 76, height: 76, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="shield" size={76} color={colors.primary} style={{ position: 'absolute' }} />
          <Ionicons name="star" size={30} color={colors.onPrimary} />
        </View>
        <Text variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {t('mon.premium.title')}
        </Text>
        <Text muted style={{ textAlign: 'center' }}>{t('mon.premium.lead')}</Text>
      </View>
      <Card style={{ gap: spacing.sm }}>
        <Text variant="heading" accessibilityRole="header">
          {t('mon.premium.benefitsTitle')}
        </Text>
        <View style={styles.row}>
          <Ionicons name="ribbon-outline" size={20} color={colors.primary} />
          <Text style={{ flex: 1 }}>{t('mon.premium.benefit.badge')}</Text>
        </View>
        <Text variant="small" muted>
          {t('mon.premium.benefit.none')}
        </Text>
      </Card>
      <PlanPanel />
      <Button variant="secondary" label={t('mon.pro.link')} onPress={() => router.push('/premium/pro')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ pad: { padding: spacing.lg, gap: spacing.md }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm } });
