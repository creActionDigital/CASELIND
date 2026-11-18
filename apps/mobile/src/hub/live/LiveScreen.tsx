import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n';
import { Text } from '../../ui';
import { GlassButton, HubTabs } from '../HubTabs';
import { LiveChatOverlay } from './LiveChatOverlay';
import { LiveComposer } from './LiveComposer';
import { LiveHeader } from './LiveHeader';
import { LiveProductRail } from './LiveProductRail';
import type { LiveProduct, LiveSession } from './types';

interface Props {
  session: LiveSession;
  /** Zone vidéo : un flux réel plus tard ; sinon un fond uni est affiché. */
  video?: ReactNode;
  banner?: string;
  onBack: () => void;
  onSearch: () => void;
  onSelectTab: (index: number) => void;
  onSend: (text: string) => void;
  onClose: () => void;
  onProductPress?: (p: LiveProduct) => void;
}

/** Mise en page d'un live plein écran ; ne connaît pas la source des données. */
export function LiveScreen({ session, video, banner, onBack, onSearch, onSelectTab, onSend, onClose, onProductPress }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill}>
        {video ?? (
          <View style={styles.placeholder}>
            <Ionicons name="videocam-outline" size={64} color="rgba(255,255,255,0.25)" />
          </View>
        )}
      </View>
      <HubTabs
        active={0}
        onSelect={(i) => (i === 0 ? undefined : onSelectTab(i))}
        left={<GlassButton icon="chevron-back" label={t('common.back')} onPress={onBack} />}
        right={<GlassButton icon="search" label={t('hub.search')} onPress={onSearch} />}
      />
      <View style={[styles.body, { paddingTop: insets.top + 72 }]} pointerEvents="box-none">
        {banner ? (
          <View style={styles.banner} accessibilityRole="alert">
            <Text variant="caption" color="#1A1200" style={styles.bannerText}>
              {banner}
            </Text>
          </View>
        ) : null}
        <LiveHeader host={session.host} viewers={session.viewers} />
        <View style={styles.mid} pointerEvents="box-none">
          <View style={styles.chat}>
            <LiveChatOverlay comments={session.comments} />
          </View>
          <LiveProductRail products={session.products} onPress={onProductPress} />
        </View>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.composer, { paddingBottom: insets.bottom + 12 }]}>
          <LiveComposer onSend={onSend} onClose={onClose} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#14141B', justifyContent: 'flex-end' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A2A36' },
  body: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, paddingBottom: 96, gap: 8 },
  banner: { marginHorizontal: 12, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#FACC15', alignItems: 'center' },
  bannerText: { fontWeight: '700' },
  mid: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12 },
  chat: { flex: 1, minWidth: 0, paddingRight: 4 },
  composer: { paddingHorizontal: 12, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.4)' },
});
