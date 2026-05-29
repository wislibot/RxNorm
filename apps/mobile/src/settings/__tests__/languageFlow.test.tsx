import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { AuthProvider, useAuth } from '../../auth/AuthProvider';

type FakeUser = {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
};

type FakeSession = {
  user: FakeUser;
};

function createFakeAuthClient(options?: {
  session?: FakeSession | null;
  signInSession?: FakeSession | null;
}) {
  let currentSession = options?.session ?? null;
  const listeners = new Set<(event: string, session: FakeSession | null) => void>();

  return {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: currentSession } })),
      onAuthStateChange: jest.fn((callback: (event: string, session: FakeSession | null) => void) => {
        listeners.add(callback);
        return {
          data: {
            subscription: {
              unsubscribe: () => listeners.delete(callback),
            },
          },
        };
      }),
      signInWithPassword: jest.fn(async () => {
        currentSession = options?.signInSession ?? null;
        listeners.forEach((listener) => listener('SIGNED_IN', currentSession));
        return {
          data: { session: currentSession, user: currentSession?.user ?? null },
          error: null,
        };
      }),
      signOut: jest.fn(async () => {
        currentSession = null;
        listeners.forEach((listener) => listener('SIGNED_OUT', null));
        return { error: null };
      }),
      updateUser: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (currentSession) {
          currentSession = {
            ...currentSession,
            user: {
              ...currentSession.user,
              user_metadata: {
                ...currentSession.user.user_metadata,
                ...data,
              },
            },
          };
        }
        return {
          data: { user: currentSession?.user ?? null },
          error: null,
        };
      }),
    },
  };
}

function createFakeStorage(initialState?: Record<string, string>) {
  const state = new Map(Object.entries(initialState ?? {}));
  return {
    getItem: jest.fn(async (key: string) => state.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      state.set(key, value);
    }),
    deleteItem: jest.fn(async (key: string) => {
      state.delete(key);
    }),
    removeItem: jest.fn(async (key: string) => {
      state.delete(key);
    }),
  };
}

function LanguageHarness() {
  const { needsLanguageSelection, signIn, setPreferredLanguage, preferredLanguage } = useAuth();

  return (
    <View>
      <Text testID="needs-language">{needsLanguageSelection ? 'yes' : 'no'}</Text>
      <Text testID="language">{preferredLanguage ?? 'unset'}</Text>
      <TouchableOpacity onPress={() => signIn('patient@example.com', 'secret')}>
        <Text>sign-in</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setPreferredLanguage('zh-TW')}>
        <Text>pick-zh</Text>
      </TouchableOpacity>
    </View>
  );
}

test('first login with no stored preference requires language selection', async () => {
  const client = createFakeAuthClient({
    session: null,
    signInSession: {
      user: {
        id: 'user-1',
        email: 'patient@example.com',
        user_metadata: {},
      },
    },
  });
  const storage = createFakeStorage();
  const screen = render(
    <AuthProvider client={client} storage={storage}>
      <LanguageHarness />
    </AuthProvider>,
  );

  fireEvent.press(screen.getByText('sign-in'));

  await waitFor(() => expect(screen.getByTestId('needs-language').props.children).toBe('yes'));
});

test('selecting a language persists and suppresses the picker on next load', async () => {
  const client = createFakeAuthClient({
    session: {
      user: {
        id: 'user-1',
        email: 'patient@example.com',
        user_metadata: {},
      },
    },
  });
  const storage = createFakeStorage();
  const firstSession = render(
    <AuthProvider client={client} storage={storage}>
      <LanguageHarness />
    </AuthProvider>,
  );

  await waitFor(() => expect(firstSession.getByTestId('needs-language').props.children).toBe('yes'));
  fireEvent.press(firstSession.getByText('pick-zh'));

  await waitFor(() => expect(firstSession.getByTestId('language').props.children).toBe('zh-TW'));
  await waitFor(() => expect(firstSession.getByTestId('needs-language').props.children).toBe('no'));

  firstSession.unmount();

  const nextClient = createFakeAuthClient({
    session: {
      user: {
        id: 'user-1',
        email: 'patient@example.com',
        user_metadata: {
          preferred_language: 'zh-TW',
        },
      },
    },
  });

  const nextSession = render(
    <AuthProvider client={nextClient} storage={storage}>
      <LanguageHarness />
    </AuthProvider>,
  );

  await waitFor(() => expect(nextSession.getByTestId('language').props.children).toBe('zh-TW'));
  expect(nextSession.getByTestId('needs-language').props.children).toBe('no');
});
