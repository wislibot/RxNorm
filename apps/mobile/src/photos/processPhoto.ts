import * as ImageManipulator from 'expo-image-manipulator';

export async function createUploadImage(uri: string): Promise<{ uri: string; mimeType: string }> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1280 } }],
    { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
  );

  return { uri: result.uri, mimeType: 'image/jpeg' };
}

export async function createThumbnailImage(uri: string): Promise<{ uri: string; mimeType: string }> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 320 } }],
    { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG },
  );

  return { uri: result.uri, mimeType: 'image/jpeg' };
}
