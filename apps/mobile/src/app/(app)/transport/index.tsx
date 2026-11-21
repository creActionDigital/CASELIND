import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { courierKeys, fetchMyCourierRequests } from '../../../courier/api';
import { useI18n } from '../../../i18n';
import { TRANSPORT_SERVICES, TRANSPORT_SPACES } from '../../../mobility/services';
import { brandAccent, radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Screen, Text } from '../../../ui';
import { FadeInView, PressableScale, SectionHeader, ServiceTile } from '../../../ui/premium';

const RIDES = TRANSPORT_SERVICES.slice(0, 4);
const DELIVERY = TRANSPORT_SERVICES.slice(4);

/** Accueil du transport et de la livraison : « Où allez-vous ? », suggestions de trajet, livraison, puis les espaces. */
export default function TransportHome() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  // Compteur facultatif : s'il échoue, l'accueil reste utilisable.
  const active = useQuery({ queryKey: courierKeys.mine('all'), queryFn: () => fetchMyCourierRequests('all'), retry: false });
  const running = active.data?.items.filter((r) => ['requested', 'accepted', 'picked_up'].includes(r.status)).length ?? 0;
  return (
    <Screen>
      <Stack.Screen options={{ title: t('mb.transport.title') }} />
      <FadeInView>
        <PressableScale onPress={() => router.push('/rides' as never)} accessibilityLabel={t('mb.transport.where')} style={[styles.where, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="search" size={22} color={colors.text} />
          <Text variant="heading" style={styles.flex}>
            {t('mb.transport.where')}
          </Text>
        </PressableScale>
      </FadeInView>
      <SectionHeader title={t('mb.transport.suggestions')} />
      <FadeInView index={1} style={styles.grid}>
        {RIDES.map((s) => (
          <ServiceTile key={s.id} icon={s.icon} label={t(s.key)} onPress={() => router.push(s.href as never)} />
        ))}
      </FadeInView>
      <SectionHeader title={t('mb.transport.deliveryTitle')} />
      <FadeInView index={2} style={styles.grid}>
        {DELIVERY.map((s) => (
          <ServiceTile key={s.id} icon={s.icon} label={t(s.key)} tint={brandAccent} badge={s.id === 'parcel' ? running : undefined} onPress={() => router.push(s.href as never)} />
        ))}
      </FadeInView>
      <SectionHeader title={t('mb.transport.spaces')} />
      {TRANSPORT_SPACES.map((s, i) => (
        <FadeInView key={s.key} index={i + 3}>
          <PressableScale onPress={() => router.push(s.href as never)} accessibilityLabel={t(s.key)} style={[styles.row, { borderColor: colors.border }]}>
            <Text style={styles.flex}>{t(s.key)}</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </PressableScale>
        </FadeInView>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  where: { minHeight: TOUCH + 8, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  grid: { flexDirection: 'row', gap: spacing.sm },
  row: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
});
