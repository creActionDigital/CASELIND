import { Tabs } from 'expo-router';
import { AppHeader } from '../../../components/AppHeader';
import { TabBar } from '../../../components/TabBar';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ header: () => <AppHeader /> }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="maps" />
      {/* Espace social et marketplace, plein écran : sans en-tête global. */}
      <Tabs.Screen name="hub" options={{ headerShown: false }} />
      {/* La messagerie a son propre en-tête « Discussions » (référence chat.jpeg). */}
      <Tabs.Screen name="messages" options={{ headerShown: false }} />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}
