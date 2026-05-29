import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import '../../lib/i18n';
import { SignupScreen } from '../SignupScreen';

const mockSignUp = jest.fn();
const mockOnBackToSignIn = jest.fn();

jest.mock('../AuthProvider', () => ({
  useAuth: () => ({
    signIn: jest.fn(),
    signUp: mockSignUp,
  }),
}));

describe('SignupScreen', () => {
  beforeEach(() => {
    mockSignUp.mockReset();
    mockOnBackToSignIn.mockReset();
  });

  test('shows an inline bilingual error when passwords do not match', async () => {
    const screen = render(<SignupScreen onBackToSignIn={mockOnBackToSignIn} />);

    fireEvent.changeText(screen.getByPlaceholderText('patient@example.com'), 'patient@example.com');
    fireEvent.changeText(screen.getByPlaceholderText('請輸入密碼'), 'secret-1');
    fireEvent.changeText(screen.getByPlaceholderText('請再次輸入密碼'), 'secret-2');
    fireEvent.press(screen.getByText('建立帳號 (Create account)'));

    await waitFor(() =>
      expect(screen.getByText('密碼與確認密碼不一致 (Passwords do not match)')).toBeTruthy(),
    );
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  test('renders both signup password toggles inline with their labels and keeps large tap targets', () => {
    const screen = render(<SignupScreen onBackToSignIn={mockOnBackToSignIn} />);

    expect(screen.getByTestId('signup-password-row').props.style).toMatchObject({
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 44,
    });
    expect(screen.getByTestId('signup-confirm-password-row').props.style).toMatchObject({
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 44,
    });
    expect(screen.getAllByLabelText('顯示密碼 (Show password)')[0].props.style).toMatchObject({
      minHeight: 44,
    });
  });

  test('renders bilingual title and shows verification-required success message', async () => {
    mockSignUp.mockResolvedValueOnce({ requiresEmailVerification: true });
    const screen = render(<SignupScreen onBackToSignIn={mockOnBackToSignIn} />);

    expect(screen.getByText('建立您的帳號 (Create your account)')).toBeTruthy();
    expect(
      screen.getByText('建立病人帳號以儲存藥物與稍後繼續使用 (Create your patient account to save your medicines and continue later)'),
    ).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText('patient@example.com'), 'patient@example.com');
    fireEvent.changeText(screen.getByPlaceholderText('請輸入密碼'), 'secret-1');
    fireEvent.changeText(screen.getByPlaceholderText('請再次輸入密碼'), 'secret-1');
    fireEvent.press(screen.getByText('建立帳號 (Create account)'));

    await waitFor(() =>
      expect(
        screen.getByText('請檢查您的電子郵件以完成驗證 (Check your email to verify your account)'),
      ).toBeTruthy(),
    );
  });

  test('uses keyboard-safe scrolling and submits from confirm password field', async () => {
    mockSignUp.mockResolvedValueOnce({ requiresEmailVerification: false });
    const screen = render(<SignupScreen onBackToSignIn={mockOnBackToSignIn} />);
    const emailInput = screen.getByPlaceholderText('patient@example.com');
    const passwordInput = screen.getByPlaceholderText('請輸入密碼');
    const confirmPasswordInput = screen.getByPlaceholderText('請再次輸入密碼');

    expect(screen.getByTestId('signup-scroll').props.keyboardShouldPersistTaps).toBe('handled');
    expect(emailInput.props.returnKeyType).toBe('next');
    expect(passwordInput.props.returnKeyType).toBe('next');
    expect(confirmPasswordInput.props.returnKeyType).toBe('done');

    fireEvent.changeText(emailInput, 'patient@example.com');
    fireEvent.changeText(passwordInput, 'secret-1');
    fireEvent.changeText(confirmPasswordInput, 'secret-1');
    await act(async () => {
      await confirmPasswordInput.props.onSubmitEditing();
    });

    expect(mockSignUp).toHaveBeenCalledWith('patient@example.com', 'secret-1');
  });
});
