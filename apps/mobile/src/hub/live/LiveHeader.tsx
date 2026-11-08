import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '../../i18n';
import { glass, onMedia, TOUCH } from '../../theme/tokens';
import { Avatar, Text } from '../../ui';
import { formatCount } from '../logic';
import type { LiveHost } from './types';

/** Puce du vendeur (avatar, nom, badge vérifié, abonnés) et compteur de spectateurs. */
export function LiveHeader({ host, viewers }: { host: LiveHost; viewers: number }) {
  const { t, locale } = useI18n();
  return (
    <View style={styles.row}>
      <View style={styles.chip} accessible accessibilityLabel={`${host.name}, ${t('live.followers', { n: formatCount(host.followers, locale) })}`}>
        <Avatar name={host.name} size={40} />
        <View style={styles.flex}>
          <View style={styles.name}>
            <Text variant="bodyStrong" color={onMedia} numberOfLines={1} style={styles.flex}>
              {host.name}
            </Text>
            {host.verified ? <Ionicons name="checkmark-circle" size={16} color="#5AA9FF" accessibilityLabel={t('live.verified')} /> : null}
          </View>
          <View style={styles.name}>
            <Ionicons name="person-outline" size={12} color={onMedia} />
            <Text variant="caption" color={onMedia}>
              {formatCount(host.followers, locale)}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.viewers} accessible accessibilityLabel={t('live.viewers', { n: formatCount(viewers, locale) })}>
        <Ionicons name="eye-outline" size={18} color={onMedia} />
        <Text variant="bodyStrong" color={onMedia}>
          {formatCount(viewers, locale)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: '70%',
    minHeight: TOUCH + 8,
    paddingVertical: 6,
    paddingLeft: 8,
    paddingRight: 16,
    borderRadius: 999,
    backgroundColor: glass.dark,
    borderWidth: 1,
    borderColor: glass.border,
  },
  flex: { flexShrink: 1 },
  name: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  viewers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: TOUCH,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: glass.dark,
    borderWidth: 1,
    borderColor: glass.border,
  },
});
