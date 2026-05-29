import { createUploadImage, createThumbnailImage } from '../processPhoto';
import * as ImageManipulator from 'expo-image-manipulator';

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn().mockResolvedValue({ uri: 'processed://result.jpg' }),
  SaveFormat: { JPEG: 'jpeg' },
}));

const mockManipulate = ImageManipulator.manipulateAsync as jest.Mock;

describe('processPhoto', () => {
  beforeEach(() => {
    mockManipulate.mockClear();
  });

  describe('createUploadImage', () => {
    test('resizes to 1280px long edge and JPEG quality 0.75', async () => {
      mockManipulate.mockResolvedValue({ uri: 'processed://upload.jpg' });

      const result = await createUploadImage('file://photo.jpg');

      expect(mockManipulate).toHaveBeenCalledWith(
        'file://photo.jpg',
        [
          { resize: { width: 1280 } },
        ],
        { compress: 0.75, format: 'jpeg' },
      );
      expect(result).toEqual({ uri: 'processed://upload.jpg', mimeType: 'image/jpeg' });
    });

    test('returns JPEG mime type', async () => {
      mockManipulate.mockResolvedValue({ uri: 'processed://upload.jpg' });

      const result = await createUploadImage('file://photo.jpg');

      expect(result.mimeType).toBe('image/jpeg');
    });
  });

  describe('createThumbnailImage', () => {
    test('resizes to 320px long edge and JPEG quality 0.6', async () => {
      mockManipulate.mockResolvedValue({ uri: 'processed://thumb.jpg' });

      const result = await createThumbnailImage('file://photo.jpg');

      expect(mockManipulate).toHaveBeenCalledWith(
        'file://photo.jpg',
        [
          { resize: { width: 320 } },
        ],
        { compress: 0.6, format: 'jpeg' },
      );
      expect(result).toEqual({ uri: 'processed://thumb.jpg', mimeType: 'image/jpeg' });
    });
  });
});
