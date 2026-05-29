import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import '../../lib/i18n';
import { HomeScanScreen } from '../HomeScanScreen';

describe('HomeScanScreen', () => {
  test('navigates to the correct scan flow for each large action card', () => {
    const navigation = {
      navigate: jest.fn(),
    };

    const screen = render(<HomeScanScreen navigation={navigation as never} />);

    fireEvent.press(screen.getByText('MedicineBag'));
    expect(navigation.navigate).toHaveBeenCalledWith('MedicineBagCapture');

    fireEvent.press(screen.getByText('MedicineBrandPackage'));
    expect(navigation.navigate).toHaveBeenCalledWith('BrandPackageCapture');
  });
});
