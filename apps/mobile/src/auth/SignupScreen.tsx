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
import { getBilingualAuthMessage } from './LoginScreen';
import { colors, radius, spacing, typography } from '../theme/tokens';

type SignupScreenProps = {
  onBackToSignIn?: () => void;
};

const VERIFY_EMAIL_MESSAGE = '請檢查您的電子郵件以完成驗證 (Check your email to verify your account)';

export function SignupScreen({ onBackToSignIn }: SignupScreenProps) {
  const { signUp } = useAuth();
  const passwordInputRef = useRef<TextInput>(null);
  const confirmPasswordInputRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSignUp = async () => {
    if (password !== confirmPassword) {
      setErrorMessage(
        getBilingualAuthMessage('password_mismatch', {
          zh: '目前無法建立帳號',
          en: 'Unable to create account right now',
        }),
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      const result = await signUp(email.trim(), password);
      if (result.requiresEmailVerification) {
        setSuccessMessage(VERIFY_EMAIL_MESSAGE);
      }
    } catch (error) {
      setErrorMessage(
        getBilingualAuthMessage(error, {
          zh: '目前無法建立帳號',
          en: 'Unable to create account right now',
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
          testID="signup-scroll"
        >
          <View style={styles.card}>
            <BilingualLabel en="Create your account" enStyle={styles.titleEnglish} style={styles.title} zh="建立您的帳號" />
            <BilingualLabel
              en="Create your patient account to save your medicines and continue later"
              enStyle={styles.subtitleEnglish}
              style={styles.subtitle}
              zh="建立病人帳號以儲存藥物與稍後繼續使用"
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

            <View style={styles.passwordRow} testID="signup-password-row">
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
              onSubmitEditing={() => confirmPasswordInputRef.current?.focus()}
              placeholder="請輸入密碼"
              placeholderTextColor={colors.textMuted}
              ref={passwordInputRef}
              returnKeyType="next"
              secureTextEntry={!showPassword}
              style={styles.input}
              value={password}
            />

            <View style={styles.passwordRow} testID="signup-confirm-password-row">
              <BilingualLabel en="Confirm password" style={[styles.label, styles.rowLabel]} zh="確認密碼" />
              <Pressable
                accessibilityLabel={showConfirmPassword ? '隱藏密碼 (Hide password)' : '顯示密碼 (Show password)'}
                accessibilityRole="button"
                onPress={() => setShowConfirmPassword((current) => !current)}
                style={styles.passwordToggle}
              >
                <BilingualLabel
                  en={showConfirmPassword ? 'Hide' : 'Show'}
                  enStyle={styles.passwordToggleEnglish}
                  style={styles.passwordToggleText}
                  zh={showConfirmPassword ? '隱藏' : '顯示'}
                />
              </Pressable>
            </View>
            <TextInput
              onChangeText={setConfirmPassword}
              onSubmitEditing={handleSignUp}
              placeholder="請再次輸入密碼"
              placeholderTextColor={colors.textMuted}
              ref={confirmPasswordInputRef}
              returnKeyType="done"
              secureTextEntry={!showConfirmPassword}
              style={styles.input}
              value={confirmPassword}
            />

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
            {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}

            <Pressable onPress={handleSignUp} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
              {isSubmitting ? (
                <ActivityIndicator color={colors.card} />
              ) : (
                <BilingualLabel en="Create account" enStyle={styles.buttonEnglishText} style={styles.buttonText} zh="建立帳號" />
              )}
            </Pressable>

            <Pressable onPress={onBackToSignIn} style={styles.linkButton}>
              <BilingualLabel en="Back to sign in" enStyle={styles.linkEnglishText} style={styles.linkText} zh="返回登入" />
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
  successText: {
    color: '#067647',
    fontSize: typography.label,
    lineHeight: 24,
  },
});
