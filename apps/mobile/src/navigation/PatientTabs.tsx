import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { CaseHistoryScreen } from '../case/CaseHistoryScreen';
import type { MyMedsStackParamList } from '../case/navigationTypes';
import { CasePageScreen } from '../case/CasePageScreen';
import { BrandDraftScreen } from '../scan/BrandDraftScreen';
import { BrandPackageCaptureScreen } from '../scan/BrandPackageCaptureScreen';
import { CaseDraftScreen } from '../scan/CaseDraftScreen';
import { MedicineBagCaptureScreen } from '../scan/MedicineBagCaptureScreen';
import type { ScanStackParamList } from '../scan/types';
import { CareTeamsScreen } from '../screens/CareTeamsScreen';
import { HomeScanScreen } from '../screens/HomeScanScreen';
import { MyMedsScreen } from '../screens/MyMedsScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors } from '../theme/tokens';

const Tab = createBottomTabNavigator();
const ScanStack = createNativeStackNavigator<ScanStackParamList>();
const MyMedsStack = createNativeStackNavigator<MyMedsStackParamList>();

function HomeScanNavigator() {
  const { t } = useTranslation();

  return (
    <ScanStack.Navigator
      initialRouteName="HomeScanLanding"
      screenOptions={{
        contentStyle: {
          backgroundColor: colors.background,
        },
        headerShadowVisible: false,
      }}
    >
      <ScanStack.Screen component={HomeScanScreen} name="HomeScanLanding" options={{ headerShown: false }} />
      <ScanStack.Screen
        component={MedicineBagCaptureScreen}
        name="MedicineBagCapture"
        options={{ title: t('medicineBag') }}
      />
      <ScanStack.Screen
        component={BrandPackageCaptureScreen}
        name="BrandPackageCapture"
        options={{ title: t('brandPackage') }}
      />
      <ScanStack.Screen component={CaseDraftScreen} name="CaseDraft" options={{ title: t('caseDraftTitle') }} />
      <ScanStack.Screen component={CasePageScreen} name="CasePage" options={{ title: t('casePageTitle') }} />
      <ScanStack.Screen component={BrandDraftScreen} name="BrandDraft" options={{ title: t('brandDraftTitle') }} />
    </ScanStack.Navigator>
  );
}

function MyMedsNavigator() {
  const { t } = useTranslation();

  return (
    <MyMedsStack.Navigator
      initialRouteName="MyMedsHome"
      screenOptions={{
        contentStyle: {
          backgroundColor: colors.background,
        },
        headerShadowVisible: false,
      }}
    >
      <MyMedsStack.Screen component={MyMedsScreen} name="MyMedsHome" options={{ headerShown: false }} />
      <MyMedsStack.Screen component={CaseHistoryScreen} name="CaseHistory" options={{ title: t('scanHistoryTitle') }} />
      <MyMedsStack.Screen component={CasePageScreen} name="CasePage" options={{ title: t('casePageTitle') }} />
    </MyMedsStack.Navigator>
  );
}

export function PatientTabs() {
  const { t } = useTranslation();

  return (
    <NavigationContainer>
      <Tab.Navigator
        initialRouteName="Home"
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
              Search: focused ? 'search' : 'search-outline',
              MyMeds: focused ? 'medkit' : 'medkit-outline',
              Home: focused ? 'scan-circle' : 'scan-circle-outline',
              CareTeams: focused ? 'people' : 'people-outline',
              Settings: focused ? 'settings' : 'settings-outline',
            };

            const iconSize = route.name === 'Home' ? 34 : size;
            return <Ionicons color={color} name={iconMap[route.name]} size={iconSize} />;
          },
        })}
      >
        <Tab.Screen name="Search" component={SearchScreen} options={{ title: t('searchTab') }} />
        <Tab.Screen name="MyMeds" component={MyMedsNavigator} options={{ title: t('myMedsTab') }} />
        <Tab.Screen
          name="Home"
          component={HomeScanNavigator}
          options={{
            title: t('scanTab'),
            tabBarItemStyle: {
              paddingBottom: 6,
            },
          }}
        />
        <Tab.Screen name="CareTeams" component={CareTeamsScreen} options={{ title: t('careTeamsTab') }} />
        <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: t('settingsTab') }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
