import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { StaffRecordsScreen } from '../staff/StaffRecordsScreen';
import { StaffCaseDetailScreen } from '../staff/StaffCaseDetailScreen';
import { StaffDruglistDetailScreen } from '../staff/StaffDruglistDetailScreen';
import { StaffMyHospitalsScreen } from '../staff/StaffMyHospitalsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors } from '../theme/tokens';

const Tab = createBottomTabNavigator();

type StaffRecordsStackParamList = {
  StaffRecordsHome: undefined;
  StaffCaseDetail: { caseId: string; caseName: string | null };
  StaffDruglistDetail: { playlistId: string; playlistName: string };
};

const RecordsStack = createNativeStackNavigator<StaffRecordsStackParamList>();

function StaffRecordsNavigator() {
  const { t } = useTranslation();

  return (
    <RecordsStack.Navigator
      initialRouteName="StaffRecordsHome"
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    >
      <RecordsStack.Screen component={StaffRecordsScreen} name="StaffRecordsHome" options={{ headerShown: false }} />
      <RecordsStack.Screen
        component={StaffCaseDetailScreen}
        name="StaffCaseDetail"
        options={({ route }) => ({ title: route.params.caseName || t('staff.records.unnamedCase') })}
      />
      <RecordsStack.Screen
        component={StaffDruglistDetailScreen}
        name="StaffDruglistDetail"
        options={({ route }) => ({ title: route.params.playlistName })}
      />
    </RecordsStack.Navigator>
  );
}

export function StaffTabs() {
  const { t } = useTranslation();

  return (
    <NavigationContainer>
      <Tab.Navigator
        initialRouteName="StaffRecords"
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            height: 76,
            paddingBottom: 10,
            paddingTop: 8,
          },
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '600',
          },
          tabBarIcon: ({ color, focused, size }) => {
            const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
              StaffRecords: focused ? 'document-text' : 'document-text-outline',
              StaffHospitals: focused ? 'business' : 'business-outline',
              StaffSettings: focused ? 'settings' : 'settings-outline',
            };
            return <Ionicons color={color} name={iconMap[route.name]} size={size} />;
          },
        })}
      >
        <Tab.Screen name="StaffRecords" component={StaffRecordsNavigator} options={{ title: t('staff.tabs.records') }} />
        <Tab.Screen name="StaffHospitals" component={StaffMyHospitalsScreen} options={{ title: t('staff.tabs.hospitals') }} />
        <Tab.Screen name="StaffSettings" component={SettingsScreen} options={{ title: t('settingsTab') }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
