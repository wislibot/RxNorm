import React from 'react';
import { act, render, fireEvent } from '@testing-library/react-native';

import '../../lib/i18n';
import { LoginScreen } from '../LoginScreen';

const mockSignIn = jest.fn();
const mockOnCreateAccount = jest.fn();

jest.mock('../AuthProvider', () => ({
  useAuth: () => ({
    signIn: mockSignIn,
    signUp: jest.fn(),
  }),
}));

describe('LoginScreen', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockOnCreateAccount.mockReset();
  });

  test('toggles password visibility', () => {
    const screen = render(<LoginScreen onCreateAccount={mockOnCreateAccount} />);
    const passwordInput = screen.getByPlaceholderText('••••••••');

    expect(passwordInput.props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getByLabelText('顯示密碼 (Show password)'));
    expect(screen.getByPlaceholderText('••••••••').props.secureTextEntry).toBe(false);
    expect(screen.getByText('隱藏 (Hide)')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('隱藏密碼 (Hide password)'));
    expect(screen.getByPlaceholderText('••••••••').props.secureTextEntry).toBe(true);
    expect(screen.getByText('顯示 (Show)')).toBeTruthy();
  });

  test('renders the password toggle inline with the label and keeps a large tap target', () => {
    const screen = render(<LoginScreen onCreateAccount={mockOnCreateAccount} />);
    const passwordRow = screen.getByTestId('login-password-row');
    const toggleButton = screen.getByLabelText('顯示密碼 (Show password)');

    expect(passwordRow.props.style).toMatchObject({
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 44,
    });
    expect(toggleButton.props.style).toMatchObject({
      minHeight: 44,
    });
  });

  test('renders bilingual title and maps invalid credentials to a bilingual inline message', async () => {
    mockSignIn.mockRejectedValueOnce(new Error('Invalid login credentials'));
    const screen = render(<LoginScreen onCreateAccount={mockOnCreateAccount} />);

    expect(screen.getByText('歡迎回來 (Welcome back)')).toBeTruthy();
    expect(
      screen.getByText('請登入以查看您的藥物與掃描紀錄 (Sign in to review your medicines and scan history)'),
    ).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText('patient@example.com'), 'patient@example.com');
    fireEvent.changeText(screen.getByPlaceholderText('••••••••'), 'wrong-password');
    fireEvent.press(screen.getByText('登入 (Sign in)'));

    return screen.findByText('帳號或密碼不正確 (Incorrect email or password)');
  });

  test('opens signup flow from create account link', () => {
    const screen = render(<LoginScreen onCreateAccount={mockOnCreateAccount} />);

    fireEvent.press(screen.getByText('建立帳號 (Create account)'));

    expect(mockOnCreateAccount).toHaveBeenCalledTimes(1);
  });

  test('uses keyboard-safe scrolling and submits from the password field', async () => {
    mockSignIn.mockResolvedValueOnce(undefined);
    const screen = render(<LoginScreen onCreateAccount={mockOnCreateAccount} />);
    const emailInput = screen.getByPlaceholderText('patient@example.com');
    const passwordInput = screen.getByPlaceholderText('••••••••');

    expect(screen.getByTestId('login-scroll').props.keyboardShouldPersistTaps).toBe('handled');
    expect(emailInput.props.returnKeyType).toBe('next');
    expect(passwordInput.props.returnKeyType).toBe('go');

    fireEvent.changeText(emailInput, 'patient@example.com');
    fireEvent.changeText(passwordInput, 'secret-1');
    await act(async () => {
      await passwordInput.props.onSubmitEditing();
    });

    expect(mockSignIn).toHaveBeenCalledWith('patient@example.com', 'secret-1');
  });
});
