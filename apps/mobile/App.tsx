import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import './src/lib/i18n';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { LoginScreen } from './src/auth/LoginScreen';
import { SignupScreen } from './src/auth/SignupScreen';
import { setLanguage } from './src/lib/i18n';
import { PatientTabs } from './src/navigation/PatientTabs';
import { StaffTabs } from './src/navigation/StaffTabs';
import { LanguagePickerScreen } from './src/settings/LanguagePickerScreen';
import { colors, typography } from './src/theme/tokens';

export function shouldUseDevWebBypass(isDev: boolean, platform: string) {
  return isDev && platform === 'web';
}

function PatientRoot() {
  const { isLoading, isStaffUser, needsLanguageSelection, preferredLanguage, session } = useAuth();
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [isDevPreviewMode, setIsDevPreviewMode] = useState(false);
  const canUseDevBypass = shouldUseDevWebBypass(__DEV__, Platform.OS);

  useEffect(() => {
    void setLanguage(preferredLanguage ?? 'en');
  }, [preferredLanguage]);

  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>Loading your medicines...</Text>
      </View>
    );
  }

  if (!session && !isDevPreviewMode) {
    return (
      <View style={styles.authShell}>
        {authMode === 'signup' ? (
          <SignupScreen onBackToSignIn={() => setAuthMode('login')} />
        ) : (
          <LoginScreen onCreateAccount={() => setAuthMode('signup')} />
        )}
        {canUseDevBypass ? (
          <Pressable
            onPress={() => setIsDevPreviewMode(true)}
            style={({ pressed }) => [styles.devBypassButton, pressed && styles.devBypassButtonPressed]}
          >
            <Text style={styles.devBypassText}>DEV: Preview app without login</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (session && needsLanguageSelection) {
    return <LanguagePickerScreen />;
  }

  return isStaffUser ? <StaffTabs /> : <PatientTabs />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <PatientRoot />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    gap: 16,
  },
  loadingText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  authShell: {
    flex: 1,
  },
  devBypassButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    bottom: 24,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
    position: 'absolute',
  },
  devBypassButtonPressed: {
    opacity: 0.82,
  },
  devBypassText: {
    color: colors.text,
    fontSize: typography.label,
    fontWeight: '600',
  },
});
