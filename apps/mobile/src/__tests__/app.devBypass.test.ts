jest.mock('../../src/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    isLoading: false,
    needsLanguageSelection: false,
    preferredLanguage: 'en',
    session: null,
  }),
}));

jest.mock('../../src/auth/LoginScreen', () => ({
  LoginScreen: () => null,
}));

jest.mock('../../src/auth/SignupScreen', () => ({
  SignupScreen: () => null,
}));

jest.mock('../../src/navigation/PatientTabs', () => ({
  PatientTabs: () => null,
}));

jest.mock('../../src/settings/LanguagePickerScreen', () => ({
  LanguagePickerScreen: () => null,
}));

import React from 'react';
import { shouldUseDevWebBypass } from '../../App';

describe('shouldUseDevWebBypass', () => {
  test('only enables the bypass for development web builds', () => {
    expect(typeof shouldUseDevWebBypass).toBe('function');
    expect(shouldUseDevWebBypass(true, 'web')).toBe(true);
    expect(shouldUseDevWebBypass(true, 'ios')).toBe(false);
    expect(shouldUseDevWebBypass(false, 'web')).toBe(false);
  });
});
