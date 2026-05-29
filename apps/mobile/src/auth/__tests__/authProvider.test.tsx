import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { AuthProvider, useAuth } from '../AuthProvider';

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
      updateUser: jest.fn(async () => ({
        data: { user: currentSession?.user ?? null },
        error: null,
      })),
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

function AuthHarness() {
  const { isLoading, user, signIn } = useAuth();

  return (
    <View>
      <Text testID="loading">{isLoading ? 'loading' : 'ready'}</Text>
      <Text testID="user-email">{user?.email ?? 'guest'}</Text>
      <TouchableOpacity onPress={() => signIn('patient@example.com', 'secret')}>
        <Text>sign-in</Text>
      </TouchableOpacity>
    </View>
  );
}

test('provider initializes with no session', async () => {
  const client = createFakeAuthClient({ session: null });
  const storage = createFakeStorage();
  const screen = render(
    <AuthProvider client={client} storage={storage}>
      <AuthHarness />
    </AuthProvider>,
  );

  await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('ready'));
  expect(screen.getByTestId('user-email').props.children).toBe('guest');
});

test('provider updates user on sign-in success', async () => {
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
      <AuthHarness />
    </AuthProvider>,
  );

  fireEvent.press(screen.getByText('sign-in'));

  await waitFor(() => expect(screen.getByTestId('user-email').props.children).toBe('patient@example.com'));
});
