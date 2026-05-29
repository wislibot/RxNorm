import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from './AuthProvider';
import { BilingualLabel } from './BilingualLabel';
import { colors, radius, spacing, typography } from '../theme/tokens';

type LoginScreenProps = {
  onCreateAccount?: () => void;
};

type AuthMessageFallback = {
  zh: string;
  en: string;
};

export function getBilingualAuthMessage(error: unknown, fallback: AuthMessageFallback) {
  const normalized = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();

  if (normalized.includes('invalid login credentials') || normalized.includes('wrong password')) {
    return '帳號或密碼不正確 (Incorrect email or password)';
  }
  if (normalized.includes('invalid email')) {
    return '電子郵件格式不正確 (Please enter a valid email address)';
  }
  if (normalized.includes('network') || normalized.includes('failed to fetch') || normalized.includes('request failed')) {
    return '網路連線異常，請稍後再試 (Network error, please try again)';
  }
  if (normalized.includes('password_mismatch')) {
    return '密碼與確認密碼不一致 (Passwords do not match)';
  }

  return `${fallback.zh} (${fallback.en})`;
}

export function LoginScreen({ onCreateAccount }: LoginScreenProps) {
  const { signIn } = useAuth();
  const passwordInputRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSignIn = async () => {
    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      await signIn(email.trim(), password);
    } catch (error) {
      setErrorMessage(
        getBilingualAuthMessage(error, {
          zh: '目前無法登入',
          en: 'Unable to sign in right now',
        }),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', android: 'height' })}
      keyboardVerticalOffset={Platform.select({ ios: 24, android: 0 })}
      style={styles.page}
    >
      <Pressable onPress={Keyboard.dismiss} style={styles.page}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          testID="login-scroll"
        >
          <View style={styles.card}>
            <BilingualLabel en="Welcome back" enStyle={styles.titleEnglish} style={styles.title} zh="歡迎回來" />
            <BilingualLabel
              en="Sign in to review your medicines and scan history"
              enStyle={styles.subtitleEnglish}
              style={styles.subtitle}
              zh="請登入以查看您的藥物與掃描紀錄"
            />

            <BilingualLabel en="Email" style={styles.label} zh="電子郵件" />
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={setEmail}
              onSubmitEditing={() => passwordInputRef.current?.focus()}
              placeholder="patient@example.com"
              placeholderTextColor={colors.textMuted}
              returnKeyType="next"
              style={styles.input}
              value={email}
            />

            <View style={styles.passwordRow} testID="login-password-row">
              <BilingualLabel en="Password" style={[styles.label, styles.rowLabel]} zh="密碼" />
              <Pressable
                accessibilityLabel={showPassword ? '隱藏密碼 (Hide password)' : '顯示密碼 (Show password)'}
                accessibilityRole="button"
                onPress={() => setShowPassword((current) => !current)}
                style={styles.passwordToggle}
              >
                <BilingualLabel
                  en={showPassword ? 'Hide' : 'Show'}
                  enStyle={styles.passwordToggleEnglish}
                  style={styles.passwordToggleText}
                  zh={showPassword ? '隱藏' : '顯示'}
                />
              </Pressable>
            </View>
            <TextInput
              onChangeText={setPassword}
              onSubmitEditing={handleSignIn}
              placeholder="••••••••"
              placeholderTextColor={colors.textMuted}
              ref={passwordInputRef}
              returnKeyType="go"
              secureTextEntry={!showPassword}
              style={styles.input}
              value={password}
            />

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

            <Pressable onPress={handleSignIn} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
              {isSubmitting ? (
                <ActivityIndicator color={colors.card} />
              ) : (
                <BilingualLabel en="Sign in" enStyle={styles.buttonEnglishText} style={styles.buttonText} zh="登入" />
              )}
            </Pressable>

            <Pressable onPress={onCreateAccount} style={styles.linkButton}>
              <BilingualLabel en="Create account" enStyle={styles.linkEnglishText} style={styles.linkText} zh="建立帳號" />
            </Pressable>
          </View>
        </ScrollView>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  titleEnglish: {
    fontSize: typography.subtitle,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 26,
    marginBottom: spacing.sm,
  },
  subtitleEnglish: {
    fontSize: typography.label,
  },
  label: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  rowLabel: {
    flex: 1,
    marginTop: 0,
    paddingRight: spacing.sm,
  },
  passwordRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    marginTop: spacing.xs,
  },
  passwordToggle: {
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  passwordToggleText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  passwordToggleEnglish: {
    color: colors.primary,
    fontSize: 13,
  },
  input: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: typography.body,
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 60,
  },
  buttonPressed: {
    backgroundColor: colors.primaryPressed,
  },
  buttonText: {
    color: colors.card,
    fontSize: typography.body,
    fontWeight: '700',
  },
  buttonEnglishText: {
    color: colors.card,
    fontSize: typography.label,
  },
  linkButton: {
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  linkText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  linkEnglishText: {
    color: colors.primary,
    fontSize: typography.label,
  },
  errorText: {
    color: '#B42318',
    fontSize: typography.label,
    lineHeight: 24,
  },
});
