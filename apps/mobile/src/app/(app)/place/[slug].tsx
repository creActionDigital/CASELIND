import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { directionsUrl, type MapsPlatform } from '../../../places/geo';
import { placeActions, showsHoursFirst } from '../../../places/kinds';
import { fetchStore } from '../../../shop/api';
import { shopKeys } from '../../../shop/hooks';
import { Card } from '../../../seller/ui';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Badge, Button, ErrorState, Screen, Text } from '../../../ui';
import { FadeInView, SkeletonList } from '../../../ui/premium';
import { DAYS, isOpenNow } from '../../../vitrine/logic';

const platform: MapsPlatform = Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web';

/** Fiche d'un lieu (restaurant, hôtel, pharmacie, santé, école, service…) : l'essentiel selon le type, puis la vitrine complète. */
export default function PlaceDetail() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const { slug, lat, lng, label } = useLocalSearchParams<{ slug: string; lat?: string; lng?: string; label?: string }>();
  const s = String(slug);
  const [failed, setFailed] = useState(false);
  const q = useQuery({ queryKey: shopKeys.store(s), queryFn: () => fetchStore(s) });

  if (q.isPending) return <SkeletonList rows={4} label={t('common.loading')} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const open = isOpenNow(o.openingHours);
  const hasPos = lat !== undefined && lng !== undefined && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  const hours = o.openingHours ? (
    <Card key="hours" style={{ gap: spacing.xs }}>
      <Text variant="bodyStrong" accessibilityRole="header">
        {t('shop.store.hours')}
      </Text>
      {DAYS.map((d) => {
        const day = o.openingHours?.[d] ?? [];
        return (
          <View key={d} style={styles.row}>
            <Text variant="small" style={styles.flex}>
              {t(`shop.day.${d}` as MessageKey)}
            </Text>
            <Text variant="small" muted>
              {day.length > 0 ? day.map((iv) => `${iv.open}–${iv.close}`).join(', ') : t('shop.store.closed')}
            </Text>
          </View>
        );
      })}
    </Card>
  ) : null;

  const go = async () => {
    try {
      await Linking.openURL(directionsUrl(platform, { lat: Number(lat), lng: Number(lng), label: label ?? o.name }));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: o.name }} />
      <FadeInView>
        <AuthImage contentUrl={o.bannerUrl ?? o.logoUrl} label={o.name} style={styles.banner} />
      </FadeInView>
      <Text variant="title" accessibilityRole="header">
        {o.name}
      </Text>
      <View style={styles.row}>
        <Badge tone="accent" label={t(`vitrine.public.kind.${o.kind}` as MessageKey)} />
        {open === null ? null : <Badge tone={open ? 'primary' : 'neutral'} label={t(open ? 'vitrine.public.open' : 'vitrine.public.closedNow')} />}
        {o.verified ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} accessibilityLabel={t('shop.store.verified')} /> : null}
      </View>
      {o.rating ? (
        <Text variant="small" muted>
          {t('mb.place.rating', { avg: o.rating.average.toFixed(1), n: o.rating.count })}
        </Text>
      ) : null}
      {o.gallery.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {o.gallery.map((f, i) => (
            <AuthImage key={f.id} contentUrl={f.contentUrl} label={t('vitrine.gallery.photo', { n: i + 1 })} style={styles.photo} />
          ))}
        </ScrollView>
      ) : null}
      {o.description ? <Text>{o.description}</Text> : null}
      {[o.address, o.city].filter(Boolean).length > 0 ? (
        <View style={styles.row}>
          <Ionicons name="location-outline" size={18} color={colors.textMuted} />
          <Text variant="small" style={styles.flex} selectable>
            {[o.address, o.city].filter(Boolean).join(', ')}
          </Text>
        </View>
      ) : null}
      {showsHoursFirst(o.kind) ? hours : null}
      <View style={styles.actions}>
        {hasPos ? <Button label={t('places.directions')} onPress={go} /> : null}
        {o.phone ? <Button variant="secondary" label={t('vitrine.public.call')} onPress={() => void Linking.openURL(`tel:${o.phone}`)} /> : null}
        {placeActions(o.kind, o.slug).map((a) => (
          <Button key={a.key} variant="secondary" label={t(a.key)} onPress={() => router.push(a.href as never)} />
        ))}
        <Button variant="ghost" label={t('mb.place.fullPage')} onPress={() => router.push({ pathname: '/store/[slug]', params: { slug: o.slug } })} />
      </View>
      {failed ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
          {t('places.directionsFailed')}
        </Text>
      ) : null}
      {showsHoursFirst(o.kind) ? null : hours}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  photo: { width: 140, height: 100, borderRadius: radius.md },
  banner: { width: '100%', height: 160, borderRadius: radius.lg },
  actions: { gap: spacing.sm },
});
