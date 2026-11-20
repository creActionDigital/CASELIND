import { View } from 'react-native';
import { useAuth } from '../auth/auth-context';
import { useI18n } from '../i18n';
import { spacing } from '../theme/tokens';
import { Button } from '../ui';
import MySanctions from './(app)/my-sanctions';

/** Session restreinte (compte suspendu ou banni) : seules les sanctions, le recours et la déconnexion répondent. */
export default function Restricted() {
  const { t } = useI18n();
  const { signOut } = useAuth();
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <MySanctions />
      </View>
      <View style={{ padding: spacing.lg }}>
        <Button variant="secondary" label={t('account.signOut')} onPress={() => void signOut()} />
      </View>
    </View>
  );
}
