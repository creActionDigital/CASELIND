import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { MessageKey } from '../i18n';

export type Icon = ComponentProps<typeof Ionicons>['name'];
/** `on` : visible seulement si le drapeau est activé ; `notOff` : visible sauf s'il est désactivé ; absent : toujours. */
export interface ServiceEntry {
  path: string;
  label: MessageKey;
  icon: Icon;
  flag?: string;
  on?: boolean;
  accent?: boolean;
}
export interface ServiceSection {
  title: MessageKey;
  entries: ServiceEntry[];
}

// Portail de l'écosystème : sections (cahier des charges), un drapeau masque les modules réglementés ou coupés.
export const SERVICE_SECTIONS: ServiceSection[] = [
  {
    title: 'ma.more.everyday',
    entries: [
      { path: '/shop', label: 'shop.title', icon: 'bag-handle-outline' },
      { path: '/wishlist', label: 'wish.open', icon: 'heart-outline' },
      { path: '/downloads', label: 'dig.downloads.title', icon: 'download-outline' },
      { path: '/services', label: 'services.title', icon: 'construct-outline' },
      { path: '/listings', label: 'listings.title', icon: 'home-outline', flag: 'listings' },
      { path: '/games', label: 'games.title', icon: 'game-controller-outline', flag: 'games' },
    ],
  },
  {
    title: 'ma.more.travel',
    entries: [
      { path: '/rides', label: 'mobility.title', icon: 'car-sport-outline' },
      { path: '/carpool', label: 'carpool.title', icon: 'people-outline' },
      { path: '/rentals', label: 'rentals.title', icon: 'key-outline' },
      { path: '/roadside', label: 'roadside.title', icon: 'build-outline' },
      { path: '/courier', label: 'courier.title', icon: 'cube-outline' },
    ],
  },
  {
    title: 'ma.more.money',
    entries: [
      { path: '/wallet/finance', label: 'more.finance', icon: 'wallet-outline' },
      { path: '/creator', label: 'creator.tile.dashboard', icon: 'bar-chart-outline' },
      { path: '/premium', label: 'mon.premium.title', icon: 'ribbon-outline' },
      { path: '/ads', label: 'mon.ads.title', icon: 'megaphone-outline' },
      { path: '/bookmarks', label: 'creator.tile.bookmarks', icon: 'bookmark-outline' },
    ],
  },
  {
    title: 'ma.more.learnWork',
    entries: [
      { path: '/education', label: 'education.title', icon: 'school-outline', flag: 'education' },
      { path: '/school', label: 'school.title', icon: 'library-outline', flag: 'school', on: true },
      { path: '/health', label: 'health.title', icon: 'medkit-outline', flag: 'health', on: true },
      { path: '/freelance', label: 'freelance.title', icon: 'laptop-outline', flag: 'freelance' },
      { path: '/jobs', label: 'jobs.title', icon: 'briefcase-outline', flag: 'jobs' },
      { path: '/work', label: 'work.title', icon: 'clipboard-outline' },
    ],
  },
  {
    title: 'ma.more.tools',
    entries: [
      { path: '/ai', label: 'ai.tile', icon: 'sparkles', accent: true },
      { path: '/miniapps', label: 'miniapps.title', icon: 'apps-outline' },
      { path: '/announcements', label: 'ops2.annUser.title', icon: 'megaphone-outline' },
      { path: '/my-sanctions', label: 'ops2.mine.title', icon: 'shield-half-outline' },
      { path: '/help', label: 'ma.help.title', icon: 'help-circle-outline' },
    ],
  },
];

/** Un drapeau masque un module coupé (ou, avec `on`, un module réglementé tant qu'il n'est pas activé). */
export function serviceVisible(e: ServiceEntry, flags: Record<string, boolean> | undefined): boolean {
  if (!e.flag) return true;
  const v = flags?.[e.flag];
  return e.on ? v === true : v !== false;
}
