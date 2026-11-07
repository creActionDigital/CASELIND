import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { acceptInvitation, declineInvitation, sk, useMyOrgs } from '../../../seller/api';
import { Card, Loading, SectionTitle, sellerErrorMessage } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, EmptyState, ErrorState, Text } from '../../../ui';

/** Espace vendeur : mes organisations, invitations en attente, création d'une boutique. */
export default function SellerHome() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useMyOrgs();
  const [error, setError] = useState<string | null>(null);

  const respond = useMutation({
    mutationFn: async ({ orgId, accept }: { orgId: string; accept: boolean }) => {
      if (accept) await acceptInvitation(orgId);
      else await declineInvitation(orgId);
    },
    onMutate: () => setError(null),
    onError: (e) => setError(sellerErrorMessage(e, t, locale)),
    onSettled: () => void qc.invalidateQueries({ queryKey: sk.myOrgs }),
  });

  const title = <Stack.Screen options={{ title: t('seller.title') }} />;
  if (q.isPending) return <>{title}<Loading /></>;
  if (q.isError) return <>{title}<ErrorState error={q.error} onRetry={() => q.refetch()} /></>;

  const active = q.data.items.filter((m) => m.status === 'active');
  const invited = q.data.items.filter((m) => m.status === 'invited');

  return (
    <>
      {title}
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {invited.length > 0 ? (
          <>
            <SectionTitle>{t('seller.invitations')}</SectionTitle>
            {invited.map((m) => (
              <Card key={m.org.id}>
                <Text variant="bodyStrong">{m.org.name}</Text>
                <Text variant="small" muted>
                  {t('seller.invitedAs', { role: t(`seller.role.${m.role}` as MessageKey) })}
                </Text>
                <View style={styles.actions}>
                  <Button
                    label={t('seller.accept')}
                    loading={respond.isPending && respond.variables?.orgId === m.org.id && respond.variables.accept}
                    disabled={respond.isPending}
                    onPress={() => respond.mutate({ orgId: m.org.id, accept: true })}
                    style={{ flex: 1 }}
                  />
                  <Button
                    variant="secondary"
                    label={t('seller.decline')}
                    disabled={respond.isPending}
                    onPress={() => respond.mutate({ orgId: m.org.id, accept: false })}
                    style={{ flex: 1 }}
                  />
                </View>
              </Card>
            ))}
          </>
        ) : null}

        {active.length > 0 ? (
          <>
            <SectionTitle>{t('seller.myShops')}</SectionTitle>
            {active.map((m) => (
              <Card key={m.org.id} label={m.org.name} onPress={() => router.push({ pathname: '/seller/[orgId]', params: { orgId: m.org.id } })}>
                <View style={styles.line}>
                  <Ionicons name="storefront-outline" size={24} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {m.org.name}
                    </Text>
                    <Text variant="small" muted>
                      {t(`seller.role.${m.role}` as MessageKey)}
                      {m.org.status === 'suspended' ? ` · ${t('seller.suspended')}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </View>
              </Card>
            ))}
          </>
        ) : invited.length === 0 ? (
          <EmptyState
            icon="storefront-outline"
            title={t('seller.empty.title')}
            body={t('seller.empty.body')}
          />
        ) : null}

        <View style={{ marginTop: spacing.lg }}>
          <Button
            variant={active.length > 0 ? 'secondary' : 'primary'}
            label={t('seller.createShop')}
            onPress={() => router.push('/seller/new')}
          />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
