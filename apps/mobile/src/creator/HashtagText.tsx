import { useRouter } from 'expo-router';
import { Text as RNText } from 'react-native';
import { useI18n } from '../i18n';
import { useTheme } from '../theme/use-theme';
import { Text } from '../ui';
import { splitHashtags } from './logic';

type TextProps = Parameters<typeof Text>[0];

/** Texte de publication dont les #hashtags ouvrent l'écran du hashtag. Le reste du texte est inchangé. */
export function HashtagText({ children, ...rest }: Omit<TextProps, 'children'> & { children: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Text {...rest}>
      {splitHashtags(children).map((part, i) =>
        part.tag ? (
          <RNText
            key={i}
            accessibilityRole="link"
            accessibilityLabel={t('creator.hashtag.open', { tag: `#${part.tag}` })}
            onPress={() => router.push({ pathname: '/hashtag/[tag]', params: { tag: part.tag! } })}
            style={{ color: colors.primary, fontWeight: '600' }}
          >
            {part.text}
          </RNText>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}
