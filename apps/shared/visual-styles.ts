// Styles for architectural images generated from the 3D model with Cloudinary. Shared so the app can list them.
export type VisualStyle = { key: string; label: string; detail: string; prompt: string | null; generative: boolean };

export const VISUAL_STYLES: VisualStyle[] = [
  { key: 'site', label: 'Site context', detail: 'The model set in a landscaped garden, soft daylight', generative: true,
    prompt: 'a landscaped residential garden with lawn, young trees and a gravel path, soft overcast daylight, architectural photography' },
  { key: 'dusk', label: 'Dusk street', detail: 'A quiet street at dusk with warm light', generative: true,
    prompt: 'a quiet tree-lined residential street at dusk, warm window light, long exposure architectural photography' },
  { key: 'wide', label: 'Wide panorama', detail: 'A 16:9 hero image, the scene extended around the model', generative: true,
    prompt: 'open meadow landscape with distant hills, clear morning light, architectural photography' },
  { key: 'board', label: 'Presentation board', detail: 'The model on a paper-tone board, sharpened, no generation', generative: false, prompt: null },
];

/** A user's own scene prompt: letters, digits and simple punctuation, at most 160 characters. */
export const cleanPrompt = (s: string) => s.replace(/[^\p{L}\p{N} .\-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
