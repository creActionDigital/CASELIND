/** Textes du lot 16c (analyse de ventes). Fusionnés dans `fr` et `en`. */
export const salesFr = {
  'sales.title': 'Ventes',
  'sales.days': '{n} jours',
  'sales.orders': 'Commandes',
  'sales.cancelled': 'Annulées',
  'sales.revenue': 'Chiffre d’affaires',
  'sales.basket': 'Panier moyen',
  'sales.top': 'Produits les plus vendus',
  'sales.qty': '{n} vendu(s)',
  'sales.empty': 'Aucune vente sur cette période.',
  'sales.note': 'Les commandes annulées ne comptent pas dans le chiffre d’affaires.',
  'customers.title': 'Clients',
  'customers.empty': 'Aucun client pour le moment.',
  'customers.line': '{n} commande(s) · dernière le {date}',
} as const;

export const salesEn = {
  'sales.title': 'Sales',
  'sales.days': '{n} days',
  'sales.orders': 'Orders',
  'sales.cancelled': 'Cancelled',
  'sales.revenue': 'Revenue',
  'sales.basket': 'Average basket',
  'sales.top': 'Best-selling products',
  'sales.qty': '{n} sold',
  'sales.empty': 'No sales in this period.',
  'sales.note': 'Cancelled orders are not counted in revenue.',
  'customers.title': 'Customers',
  'customers.empty': 'No customer yet.',
  'customers.line': '{n} order(s) · last on {date}',
} as const;
