import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { brandAccent } from '../../theme/tokens';
import { setPrefs } from '../../prefs/store';
import { useTheme } from '../../theme/use-theme';
import { Button, Screen, Text } from '../../ui';
import {
  ActionCircle, AnimatedSheet, BottomActionBar, Chip, ChipRow, EmptyIllustration, FadeInView, HeroBalance, PressableScale,
  ProgressBar, PromoBanner, SectionHeader, ServiceTile, Skeleton, SkeletonList, StatCard,
} from '../../ui/premium';

/** Démonstration interne du socle premium (aucun lien depuis l'application : accès par /ui-kit). */
export default function UiKit() {
  const { isDark } = useTheme();
  const [sel, setSel] = useState('all');
  const [sheet, setSheet] = useState(false);
  const noop = () => {};
  return (
    <>
      <Stack.Screen options={{ title: 'UI kit' }} />
      <Screen edges={['bottom']}>
        <View style={{ gap: 20, paddingBottom: 16 }}>
          <Button label={isDark ? 'Passer en clair' : 'Passer en sombre'} variant="secondary" onPress={() => setPrefs({ theme: isDark ? 'light' : 'dark' })} />

          <FadeInView index={0}>
            <HeroBalance label="Solde" amount="1 250,00 USD" showLabel="Afficher le solde" hideLabel="Masquer le solde" />
          </FadeInView>
          <FadeInView index={1} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <ActionCircle icon="add" label="Ajouter" filled onPress={noop} />
            <ActionCircle icon="paper-plane-outline" label="Envoyer" onPress={noop} />
            <ActionCircle icon="download-outline" label="Recevoir" onPress={noop} />
            <ActionCircle icon="ellipsis-horizontal" label="Plus" onPress={noop} />
          </FadeInView>

          <SectionHeader title="Services" actionLabel="Voir tout" onAction={noop} />
          <FadeInView index={2} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <ServiceTile icon="qr-code-outline" label="Scanner" onPress={noop} />
            <ServiceTile icon="car-outline" label="Course" onPress={noop} />
            <ServiceTile icon="bicycle-outline" label="Livraison" tint={brandAccent} onPress={noop} />
            <ServiceTile icon="apps-outline" label="Mini-apps" badge={3} onPress={noop} />
          </FadeInView>

          <PromoBanner items={[
            { id: 'a', title: 'Offre de bienvenue', subtitle: 'Découvrez le marché', icon: 'gift' },
            { id: 'b', title: 'Covoiturage', subtitle: 'Voyagez malin', icon: 'car', color: brandAccent },
            { id: 'c', title: 'Mini-apps', icon: 'apps' },
          ]} />

          <ChipRow>
            {['all', 'food', 'tech', 'mode'].map((k) => <Chip key={k} label={k} selected={sel === k} onPress={() => setSel(k)} />)}
          </ChipRow>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <StatCard label="Ventes" value="248" deltaPct={12} />
            <StatCard label="Retours" value="6" deltaPct={-3.2} />
          </View>
          <ProgressBar value={0.65} label="Objectif d'épargne" />

          <PressableScale onPress={noop} accessibilityLabel="Carte pressable"><Text variant="bodyStrong">Appuyez : enfoncement animé</Text></PressableScale>

          <Skeleton height={20} width="60%" />
          <SkeletonList rows={2} />
          <EmptyIllustration title="Rien ici pour l'instant" body="Les éléments apparaîtront ici." actionLabel="Explorer" onAction={noop} />
          <Button label="Ouvrir la feuille" variant="secondary" onPress={() => setSheet(true)} />
        </View>
      </Screen>
      <BottomActionBar label="Continuer" onPress={noop} leading={<Text variant="bodyStrong">25 USD</Text>} />
      <AnimatedSheet visible={sheet} onClose={() => setSheet(false)} title="Feuille">
        <Text variant="heading">Feuille basse</Text>
        <Text muted>Glissez vers le bas pour fermer.</Text>
        <Button label="Fermer" onPress={() => setSheet(false)} />
      </AnimatedSheet>
    </>
  );
}
