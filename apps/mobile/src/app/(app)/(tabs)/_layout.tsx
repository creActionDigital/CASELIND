import { Tabs } from 'expo-router';
import { AppHeader } from '../../../components/AppHeader';
import { TabBar } from '../../../components/TabBar';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ header: () => <AppHeader /> }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="maps" />
      <Tabs.Screen name="publish" />
      <Tabs.Screen name="messages" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}
