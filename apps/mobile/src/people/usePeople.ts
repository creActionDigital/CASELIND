import { matchContactsResponseSchema } from '@caselind/contracts';
import { useQuery } from '@tanstack/react-query';
import * as Contacts from 'expo-contacts';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { api, useAuth } from '../auth/auth-context';
import { fetchConversations } from '../messaging/api';
import { fetchSearch, useDebouncedValue } from '../search/api';
import { fetchFollowers, fetchFollowing } from '../social/api';
import { fetchTransactions } from '../wallet/api';
import { useWalletPrefs } from '../wallet/prefs';
import { buildSections, dedupe, phonesToMatch, type Person, type Sections } from './logic';

export type PhoneAccess = 'unsupported' | 'unknown' | 'granted' | 'denied';
const STALE = 5 * 60_000;

async function matchPhoneBook(country?: string): Promise<Person[]> {
  const res = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });
  const raw = res.data.flatMap((c) => (c.phoneNumbers ?? []).map((n) => n.number ?? ''));
  const phones = phonesToMatch(raw, country);
  if (phones.length === 0) return [];
  // Les numéros ne sont envoyés qu'à cette route, qui ne les conserve pas.
  const out = await api.request('/users/match-contacts', { method: 'POST', body: { phones }, schema: matchContactsResponseSchema });
  return out.items.map((u) => ({ id: u.id, handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl }));
}

/** Charge les sources du sélecteur (cache React Query) et les fusionne selon la saisie. */
export function usePeople(query: string, enabled: boolean) {
  const { me } = useAuth();
  const prefs = useWalletPrefs();
  const [access, setAccess] = useState<PhoneAccess>(Platform.OS === 'web' ? 'unsupported' : 'unknown');
  const q = useDebouncedValue(query.trim().replace(/^@/, ''), 300);

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    void Contacts.getPermissionsAsync().then((r) => setAccess(r.granted ? 'granted' : r.canAskAgain ? 'unknown' : 'denied')).catch(() => setAccess('denied'));
  }, [enabled]);

  const askContacts = useCallback(async () => {
    try {
      const r = await Contacts.requestPermissionsAsync();
      setAccess(r.granted ? 'granted' : 'denied');
    } catch {
      setAccess('denied');
    }
  }, []);

  const base = { enabled: enabled && !!me, staleTime: STALE, retry: false } as const;
  const convs = useQuery({ queryKey: ['people', 'convs'], queryFn: () => fetchConversations(false), ...base });
  const tx = useQuery({ queryKey: ['people', 'tx', prefs.currency], queryFn: () => fetchTransactions(prefs.currency), ...base });
  const following = useQuery({ queryKey: ['people', 'following', me?.id], queryFn: () => fetchFollowing(me!.id), ...base });
  const followers = useQuery({ queryKey: ['people', 'followers', me?.id], queryFn: () => fetchFollowers(me!.id), ...base });
  const phone = useQuery({ queryKey: ['people', 'phone', me?.id], queryFn: () => matchPhoneBook(me?.country ?? undefined), ...base, enabled: base.enabled && access === 'granted' });
  const found = useQuery({
    queryKey: ['people', 'search', q],
    queryFn: () => fetchSearch(q, 'users'),
    ...base,
    enabled: base.enabled && q.length >= 2,
    staleTime: 60_000,
  });

  const recent: Person[] = dedupe([
    ...(convs.data?.items ?? []).filter((c) => c.kind === 'direct' && c.peer).map((c) => ({ id: c.peer!.userId, handle: c.peer!.handle, displayName: c.peer!.displayName, avatarUrl: c.peer!.avatarUrl })),
    ...(tx.data?.items ?? []).flatMap((x) => (x.counterparty?.kind === 'user' ? [{ id: x.counterparty.userId, handle: x.counterparty.handle, displayName: x.counterparty.displayName }] : [])),
  ]).slice(0, 12);
  const sources: Sections = {
    recent,
    phone: phone.data ?? [],
    following: (following.data?.items ?? []).map((u) => ({ id: u.userId, handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl })),
    followers: (followers.data?.items ?? []).map((u) => ({ id: u.userId, handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl })),
    search: (found.data?.users?.items ?? []).map((u) => ({ id: u.id, handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl })),
  };
  return {
    sections: buildSections(sources, query, me?.handle),
    access,
    askContacts,
    searching: q.length >= 2 && (found.isFetching || q !== query.trim().replace(/^@/, '')),
    loading: convs.isPending && following.isPending,
    phoneLoading: phone.isFetching,
  };
}
