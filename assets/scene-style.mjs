// Display-only camera annotations. Never changes scene positions or measured data.
export const CAMERA_ANNOTATION = Object.freeze({
  fallbackColor: '#2457df',
  labelText: '#ffffff',
  bodyEmissive: .55,
  tripodEmissive: .45,
  edgeOpacity: 1,
  fillOpacity: .055,
});

export function cameraAnnotationStyle(value) {
  const color = typeof value === 'string' ? value.trim() : '';
  return {
    ...CAMERA_ANNOTATION,
    color: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : CAMERA_ANNOTATION.fallbackColor,
  };
}
