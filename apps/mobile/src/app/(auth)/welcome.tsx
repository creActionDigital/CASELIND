import { Ionicons } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useI18n, type Locale, type MessageKey } from '../../i18n';
import { COUNTRIES, countryName } from '../../onboarding/countries';
import { setPrefs, usePrefs } from '../../prefs/store';
import { radius, spacing, TOUCH } from '../../theme/tokens';
import { useTheme } from '../../theme/use-theme';
import { Button, Screen, Text, Wordmark } from '../../ui';
import { useReduceMotion } from '../../ui/premium';
import { pageIndex } from '../../ui/premium/logic';

const LOCALES: Locale[] = ['fr', 'en', 'sw'];
type Icon = ComponentProps<typeof Ionicons>['name'];
const SLIDES: { icon: Icon; title: MessageKey; body: MessageKey }[] = [
  { icon: 'people-outline', title: 'ma.onb.1.title', body: 'ma.onb.1.body' },
  { icon: 'bag-handle-outline', title: 'ma.onb.2.title', body: 'ma.onb.2.body' },
  { icon: 'wallet-outline', title: 'ma.onb.3.title', body: 'ma.onb.3.body' },
];

/** Logo : apparition (fondu) puis léger rebond ; sans animation si « réduire les animations » est actif. */
function AnimatedLogo() {
  const reduce = useReduceMotion();
  const o = useSharedValue(reduce ? 1 : 0);
  const sc = useSharedValue(reduce ? 1 : 0.8);
  useEffect(() => {
    if (reduce) {
      o.value = 1;
      sc.value = 1;
      return;
    }
    o.value = withTiming(1, { duration: 250 });
    sc.value = withSequence(withTiming(1.06, { duration: 250 }), withDelay(40, withSpring(1, { damping: 10, stiffness: 180 })));
  }, [reduce, o, sc]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ scale: sc.value }] }));
  return (
    <Animated.View style={anim}>
      <Wordmark size={28} vertical />
    </Animated.View>
  );
}

/** Premier lancement : bienvenue + langue + pays, puis 3 pages à pagination fluide, une seule fois (mémorisé sur l'appareil). */
export default function Welcome() {
  const { colors } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const prefs = usePrefs();
  const [started, setStarted] = useState(false);
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(0);
  const [country, setCountry] = useState<string | null>(null);
  const list = useRef<FlatList>(null);

  if (!prefs.loaded) {
    return (
      <Screen scroll={false}>
        <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (prefs.onboardingDone) return <Redirect href="/sign-in" />;

  const finish = () => {
    setPrefs({ onboardingDone: true, locale, country: country ?? prefs.country });
    router.replace('/sign-in');
  };
  const last = page === SLIDES.length - 1;
  const next = () => {
    if (last) return finish();
    list.current?.scrollToIndex({ index: page + 1, animated: true });
    setPage(page + 1);
  };

  return (
    <Screen scroll={false}>
      <View style={styles.wrap}>
        <View style={styles.top}>
          <AnimatedLogo />
          {started ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('ma.onb.skip')} onPress={finish} style={styles.skip}>
              <Text variant="small" muted>
                {t('ma.onb.skip')}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {started ? (
          <View style={styles.flex} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
            {width > 0 ? (
              <FlatList
                ref={list}
                data={SLIDES}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={(s) => s.title}
                getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
                onScroll={(e) => setPage(pageIndex(e.nativeEvent.contentOffset.x, width, SLIDES.length))}
                scrollEventThrottle={32}
                renderItem={({ item }) => (
                  <View style={[styles.slide, { width }]}>
                    <View style={[styles.disc, { backgroundColor: colors.primarySoft }]}>
                      <Ionicons name={item.icon} size={56} color={colors.primary} />
                    </View>
                    <Text variant="title" accessibilityRole="header" style={styles.center}>
                      {t(item.title)}
                    </Text>
                    <Text muted style={styles.center}>
                      {t(item.body)}
                    </Text>
                  </View>
                )}
              />
            ) : null}
          </View>
        ) : (
          <ScrollView style={styles.flex} contentContainerStyle={{ gap: spacing.md, paddingVertical: spacing.lg }} showsVerticalScrollIndicator={false}>
            <Text variant="title" accessibilityRole="header" style={styles.center}>
              {t('ma.welcome.title')}
            </Text>
            <Text muted style={styles.center}>
              {t('ma.welcome.sub')}
            </Text>
            <Text variant="bodyStrong">{t('ma.welcome.language')}</Text>
            <View style={styles.chips}>
              {LOCALES.map((l) => (
                <Chip key={l} label={t(`language.${l}`)} selected={locale === l} onPress={() => setLocale(l)} />
              ))}
            </View>
            <Text variant="bodyStrong">{t('ma.welcome.country')}</Text>
            <View style={styles.chips}>
              {COUNTRIES.map((c) => (
                <Chip key={c.code} label={countryName(c.code, locale)} selected={(country ?? prefs.country) === c.code} onPress={() => setCountry(c.code)} />
              ))}
            </View>
          </ScrollView>
        )}

        {started ? (
          <View style={styles.dots} accessibilityLabel={`${page + 1} / ${SLIDES.length}`} accessible>
            {SLIDES.map((s, i) => (
              <View key={s.title} style={[styles.dot, { width: i === page ? 22 : 8, backgroundColor: i === page ? colors.primary : colors.border }]} />
            ))}
          </View>
        ) : null}
        <Button label={!started ? t('ma.welcome.start') : last ? t('ma.onb.done') : t('ma.onb.next')} onPress={() => (started ? next() : setStarted(true))} />
      </View>
    </Screen>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.surface, borderColor: selected ? colors.primary : colors.border }]}
    >
      <Text variant="small" color={selected ? colors.onPrimary : colors.text}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center', gap: spacing.lg },
  top: { alignItems: 'center', paddingTop: spacing.lg },
  skip: { position: 'absolute', right: 0, top: spacing.lg, minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: spacing.md },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl },
  disc: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: TOUCH, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  dot: { height: 8, borderRadius: 4 },
});
