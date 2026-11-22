import { userFlagsSchema } from '@caselind/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hasAdminAccess } from '../admin/console-logic';
import { api, useAuth } from '../auth/auth-context';
import { useI18n, type MessageKey } from '../i18n';
import { alertConfirm } from '../lib/confirm';
import {
  activityEntries,
  DELETE_ACCOUNT_HREF,
  filterEntries,
  helpEntries,
  proEntries,
  securityEntries,
  settingsEntries,
  shortcutEntries,
  type MenuContext,
  type MenuEntry,
} from '../menu/menu-logic';
import { ProfileHeader } from '../menu/ProfileHeader';
import { useUnreadCount } from '../notifications/hooks';
import { fetchPremiumBadge } from '../premium/api';
import { fetchProfile, svcKeys } from '../services/api';
import { useMyOrgs } from '../seller/api';
import { brandAccent, fonts, radius, spacing, TOUCH } from '../theme/tokens';
import { useTheme } from '../theme/use-theme';
import { Badge, IconButton, Text } from '../ui';
import { FadeInView, PressableScale, SectionHeader, ServiceGrid } from '../ui/premium';

type Colors = ReturnType<typeof useTheme>['colors'];
const ICON = 22;

/**
 * Menu « ⋯ » plein écran (à la Facebook) : carte profil, recherche en direct, grille de raccourcis vers tous les services,
 * sections repliables (pro, activité, paramètres et sécurité, aide), puis déconnexion et suppression du compte.
 * La liste des services vient de l'onglet Plus (src/menu/services.ts) ; tout est vérifié contre ROUTES (menu-logic.test.ts).
 */
