import { Redirect, useLocalSearchParams } from 'expo-router';

/** Raccourci du tableau de bord vendeur : ouvre l'espace prestataire de l'organisation. */
export default function SellerServices() {
  const { orgId } = useLocalSearchParams<{ orgId: string }>();
  return <Redirect href={{ pathname: '/provider/[scope]', params: { scope: orgId } }} />;
}
