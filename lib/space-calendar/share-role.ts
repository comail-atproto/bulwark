export type SpaceOfferRole = 'viewer' | 'editor';
export type SpaceSharePreset = 'read' | 'readWrite';

export function presetForSpaceOfferRole(role: SpaceOfferRole): SpaceSharePreset {
  return role === 'viewer' ? 'read' : 'readWrite';
}

export function spaceSharePresetOptions(role: SpaceOfferRole | undefined): SpaceSharePreset[] {
  return role ? [presetForSpaceOfferRole(role)] : [];
}
