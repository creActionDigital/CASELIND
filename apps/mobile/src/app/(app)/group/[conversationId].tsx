import type { ConversationMember, ConversationRole } from '@caselind/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { api, useAuth } from '../../../auth/auth-context';
import { SheetModal } from '../../../components/SheetModal';
import { useI18n, type MessageKey } from '../../../i18n';
import { errorMessage } from '../../../lib/errors';
import { fetchConversation, fetchMembers, lookupHandle, startChatErrorKey } from '../../../messaging/api';
import { qk } from '../../../messaging/keys';
import { radius, spacing, TOUCH } from '../../../theme/tokens';
import { useTheme } from '../../../theme/use-theme';
import { Avatar, Button, ErrorState, Screen, Text, TextField } from '../../../ui';

const ROLES: ConversationRole[] = ['owner', 'admin', 'member'];

/** Infos du groupe : titre, annonce, membres, ajout par @handle, retrait, rôles, quitter. */
export default function GroupInfo() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const id = String(conversationId);
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const conv = useQuery({ queryKey: qk.conversation(id), queryFn: () => fetchConversation(id) });
  const members = useQuery({ queryKey: qk.members(id), queryFn: () => fetchMembers(id) });

  const [title, setTitle] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<ConversationMember | null>(null);
  const [leaving, setLeaving] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.conversation(id) });
    void qc.invalidateQueries({ queryKey: qk.members(id) });
    void qc.invalidateQueries({ queryKey: qk.conversationsAll });
  };
  function explain(err: unknown) {
    const key = startChatErrorKey(err);
    return key ? t(key) : errorMessage(err, t, locale);
  }
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err) => setError(explain(err)),
  });

  if (conv.isPending || members.isPending) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </Screen>
    );
  }
  if (conv.isError || members.isError) {
    return (
      <Screen edges={['bottom']}>
        <ErrorState error={conv.error ?? members.error} onRetry={() => (conv.isError ? conv.refetch() : members.refetch())} />
      </Screen>
    );
  }

  const c = conv.data;
  const myRole = c.myRole;
  const canManage = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';
  const titleValue = title ?? c.title ?? '';
  const announcementValue = announcement ?? c.announcement ?? '';

  async function addMember() {
    const h = handle.trim();
    if (!h) return;
    setError(null);
    try {
      const user = await lookupHandle(h);
      await api.request(`/conversations/${id}/members`, { method: 'POST', body: { userIds: [user.id] } });
      setHandle('');
      refresh();
    } catch (err) {
      setError(explain(err));
    }
  }

  const canActOn = (m: ConversationMember) => m.userId !== me?.id && (isOwner || (myRole === 'admin' && m.role !== 'owner'));

  return (
    <Screen edges={['bottom']}>
      <Text variant="title" accessibilityRole="header" style={styles.gap}>
        {c.title}
      </Text>
      {error ? (
        <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite" style={styles.gap}>
          {error}
        </Text>
      ) : null}

      {canManage ? (
        <>
          <TextField label={t('group.title')} value={titleValue} onChangeText={setTitle} maxLength={100} />
          <TextField label={t('group.announcement')} value={announcementValue} onChangeText={setAnnouncement} multiline maxLength={1000} />
          <Button
            label={t('common.save')}
            loading={run.isPending}
            disabled={title === null && announcement === null}
            onPress={() =>
              run.mutate(async () => {
                await api.request(`/conversations/${id}`, {
                  method: 'PATCH',
                  body: {
                    ...(title !== null && title.trim() ? { title: title.trim() } : {}),
                    ...(announcement !== null ? { announcement: announcement.trim() || null } : {}),
                  },
                });
                setTitle(null);
                setAnnouncement(null);
              })
            }
          />
        </>
      ) : c.announcement ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text variant="small" muted>
            {t('group.announcement')}
          </Text>
          <Text>{c.announcement}</Text>
        </View>
      ) : null}

      <Text variant="heading" accessibilityRole="header" style={styles.section}>
        {t('group.members', { n: c.memberCount })}
      </Text>
      {canManage ? (
        <View style={styles.add}>
          <View style={styles.flex}>
            <TextField
              label={t('group.addMember')}
              hint={t('chat.new.handleHint')}
              value={handle}
              onChangeText={setHandle}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={addMember}
            />
          </View>
          <Button label={t('group.add')} onPress={addMember} style={styles.addBtn} />
        </View>
      ) : null}

      {members.data.items.map((m) => (
        <View key={m.userId} style={[styles.member, { borderBottomColor: colors.border }]}>
          <Avatar name={m.displayName} size={40} />
          <View style={styles.flex}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {m.displayName}
              {m.userId === me?.id ? ` (${t('chat.you')})` : ''}
            </Text>
            <Text variant="small" muted numberOfLines={1}>
              @{m.handle} · {t(`group.role.${m.role}` as MessageKey)}
            </Text>
          </View>
          {canActOn(m) ? (
            <Button
              label={t('group.manage')}
              accessibilityLabel={t('group.manageA11y', { name: m.displayName })}
              variant="ghost"
              onPress={() => setTarget(m)}
              style={styles.manage}
            />
          ) : null}
        </View>
      ))}

      <Button variant="danger" label={t('group.leave')} onPress={() => setLeaving(true)} style={{ marginTop: spacing.xl }} />

      <SheetModal visible={!!target} onClose={() => setTarget(null)}>
        {target ? (
          <View style={{ gap: spacing.sm }}>
            <Text variant="heading" accessibilityRole="header">
              {target.displayName}
            </Text>
            {isOwner
              ? ROLES.filter((r) => r !== target.role).map((r) => (
                  <Button
                    key={r}
                    variant="secondary"
                    label={t('group.makeRole', { role: t(`group.role.${r}` as MessageKey) })}
                    onPress={() => {
                      const uid = target.userId;
                      setTarget(null);
                      run.mutate(() => api.request(`/conversations/${id}/members/${uid}`, { method: 'PATCH', body: { role: r } }));
                    }}
                  />
                ))
              : null}
            <Button
              variant="danger"
              label={t('group.remove')}
              onPress={() => {
                const uid = target.userId;
                setTarget(null);
                run.mutate(() => api.request(`/conversations/${id}/members/${uid}`, { method: 'DELETE' }));
              }}
            />
            <Button variant="ghost" label={t('common.cancel')} onPress={() => setTarget(null)} />
          </View>
        ) : null}
      </SheetModal>

      <SheetModal visible={leaving} onClose={() => setLeaving(false)}>
        <View style={{ gap: spacing.md }}>
          <Text variant="heading" accessibilityRole="header">
            {t('group.leaveConfirmTitle')}
          </Text>
          <Text muted>{t('group.leaveConfirmBody')}</Text>
          <Button
            variant="danger"
            label={t('group.leave')}
            onPress={async () => {
              setLeaving(false);
              try {
                await api.request(`/conversations/${id}/members/${me?.id}`, { method: 'DELETE' });
                void qc.invalidateQueries({ queryKey: qk.conversationsAll });
                router.dismissAll();
              } catch (err) {
                setError(explain(err));
              }
            }}
          />
          <Button variant="secondary" label={t('common.cancel')} onPress={() => setLeaving(false)} />
        </View>
      </SheetModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { marginBottom: spacing.md },
  section: { marginTop: spacing.xl, marginBottom: spacing.sm },
  card: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  add: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  addBtn: { marginTop: 22, paddingHorizontal: spacing.lg },
  member: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH + 12, borderBottomWidth: StyleSheet.hairlineWidth },
  manage: { paddingHorizontal: spacing.md },
});
