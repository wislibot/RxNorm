import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import '../../lib/i18n';

const mockRequestMediaLibraryPermissions = jest.fn();
const mockLaunchImageLibrary = jest.fn();

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) =>
    mockRequestMediaLibraryPermissions(...args),
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibrary(...args),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraView: (props: Record<string, unknown>) => React.createElement(View, { ...props, testID: 'camera-view' }),
    useCameraPermissions: () => [{ granted: true }, jest.fn(), jest.fn()],
  };
});

import { CameraCapture } from '../CameraCapture';

describe('CameraCapture - Upload from Photos', () => {
  const defaultProps = {
    title: 'Test Title',
    subtitle: 'Test Subtitle',
    photos: [],
    maxPhotos: 4,
    nextLabel: 'Next',
    onNext: jest.fn(),
    onPhotosChange: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestMediaLibraryPermissions.mockResolvedValue({ granted: true });
    mockLaunchImageLibrary.mockResolvedValue({ canceled: true, assets: [] });
  });

  test('renders Upload from Photos button', () => {
    const screen = render(<CameraCapture {...defaultProps} />);

    expect(screen.getByText('Upload from Photos')).toBeTruthy();
  });

  test('does not add photo when user cancels picker', async () => {
    const onPhotosChange = jest.fn();
    mockLaunchImageLibrary.mockResolvedValue({ canceled: true, assets: [] });

    const screen = render(
      <CameraCapture {...defaultProps} onPhotosChange={onPhotosChange} />,
    );

    const button = screen.getByText('Upload from Photos');
    fireEvent.press(button);

    await waitFor(() => {
      expect(mockRequestMediaLibraryPermissions).toHaveBeenCalled();
    });

    expect(mockLaunchImageLibrary).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      quality: 1,
    });

    expect(onPhotosChange).not.toHaveBeenCalled();
  });

  test('adds photo when user selects an image', async () => {
    const onPhotosChange = jest.fn();
    mockLaunchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://gallery/photo.jpg', width: 800, height: 600 }],
    });

    const screen = render(
      <CameraCapture {...defaultProps} onPhotosChange={onPhotosChange} />,
    );

    const button = screen.getByText('Upload from Photos');
    fireEvent.press(button);

    await waitFor(() => {
      expect(onPhotosChange).toHaveBeenCalled();
    });

    const callArg = onPhotosChange.mock.calls[0][0];
    expect(callArg).toHaveLength(1);
    expect(callArg[0].uri).toBe('file://gallery/photo.jpg');
    expect(callArg[0].id).toEqual(expect.any(String));
  });

  test('does not add photo when media library permission denied', async () => {
    const onPhotosChange = jest.fn();
    mockRequestMediaLibraryPermissions.mockResolvedValue({ granted: false });

    const screen = render(
      <CameraCapture {...defaultProps} onPhotosChange={onPhotosChange} />,
    );

    const button = screen.getByText('Upload from Photos');
    fireEvent.press(button);

    await waitFor(() => {
      expect(mockRequestMediaLibraryPermissions).toHaveBeenCalled();
    });

    expect(mockLaunchImageLibrary).not.toHaveBeenCalled();
    expect(onPhotosChange).not.toHaveBeenCalled();
  });

  test('replaces photo when maxPhotos is 1 (brand package mode)', async () => {
    const onPhotosChange = jest.fn();
    mockLaunchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://gallery/brand.jpg', width: 800, height: 600 }],
    });

    const screen = render(
      <CameraCapture
        {...defaultProps}
        maxPhotos={1}
        onPhotosChange={onPhotosChange}
      />,
    );

    const button = screen.getByText('Upload from Photos');
    fireEvent.press(button);

    await waitFor(() => {
      expect(onPhotosChange).toHaveBeenCalled();
    });

    const callArg = onPhotosChange.mock.calls[0][0];
    expect(callArg).toHaveLength(1);
    expect(callArg[0].uri).toBe('file://gallery/brand.jpg');
  });
});
