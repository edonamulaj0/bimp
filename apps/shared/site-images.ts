// Images for the marketing site: architectural photographs generated once with Cloudinary from exterior renders of the
// pilot courtyard house (apps/web/public/renders: the house's own walls, openings and pitched roofs, on a transparent
// background). Each is trimmed, set in a generated landscape, then sized. Changing a transformation regenerates it.
const enc = (s: string) => encodeURIComponent(s);
const scene = (prompt: string, ar: string, w: number) => `e_trim/e_gen_background_replace:prompt_${enc(prompt)}/c_pad,ar_${ar},b_gen_fill,w_${w}/f_jpg,q_auto:good`;

export type SiteImage = { key: string; source: string; transformation: string; alt: string };
const HOUSE = 'a contemporary single storey courtyard house with white rendered walls, large windows and dark pitched roofs';
export const SITE_IMAGES: SiteImage[] = [
  { key: 'hero', source: '/renders/garden.png', alt: 'The pilot courtyard house in a landscaped garden, late afternoon',
    transformation: scene(`${HOUSE}, in a landscaped garden with ornamental grasses, young birch trees and a stone path, soft late afternoon sun, architectural photography`, '16:9', 2200) },
  { key: 'dusk', source: '/renders/courtyard.png', alt: 'The courtyard of the pilot house at dusk, windows lit',
    transformation: scene(`${HOUSE}, seen from its gravel courtyard at blue hour, warm light in the windows, low planting, architectural photography`, '16:9', 2000) },
  { key: 'street', source: '/renders/street.png', alt: 'The entrance side of the pilot house from a quiet street',
    transformation: scene(`${HOUSE}, on a quiet tree-lined residential street with a low hedge and a gravel drive, bright morning light, architectural photography`, '4:3', 1600) },
  { key: 'aerial', source: '/renders/aerial.png', alt: 'Aerial view of the L-shaped pilot house in countryside',
    transformation: scene(`aerial drone view of ${HOUSE}, L shaped plan, in green countryside with meadows, hedgerows and a few oak trees, soft daylight, architectural photography`, '4:3', 1600) },
  { key: 'corner', source: '/renders/corner.png', alt: 'Low-angle view of the pilot house against the sky',
    transformation: scene(`low angle view of ${HOUSE}, against a clear blue sky with soft clouds, a lawn in the foreground, architectural photography`, '4:5', 1200) },
  { key: 'morning', source: '/renders/garden.png', alt: 'The pilot house in a misty meadow at sunrise',
    transformation: scene(`${HOUSE}, in a misty meadow at sunrise with low golden sun and distant trees, architectural photography`, '4:5', 1200) },
  { key: 'winter', source: '/renders/street.png', alt: 'The pilot house in snow at dusk',
    transformation: scene(`${HOUSE}, in a snowy landscape at dusk with warm window light and bare trees, architectural photography`, '4:5', 1200) },
  { key: 'autumn', source: '/renders/courtyard.png', alt: 'The courtyard of the pilot house in autumn',
    transformation: scene(`${HOUSE}, around a courtyard with autumn trees and fallen leaves on gravel, soft overcast light, architectural photography`, '4:5', 1200) },
  { key: 'meadow', source: '/renders/corner.png', alt: 'The pilot house in a wildflower meadow',
    transformation: scene(`${HOUSE}, in a summer wildflower meadow with tall grasses, warm evening light, architectural photography`, '4:5', 1200) },
  { key: 'night', source: '/renders/aerial.png', alt: 'Aerial view of the pilot house at night with lit windows',
    transformation: scene(`aerial view of ${HOUSE} at night, warm light glowing from the windows, dark countryside and a lit path, architectural photography`, '4:5', 1200) },
];
