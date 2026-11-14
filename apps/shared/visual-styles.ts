// Styles for presentation images of a plan, generated with Cloudinary from a snapshot of the 2D plan (the sheet on a
// transparent background). Shared so the app can list them.
export type VisualStyle = { key: string; label: string; detail: string; prompt: string | null; generative: boolean };

// Prompts are plain words: a comma, slash or other mark would be read by Cloudinary as part of the transformation
// itself once the image URL is decoded, and the image would fail. cleanPrompt enforces it for every prompt.
export const VISUAL_STYLES: VisualStyle[] = [
  { key: 'desk', label: 'On the drawing desk', detail: 'The plan as a sheet on an architect\'s desk', generative: true,
    prompt: 'top view of a wooden architect desk with a scale ruler and pencils and tracing paper in soft daylight' },
  { key: 'site', label: 'In the site office', detail: 'The plan on a site office table, hard hat and tape beside it', generative: true,
    prompt: 'top view of a plywood site office table with a white hard hat and a tape measure and a marker in daylight' },
  { key: 'wide', label: 'Wide banner', detail: 'A 16:9 image for a slide or a report cover, the desk extended around the plan', generative: true,
    prompt: 'top view of a light concrete desk with drafting tools and a coffee cup in soft morning light' },
  { key: 'board', label: 'Presentation board', detail: 'The plan on a paper-tone board, sharpened, no generation', generative: false, prompt: null },
];

/** A scene prompt as plain words: letters, digits, spaces and hyphens only, at most 160 characters. */
export const cleanPrompt = (s: string) => s.replace(/[^\p{L}\p{N} \-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
