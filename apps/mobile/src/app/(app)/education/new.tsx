import type { CourseLevel } from '@caselind/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { createCourse, eduKeys } from '../../../education/api';
import { COURSE_LEVELS, levelKey } from '../../../education/logic';
import { useI18n } from '../../../i18n';
import { ApiRequestError } from '../../../lib/api';
import { errorMessage } from '../../../lib/errors';
import { Chips } from '../../../seller/ui';
import { spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Button, Screen, Text, TextField } from '../../../ui';

const LANGUAGES = ['fr', 'en', 'sw', 'ln'] as const;

/** Créer un cours (brouillon) ; leçons et quiz s'ajoutent ensuite dans l'atelier. */
export default function NewCourse() {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<CourseLevel>('beginner');
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>('fr');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createCourse({ title: title.trim(), description: description.trim(), level, language }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: eduKeys.all });
      router.replace({ pathname: '/education/edit/[id]', params: { id: c.id } });
    },
    onError: (e) => setError(e instanceof ApiRequestError && e.status === 400 ? t('education.err.invalid') : errorMessage(e, t, locale)),
  });

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('education.new') }} />
      <View style={styles.form}>
        <TextField label={t('education.field.title')} value={title} onChangeText={setTitle} maxLength={120} />
        <TextField label={t('education.field.description')} value={description} onChangeText={setDescription} multiline maxLength={4000} />
        <Chips options={COURSE_LEVELS.map((l) => ({ value: l, label: t(levelKey(l)) }))} value={level} onChange={setLevel} />
        <Chips options={LANGUAGES.map((l) => ({ value: l, label: l.toUpperCase() }))} value={language} onChange={setLanguage} scroll={false} />
        {error ? (
          <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button label={t('education.create')} loading={create.isPending} disabled={title.trim().length < 3} onPress={() => create.mutate()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ form: { gap: spacing.md } });
