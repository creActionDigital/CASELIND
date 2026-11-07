import { Stack } from 'expo-router';
import { useI18n } from '../../../i18n';
import { useTheme } from '../../../theme/use-theme';

/** Pile propre à l'espace vendeur (le parent masque son en-tête). Les titres sont posés par chaque écran. */
export default function SellerLayout() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        headerBackTitle: t('common.back'),
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
