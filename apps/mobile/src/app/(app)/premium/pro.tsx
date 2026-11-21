import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useI18n } from '../../../i18n';
import { PlanPanel } from '../../../premium/PlanPanel';
import { fetchMyOrgs } from '../../../seller/api';
import { Card, Chips, Loading } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { ErrorState, Text } from '../../../ui';
import { SandboxBanner } from '../../../wallet/ui';

/** Forfaits professionnels d'une organisation que l'on gère (propriétaire ou administrateur). */
export default function ProPlans() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const orgs = useQuery({ queryKey: ['seller', 'my-orgs'], queryFn: fetchMyOrgs });
  const [picked, setPicked] = useState<string | null>(null);
  const mine = (orgs.data?.items ?? []).filter((m) => m.status === 'active' && (m.role === 'owner' || m.role === 'admin'));
  const orgId = picked ?? mine[0]?.org.id;
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Stack.Screen options={{ title: t('mon.pro.title') }} />
      <SandboxBanner />
      <Text variant="title" accessibilityRole="header">
        {t('mon.pro.title')}
      </Text>
      <Text muted>{t('mon.pro.lead')}</Text>
      {orgs.isPending ? <Loading /> : null}
      {orgs.isError ? <ErrorState error={orgs.error} onRetry={() => orgs.refetch()} /> : null}
      {orgs.data && mine.length === 0 ? <Text muted>{t('mon.pro.noOrg')}</Text> : null}
      {orgId ? (
        <>
          <Text variant="small" muted>
            {t('mon.pro.org')}
          </Text>
          <Chips value={orgId} onChange={setPicked} options={mine.map((m) => ({ value: m.org.id, label: m.org.name }))} />
          <Card>
            <Text>{t('mon.pro.benefit')}</Text>
          </Card>
          <PlanPanel key={orgId} orgId={orgId} />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ pad: { padding: spacing.lg, gap: spacing.md } });
