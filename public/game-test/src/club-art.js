/** Six independent floors, with venue colors shared by the set and route preview. */
export const CLUB_ART = Object.freeze([
  { id: 'nakano', club: 'BEAT BASE 175', accent: '#ffa968', secondary: '#ef72ba', floor: '#291c29', lights: [172, 328, 624, 792] },
  { id: 'shinjuku', club: 'PINK FLASH', accent: '#ff72ca', secondary: '#8eeafa', floor: '#24142e', lights: [76, 208, 352, 608, 752, 884] },
  { id: 'shibuya', club: 'NEON LEOPARD', accent: '#ffd58e', secondary: '#ff70b5', floor: '#2b1b22', lights: [112, 268, 692, 848] },
  { id: 'asakusa', club: 'LANTERN BASS', accent: '#ffbb71', secondary: '#a8dac8', floor: '#302017', lights: [152, 336, 624, 808] },
  { id: 'osaka', club: 'BASS TAKOYAKI', accent: '#82e8de', secondary: '#ff9763', floor: '#172e32', lights: [76, 248, 408, 552, 712, 884] },
  { id: 'kyoto', club: 'GALAXY FLOOR', accent: '#c3a0ff', secondary: '#ffcf90', floor: '#211c38', lights: [96, 288, 480, 672, 864] },
].map(venue => Object.freeze({
  ...venue,
  lights: Object.freeze(venue.lights),
  src: new URL(`../assets/clubs/${venue.id}.png`, import.meta.url).href,
})));
const images = new Map(), jobs = new Map();
export function getClubArt(clubOrCityId) {
  return CLUB_ART.find(venue => venue.id === clubOrCityId || venue.club === clubOrCityId) || null;
}
export function getClubImage(clubOrCityId) {
  return images.get(getClubArt(clubOrCityId)?.id) || null;
}

/** Cache successful plates; a failed venue can retry without reloading its neighbors. */
export async function preloadClubArt(ids = CLUB_ART.map(venue => venue.id)) {
  return Promise.all(ids.map(id => {
    const venue = getClubArt(id);
    if (!venue) return Promise.reject(new Error(`Unknown club art: ${id}`));
    if (images.has(venue.id)) return Promise.resolve(images.get(venue.id));
    if (jobs.has(venue.id)) return jobs.get(venue.id);
    const job = new Promise((resolve, reject) => {
      if (typeof Image === 'undefined') return reject(new Error('Club art needs an image loader'));
      const image = new Image();
      let settled = false;
      const finish = ready => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.onload = image.onerror = null;
        if (ready) { images.set(venue.id, image); resolve(image); }
        else { jobs.delete(venue.id); reject(new Error(`Could not load club art: ${venue.id}`)); }
      };
      const timer = setTimeout(() => finish(false), 15000);
      image.onload = () => finish((image.naturalWidth || image.width) > 0 && (image.naturalHeight || image.height) > 0);
      image.onerror = () => finish(false);
      image.decoding = 'async';
      image.src = venue.src;
    });
    jobs.set(venue.id, job);
    return job;
  }));
}
