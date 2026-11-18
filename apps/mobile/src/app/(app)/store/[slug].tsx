import { Ionicons } from '@expo/vector-icons';
import type { OpeningHours, PublicOrg } from '@caselind/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useI18n, type MessageKey } from '../../../i18n';
import { fetchStore, fetchStoreProducts } from '../../../shop/api';
import { shopKeys } from '../../../shop/hooks';
import { ContactSeller } from '../../../shop/ContactSeller';
import { ProductGrid } from '../../../shop/ProductGrid';
import { radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { AuthImage, Avatar, Button, ErrorState, Text } from '../../../ui';
import { DAYS, isOpenNow } from '../../../vitrine/logic';

/** Organisations dont la vitrine présente d'abord un catalogue : sans produit on garde le message « rien en vente ». */
const SELLING_KINDS: readonly PublicOrg['kind'][] = ['shop', 'restaurant', 'pharmacy'];

/**
 * Vitrine publique d'une organisation (CDC §5), comme un mini-site : bannière, logo, nom, type, ouverture,
 * boutons d'action, coordonnées, horaires, zones, sections libres, liens, produits et questions fréquentes.
 */
export default function StoreScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const s = String(slug);

  const store = useQuery({ queryKey: shopKeys.store(s), queryFn: () => fetchStore(s) });
  const products = useInfiniteQuery({
    queryKey: shopKeys.storeProducts(s),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchStoreProducts(s, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  if (store.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  if (store.isError) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <ErrorState error={store.error} onRetry={() => store.refetch()} />
      </View>
    );
  }
  const o = store.data;
  const selling = SELLING_KINDS.includes(o.kind);
  const hasProducts = (products.data?.pages[0]?.items.length ?? 0) > 0;
  const open = isOpenNow(o.openingHours);

  const header = (
    <View style={styles.header}>
      <View style={styles.bannerWrap}>
        <AuthImage contentUrl={o.bannerUrl} label={o.name} style={styles.banner} />
        <View style={[styles.logoWrap, { borderColor: colors.background, backgroundColor: colors.background }]}>
          {o.logoUrl ? <AuthImage contentUrl={o.logoUrl} label={o.name} style={styles.logo} /> : <Avatar name={o.name} size={72} />}
        </View>
      </View>
      <View style={styles.nameRow}>
        <Text variant="title" accessibilityRole="header" style={styles.flex} numberOfLines={2}>
          {o.name}
        </Text>
        {o.verified ? (
          <View style={styles.verified} accessible accessibilityLabel={t('shop.store.verified')}>
            <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
          </View>
        ) : null}
      </View>
      <Text muted>
        {t(`vitrine.public.kind.${o.kind}` as MessageKey)}
        {o.city ? ` · ${o.city}${o.country ? `, ${o.country}` : ''}` : ''}
        {open === null ? '' : ` · ${t(open ? 'vitrine.public.open' : 'vitrine.public.closedNow')}`}
      </Text>
      {o.description ? <Text>{o.description}</Text> : null}

      <View style={styles.actions}>
        {o.phone ? <Action label={t('vitrine.public.call')} onPress={() => Linking.openURL(`tel:${o.phone}`)} /> : null}
        {o.email ? <Action label={t('vitrine.public.email')} onPress={() => Linking.openURL(`mailto:${o.email}`)} /> : null}
        {o.website ? <Action label={t('vitrine.public.website')} onPress={() => Linking.openURL(o.website!)} /> : null}
      </View>
      <ContactSeller contactUserId={o.contactUserId} />

      {o.address || o.phone || o.email || o.website ? (
        <Block title={t('vitrine.public.contact')}>
          {o.address ? <Info icon="location-outline" text={[o.address, o.city].filter(Boolean).join(', ')} /> : null}
          {o.phone ? <Info icon="call-outline" text={o.phone} /> : null}
          {o.email ? <Info icon="mail-outline" text={o.email} /> : null}
          {o.website ? <Info icon="globe-outline" text={o.website} /> : null}
        </Block>
      ) : null}
      {o.openingHours ? <Hours hours={o.openingHours} /> : null}
      {o.page.serviceAreas.length > 0 ? (
        <Block title={t('vitrine.public.areas')}>
          <Text>{o.page.serviceAreas.join(' · ')}</Text>
        </Block>
      ) : null}
      {o.page.sections.map((sec, i) => (
        <Block key={i} title={sec.title}>
          <Text>{sec.body}</Text>
        </Block>
      ))}
      {o.page.links.length > 0 ? (
        <Block title={t('vitrine.public.links')}>
          {o.page.links.map((l, i) => (
            <Pressable key={i} accessibilityRole="link" accessibilityLabel={l.label} onPress={() => Linking.openURL(l.url)} style={styles.link}>
              <Ionicons name="link-outline" size={18} color={colors.primary} />
              <Text color={colors.primary} style={styles.flex} numberOfLines={1}>
                {l.label}
              </Text>
            </Pressable>
          ))}
        </Block>
      ) : null}
      {selling || hasProducts ? (
        <Text variant="heading" accessibilityRole="header" style={{ marginTop: spacing.sm }}>
          {t('shop.store.products')}
        </Text>
      ) : null}
    </View>
  );

  const footer = o.page.faq.length > 0 ? (
    <Block title={t('vitrine.public.faq')}>
      {o.page.faq.map((q, i) => (
        <Faq key={i} question={q.question} answer={q.answer} />
      ))}
    </Block>
  ) : undefined;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: o.name }} />
      <ProductGrid query={products} header={header} footer={footer} hideWhenEmpty={!selling} emptyTitle={t('shop.store.emptyTitle')} emptyBody={t('shop.store.emptyBody')} />
    </View>
  );
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return <Button variant="secondary" label={label} onPress={onPress} />;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.block, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text variant="bodyStrong" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Info({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.dayRow}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text variant="small" style={styles.flex} selectable>
        {text}
      </Text>
    </View>
  );
}

function Faq({ question, answer }: { question: string; answer: string }) {
  const { colors } = useTheme();
  const [openQ, setOpenQ] = useState(false);
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: openQ }} onPress={() => setOpenQ((v) => !v)} style={styles.faqRow}>
        <Text variant="bodyStrong" style={styles.flex}>
          {question}
        </Text>
        <Ionicons name={openQ ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
      </Pressable>
      {openQ ? <Text muted>{answer}</Text> : null}
    </View>
  );
}

function Hours({ hours }: { hours: OpeningHours }) {
  const { t } = useI18n();
  return (
    <Block title={t('shop.store.hours')}>
      {DAYS.map((d) => {
        const day = hours[d] ?? [];
        return (
          <View key={d} style={styles.dayRow}>
            <Text variant="small" style={styles.flex}>
              {t(`shop.day.${d}` as MessageKey)}
            </Text>
            <Text variant="small" muted>
              {day.length > 0 ? day.map((iv) => `${iv.open}–${iv.close}`).join(', ') : t('shop.store.closed')}
            </Text>
          </View>
        );
      })}
    </Block>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { gap: spacing.sm },
  bannerWrap: { marginBottom: 36 },
  banner: { width: '100%', height: 140, borderRadius: radius.lg },
  logoWrap: { position: 'absolute', left: spacing.md, bottom: -36, borderWidth: 4, borderRadius: radius.pill, overflow: 'hidden' },
  logo: { width: 72, height: 72, borderRadius: radius.pill },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  verified: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  block: { padding: spacing.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, gap: spacing.xs },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TOUCH },
  faqRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: TOUCH },
});
