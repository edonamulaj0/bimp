// Images for the marketing site, generated once with Cloudinary from renders of the pilot house's own 3D model
// (apps/web/public/renders, made with the app's scene). Each is a transparent PNG: trimmed, set in a generated scene
// (or on a plain board), then sized. Changing a transformation regenerates that image.
const enc = (s: string) => encodeURIComponent(s);
const scene = (prompt: string, ar: string, w: number) => `e_trim/e_gen_background_replace:prompt_${enc(prompt)}/c_pad,ar_${ar},b_gen_fill,w_${w}/f_jpg,q_auto:good`;
const board = (rgb: string, ar: string, w: number) => `e_trim/b_rgb:${rgb},c_pad,ar_${ar},w_${w}/e_sharpen:40/f_jpg,q_auto:good`;

export type SiteImage = { key: string; source: string; transformation: string; alt: string };
export const SITE_IMAGES: SiteImage[] = [
  { key: 'hero', source: '/renders/garden.png', alt: 'The pilot courtyard house in a landscaped garden, late afternoon',
    transformation: scene('a calm landscaped garden with ornamental grasses, young birch trees and a stone path, soft late afternoon sun, architectural photography', '16:9', 2200) },
  { key: 'dusk', source: '/renders/courtyard.png', alt: 'The courtyard side of the pilot house at dusk',
    transformation: scene('a quiet residential courtyard at dusk with warm light, gravel and low planting, blue hour architectural photography', '16:9', 2000) },
  { key: 'model', source: '/renders/aerial.png', alt: 'The pilot house as a cutaway model on an oak table',
    transformation: scene('an architectural scale model on a pale oak table in a bright architecture studio, soft window light, shallow depth of field', '4:3', 1600) },
  { key: 'interior', source: '/renders/living.png', alt: 'Cutaway of the living room and kitchen of the pilot house',
    transformation: scene('a white seamless photography studio backdrop with soft diffuse light and a gentle floor shadow', '4:3', 1600) },
  { key: 'drafting', source: '/renders/aerial.png', alt: 'The pilot house model on a drafting table with tracing paper',
    transformation: scene('a drafting table with sheets of tracing paper, a scale ruler and pencils, soft morning daylight, top down architectural photography', '4:5', 1200) },
  { key: 'morning', source: '/renders/garden.png', alt: 'The pilot house in a misty meadow at sunrise',
    transformation: scene('a misty meadow at sunrise with low golden sun and distant trees, architectural photography', '4:5', 1200) },
  { key: 'plan', source: '/renders/plan.png', alt: 'Rendered floor plan of the pilot house', transformation: board('ffffff', '1:1', 1400) },
  { key: 'sheet', source: '/renders/plan.png', alt: 'Rendered floor plan of the pilot house on a paper-tone board', transformation: board('f4f1ea', '4:5', 1200) },
];
