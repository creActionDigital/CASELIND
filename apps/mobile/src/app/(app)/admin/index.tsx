import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { cck, fetchPendingCount } from '../../../admin/console-api';
import { countLabel, hasAdminAccess, visibleTiles, type AdminTile } from '../../../admin/console-logic';
import { useAuth } from '../../../auth/auth-context';
import { useI18n, type MessageKey } from '../../../i18n';
import { groupTiles } from '../../../messaging/module-d-logic';
import { radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Badge, EmptyState, Screen, Text } from '../../../ui';

function Tile({ tile }: { tile: AdminTile }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const kind = tile.count;
  // Un échec (403, route désactivée) ne bloque pas le hub : la tuile s'affiche sans compteur.
  const count = useQuery({ queryKey: cck.list('count', kind ?? ''), queryFn: () => fetchPendingCount(kind!), enabled: !!kind, retry: false });
  const label = t(`adm.tile.${tile.id}` as MessageKey);
  const n = count.data;
  const pending = n && n.n > 0 ? t('adm.hub.pending', { n: countLabel(n.n, n.more) }) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pending ? `${label}, ${pending}` : label}
      onPress={() => router.push(tile.route as never)}
      style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, borderColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
    >
      <Ionicons name={tile.icon} size={26} color={colors.primary} />
      <Text variant="small" style={{ textAlign: 'center', fontWeight: '600' }}>{label}</Text>
      {n && n.n > 0 ? <Badge tone="accent" label={countLabel(n.n, n.more)} /> : null}
    </Pressable>
  );
}

/** Hub d'administration : rubriques visibles selon le rôle plateforme ; le serveur reste la référence (403 dans chaque écran). */
export default function AdminHub() {
  const { t } = useI18n();
  const { me } = useAuth();
  const tiles = visibleTiles(me?.roles);
  return (
    <Screen>
      <Stack.Screen options={{ title: t('adm.hub.title') }} />
      <Text variant="title" accessibilityRole="header">{t('adm.hub.title')}</Text>
      <Text muted style={{ marginBottom: spacing.lg }}>{t('adm.hub.intro')}</Text>
      {hasAdminAccess(me?.roles) ? (
        groupTiles(tiles).map((g) => (
          <View key={g.section} style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
            <Text variant="bodyStrong" accessibilityRole="header">{t(`md.adm.sec.${g.section}` as MessageKey)}</Text>
            <View style={styles.grid}>{g.tiles.map((tile) => <Tile key={tile.id} tile={tile} />)}</View>
          </View>
        ))
      ) : (
        <EmptyState icon="lock-closed-outline" title={t('adm.hub.none')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { width: '30%', flexGrow: 1, minHeight: 104, borderWidth: 1, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.sm },
});