export function AccountMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { me, signOut } = useAuth();
  const router = useRouter();
  const unread = useUnreadCount();
  const orgs = useMyOrgs().data?.items;
  const provider = useQuery({ queryKey: svcKeys.profile, queryFn: fetchProfile, enabled: visible, retry: false });
  const flags = useQuery({ queryKey: ['flags'], queryFn: () => api.request('/config/flags', { schema: userFlagsSchema }), enabled: visible });
  const premium = useQuery({ queryKey: ['premium-badge', me?.id], queryFn: () => fetchPremiumBadge(me!.id), enabled: visible && !!me?.id, staleTime: 120_000 });
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [more, setMore] = useState(false);

  if (Platform.OS === 'web' && !visible) return null; // react-native-web garde le portail d'une modale refermée pendant une navigation

  const ctx: MenuContext = { flags: flags.data?.flags, orgs, isProvider: !!provider.data, unread, hasAdmin: hasAdminAccess(me?.roles) };
  const label = (k: MessageKey) => t(k);
  const q = query.trim();
  const f = (list: MenuEntry[]) => filterEntries(list, q, label);
  const shortcuts = f(shortcutEntries(ctx.flags));
  const none: MenuEntry[] = [];
  const sections = [
    { id: 'pro', title: t('menu.pro'), icon: 'briefcase-outline' as const, rows: f(proEntries(ctx)), security: none },
    { id: 'activity', title: t('menu.activity'), icon: 'pulse-outline' as const, rows: f(activityEntries(ctx)), security: none },
    { id: 'settings', title: t('menu.settings'), icon: 'settings-outline' as const, rows: f(settingsEntries()), security: f(securityEntries()) },
    { id: 'help', title: t('menu.help'), icon: 'help-buoy-outline' as const, rows: f(helpEntries()), security: none },
  ].filter((s) => !q || s.rows.length + s.security.length > 0);
  const SHOWN = 8;
  const shownShortcuts = q || more ? shortcuts : shortcuts.slice(0, SHOWN);
  const empty = q !== '' && shortcuts.length === 0 && sections.length === 0;

  function close() {
    setQuery('');
    onClose();
  }
  function go(href: string) {
    close();
    router.push(href as never);
  }
  const confirmSignOut = () =>
    alertConfirm(t('signOut.confirmTitle'), t('signOut.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('account.signOut'), style: 'destructive', onPress: () => void signOut() },
    ]);

  const isPremium = premium.data?.premium === true;
  const card = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }];
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.top}>
          <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
            {t('menu.title')}
          </Text>
          <IconButton icon="close" label={t('common.close')} onPress={close} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}>
          <FadeInView>
            {me ? <ProfileHeader userId={me.id} displayName={me.displayName} handle={me.handle} avatarUrl={me.avatarUrl} premium={premium.isSuccess ? isPremium : undefined} go={go} /> : null}
          </FadeInView>

          <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="search-outline" size={ICON - 4} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('menu.search')}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t('menu.search')}
              returnKeyType="search"
              autoCorrect={false}
              style={[styles.input, { color: colors.text, fontFamily: fonts.regular }]}
            />
            {query !== '' ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('menu.clear')} onPress={() => setQuery('')} hitSlop={8} style={styles.clear}>
                <Ionicons name="close-circle" size={20} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          <PressableScale accessibilityLabel={t('mon.premium.title')} onPress={() => go('/premium')} style={[styles.premium, { backgroundColor: `${brandAccent}1F`, borderColor: brandAccent }]}>
            <View style={[styles.iconBox, { backgroundColor: brandAccent }]}>
              <Ionicons name="ribbon" size={ICON} color={colors.onAccent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bold }}>{t('mon.premium.title')}</Text>
              <Text variant="small" muted>
                {t('menu.premiumSub')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={brandAccent} />
          </PressableScale>

          {empty ? (
            <Text muted style={{ textAlign: 'center' }}>
              {t('menu.noResult', { q })}
            </Text>
          ) : null}

          {shortcuts.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              <SectionHeader title={t('menu.shortcuts')} />
              <ServiceGrid items={shownShortcuts.map((s) => ({ id: s.id, icon: s.icon, label: t(s.label), accent: s.accent || undefined, onPress: () => go(s.href) }))} />
            </View>
          ) : null}

          {!q && shortcuts.length > SHOWN ? (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: more }} onPress={() => setMore((v) => !v)} style={[styles.more, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={{ fontFamily: fonts.semibold }}>{more ? t('menu.seeLess') : t('menu.seeMore')}</Text>
              <Ionicons name={more ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text} />
            </Pressable>
          ) : null}

          {sections.map((s) => {
            const expanded = q !== '' || !!open[s.id];
            return (
              <View key={s.id} style={card}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={s.title}
                  accessibilityState={{ expanded }}
                  onPress={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}
                  style={styles.sectionHead}
                >
                  <IconBox icon={s.icon} colors={colors} />
                  <Text variant="heading" style={{ flex: 1 }}>
                    {s.title}
                  </Text>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
                </Pressable>
                {expanded ? (
                  <View style={[styles.rows, { borderTopColor: colors.border }]}>
                    {s.rows.map((r) => (
                      <Row key={r.id} entry={r} colors={colors} onPress={() => go(r.href)} />
                    ))}
                    {s.security.length > 0 ? (
                      <>
                        <Text variant="small" muted accessibilityRole="header" style={styles.group}>
                          {t('security.menu.section')}
                        </Text>
                        {s.security.map((r) => (
                          <Row key={r.id} entry={r} colors={colors} onPress={() => go(r.href)} />
                        ))}
                      </>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}

          {!q ? (
            <View style={card}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('account.signOut')} onPress={confirmSignOut} style={styles.bottomRow}>
                <Ionicons name="log-out-outline" size={ICON} color={colors.danger} />
                <Text color={colors.danger} style={{ flex: 1, fontFamily: fonts.semibold }}>
                  {t('account.signOut')}
                </Text>
              </Pressable>
              <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('menu.deleteAccount')} onPress={() => go(DELETE_ACCOUNT_HREF)} style={styles.bottomRow}>
                  <Ionicons name="trash-outline" size={ICON} color={colors.danger} />
                  <Text color={colors.danger} style={{ flex: 1 }}>
                    {t('menu.deleteAccount')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function IconBox({ icon, accent, colors }: { icon: MenuEntry['icon']; accent?: boolean; colors: Colors }) {
  return (
    <View style={[styles.iconBox, { backgroundColor: accent ? `${brandAccent}22` : colors.primarySoft }]}>
      <Ionicons name={icon} size={ICON} color={accent ? brandAccent : colors.primary} />
    </View>
  );
}

function Row({ entry, colors, onPress }: { entry: MenuEntry; colors: Colors; onPress: () => void }) {
  const { t } = useI18n();
  const name = t(entry.label);
  const badge = entry.badge ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge > 0 ? `${name}, ${t('notifications.unreadCount', { n: badge })}` : name}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      <IconBox icon={entry.icon} accent={entry.accent} colors={colors} />
      <Text style={{ flex: 1 }}>{name}</Text>
      {badge > 0 ? <Badge label={badge > 99 ? '99+' : String(badge)} tone="accent" /> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, minHeight: TOUCH + spacing.sm },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.lg, maxWidth: 640, width: '100%', alignSelf: 'center' },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, minHeight: TOUCH },
  input: { flex: 1, fontSize: 15, minHeight: TOUCH, paddingVertical: 0 },
  clear: { minWidth: 32, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' },
  premium: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: TOUCH + spacing.xl, borderRadius: radius.lg, borderWidth: 1 },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: TOUCH, borderRadius: radius.md },
  iconBox: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: TOUCH + spacing.md },
  rows: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH + spacing.sm },
  group: { marginTop: spacing.md, marginBottom: spacing.xs },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH + spacing.sm, paddingHorizontal: spacing.md },
});
