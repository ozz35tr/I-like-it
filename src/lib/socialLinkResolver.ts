import {
  extractPromoLinkInput,
  normalizeTurkishSearchText,
} from './mapsLink';
import {
  STORAGE_LIMITS,
  type PlaceCategory,
} from '../types/place';

export interface ResolvedInstagramPlace {
  resolvedUrl: string;
  username: string;
  name: string;
  category: PlaceCategory | null;
  cuisineTypes: string[];
  locationArea: string;
  mapsUrl: string;
  noteSnippet: string;
  source: 'remote' | 'handle';
}

interface RemoteSocialResponse {
  resolvedUrl?: string;
  username?: string;
  displayName?: string;
  description?: string;
  locationText?: string;
  mapsUrl?: string;
}

const RESERVED_IG_PATHS = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'stories',
  'explore',
  'accounts',
  'direct',
  'share',
  's',
  'about',
  'legal',
  'developer',
]);

// Known Turkish districts, neighborhoods, and provinces for region detection & proper casing
const TURKISH_REGIONS: readonly { folded: string; label: string }[] = [
  // İstanbul neighborhoods & districts
  { folded: 'kadikoy', label: 'Kadıköy, İstanbul' },
  { folded: 'moda', label: 'Moda, Kadıköy' },
  { folded: 'besiktas', label: 'Beşiktaş, İstanbul' },
  { folded: 'karakoy', label: 'Karaköy, Beyoğlu' },
  { folded: 'beyoglu', label: 'Beyoğlu, İstanbul' },
  { folded: 'taksim', label: 'Taksim, Beyoğlu' },
  { folded: 'cihangir', label: 'Cihangir, Beyoğlu' },
  { folded: 'nisantasi', label: 'Nişantaşı, Şişli' },
  { folded: 'bomonti', label: 'Bomonti, Şişli' },
  { folded: 'sisli', label: 'Şişli, İstanbul' },
  { folded: 'bebek', label: 'Bebek, Beşiktaş' },
  { folded: 'etiler', label: 'Etiler, Beşiktaş' },
  { folded: 'arnavutkoy', label: 'Arnavutköy, Beşiktaş' },
  { folded: 'ortakoy', label: 'Ortaköy, Beşiktaş' },
  { folded: 'uskudar', label: 'Üsküdar, İstanbul' },
  { folded: 'kuzguncuk', label: 'Kuzguncuk, Üsküdar' },
  { folded: 'bakirkoy', label: 'Bakırköy, İstanbul' },
  { folded: 'yesilkoy', label: 'Yeşilköy, Bakırköy' },
  { folded: 'florya', label: 'Florya, İstanbul' },
  { folded: 'atasehir', label: 'Ataşehir, İstanbul' },
  { folded: 'bostanci', label: 'Bostancı, Kadıköy' },
  { folded: 'suadiye', label: 'Suadiye, Kadıköy' },
  { folded: 'caddebostan', label: 'Caddebostan, Kadıköy' },
  { folded: 'bagdat caddesi', label: 'Bağdat Caddesi, Kadıköy' },
  { folded: 'fatih', label: 'Fatih, İstanbul' },
  { folded: 'balat', label: 'Balat, Fatih' },
  { folded: 'eminonu', label: 'Eminönü, Fatih' },
  { folded: 'sirkeci', label: 'Sirkeci, Fatih' },
  { folded: 'sariyer', label: 'Sarıyer, İstanbul' },
  { folded: 'yenikoy', label: 'Yeniköy, Sarıyer' },
  { folded: 'beykoz', label: 'Beykoz, İstanbul' },
  { folded: 'maltepe', label: 'Maltepe, İstanbul' },
  { folded: 'pendik', label: 'Pendik, İstanbul' },
  { folded: 'kartal', label: 'Kartal, İstanbul' },
  { folded: 'basaksehir', label: 'Başakşehir, İstanbul' },
  // İzmir neighborhoods & districts
  { folded: 'alsancak', label: 'Alsancak, İzmir' },
  { folded: 'kemeralti', label: 'Kemeraltı, Konak' },
  { folded: 'konak', label: 'Konak, İzmir' },
  { folded: 'karsiyaka', label: 'Karşıyaka, İzmir' },
  { folded: 'bostanli', label: 'Bostanlı, Karşıyaka' },
  { folded: 'mavisehir', label: 'Mavişehir, Karşıyaka' },
  { folded: 'bornova', label: 'Bornova, İzmir' },
  { folded: 'buca', label: 'Buca, İzmir' },
  { folded: 'guzelyali', label: 'Güzelyalı, İzmir' },
  { folded: 'goztepe', label: 'Göztepe, İzmir' },
  { folded: 'balcova', label: 'Balçova, İzmir' },
  { folded: 'narlidere', label: 'Narlıdere, İzmir' },
  { folded: 'guzelbahce', label: 'Güzelbahçe, İzmir' },
  { folded: 'urla', label: 'Urla, İzmir' },
  { folded: 'alacati', label: 'Alaçatı, Çeşme' },
  { folded: 'cesme', label: 'Çeşme, İzmir' },
  { folded: 'seferihisar', label: 'Seferihisar, İzmir' },
  { folded: 'sigacik', label: 'Sığacık, Seferihisar' },
  { folded: 'foca', label: 'Foça, İzmir' },
  { folded: 'sirince', label: 'Şirince, Selçuk' },
  { folded: 'gaziemir', label: 'Gaziemir, İzmir' },
  { folded: 'bayrakli', label: 'Bayraklı, İzmir' },
  { folded: 'cigli', label: 'Çiğli, İzmir' },
  // Ankara
  { folded: 'cankaya', label: 'Çankaya, Ankara' },
  { folded: 'kizilay', label: 'Kızılay, Ankara' },
  { folded: 'tunali', label: 'Tunalı, Çankaya' },
  { folded: 'bahcelievler', label: 'Bahçelievler, Ankara' },
  { folded: 'cayyolu', label: 'Çayyolu, Ankara' },
  { folded: 'umitkoy', label: 'Ümitköy, Ankara' },
  { folded: 'ulus', label: 'Ulus, Ankara' },
  { folded: 'kecioren', label: 'Keçiören, Ankara' },
  { folded: 'yenimahalle', label: 'Yenimahalle, Ankara' },
  { folded: 'batikent', label: 'Batıkent, Ankara' },
  // Antalya / Muğla / Ege / Akdeniz
  { folded: 'kaleici', label: 'Kaleiçi, Antalya' },
  { folded: 'muratpasa', label: 'Muratpaşa, Antalya' },
  { folded: 'konyaalti', label: 'Konyaaltı, Antalya' },
  { folded: 'lara', label: 'Lara, Antalya' },
  { folded: 'alanya', label: 'Alanya, Antalya' },
  { folded: 'bodrum', label: 'Bodrum, Muğla' },
  { folded: 'yalikavak', label: 'Yalıkavak, Bodrum' },
  { folded: 'fethiye', label: 'Fethiye, Muğla' },
  { folded: 'marmaris', label: 'Marmaris, Muğla' },
  { folded: 'datca', label: 'Datça, Muğla' },
  { folded: 'ayvalik', label: 'Ayvalık, Balıkesir' },
  { folded: 'cunda', label: 'Cunda, Ayvalık' },
  // Bursa & Eskişehir
  { folded: 'nilufer', label: 'Nilüfer, Bursa' },
  { folded: 'osmangazi', label: 'Osmangazi, Bursa' },
  { folded: 'odunpazari', label: 'Odunpazarı, Eskişehir' },
  // Major provinces
  { folded: 'istanbul', label: 'İstanbul' },
  { folded: 'izmir', label: 'İzmir' },
  { folded: 'ankara', label: 'Ankara' },
  { folded: 'antalya', label: 'Antalya' },
  { folded: 'bursa', label: 'Bursa' },
  { folded: 'eskisehir', label: 'Eskişehir' },
  { folded: 'gaziantep', label: 'Gaziantep' },
  { folded: 'adana', label: 'Adana' },
  { folded: 'mersin', label: 'Mersin' },
  { folded: 'hatay', label: 'Hatay' },
  { folded: 'antakya', label: 'Antakya, Hatay' },
  { folded: 'trabzon', label: 'Trabzon' },
  { folded: 'samsun', label: 'Samsun' },
  { folded: 'konya', label: 'Konya' },
  { folded: 'kayseri', label: 'Kayseri' },
  { folded: 'mugla', label: 'Muğla' },
  { folded: 'balikesir', label: 'Balıkesir' },
  { folded: 'canakkale', label: 'Çanakkale' },
  { folded: 'tekirdag', label: 'Tekirdağ' },
  { folded: 'edirne', label: 'Edirne' },
  { folded: 'kocaeli', label: 'Kocaeli' },
  { folded: 'izmit', label: 'İzmit, Kocaeli' },
  { folded: 'sakarya', label: 'Sakarya' },
  { folded: 'denizli', label: 'Denizli' },
  { folded: 'aydin', label: 'Aydın' },
  { folded: 'kusadasi', label: 'Kuşadası, Aydın' },
  { folded: 'manisa', label: 'Manisa' },
  { folded: 'diyarbakir', label: 'Diyarbakır' },
  { folded: 'sanliurfa', label: 'Şanlıurfa' },
  { folded: 'mardin', label: 'Mardin' },
  { folded: 'nevsehir', label: 'Nevşehir' },
  { folded: 'kapadokya', label: 'Kapadokya, Nevşehir' },
  { folded: 'erzurum', label: 'Erzurum' },
];

// Dictionary of Turkish culinary, venue, and city words for smart handle splitting & Turkish diacritic restoration
const HANDLE_TOKEN_MAP: Record<string, string> = {
  kokorec: 'Kokoreç',
  kokorecci: 'Kokoreççi',
  doner: 'Döner',
  donerci: 'Dönerci',
  iskender: 'İskender',
  kebap: 'Kebap',
  kebapci: 'Kebapçı',
  kebapcisi: 'Kebapçısı',
  kofte: 'Köfte',
  kofteci: 'Köfteci',
  koftecisi: 'Köftecisi',
  cigkofte: 'Çiğ Köfte',
  ciger: 'Ciğer',
  cigerci: 'Ciğerci',
  cigercisi: 'Ciğercisi',
  sogus: 'Söğüş',
  soguscu: 'Söğüşçü',
  lahmacun: 'Lahmacun',
  pide: 'Pide',
  pideci: 'Pideci',
  pidecisi: 'Pidecisi',
  pizza: 'Pizza',
  pizzeria: 'Pizzeria',
  burger: 'Burger',
  hamburger: 'Hamburger',
  kahve: 'Kahve',
  kahvecisi: 'Kahvecisi',
  coffee: 'Coffee',
  roastery: 'Roastery',
  bakery: 'Bakery',
  bistro: 'Bistro',
  cafe: 'Cafe',
  kafe: 'Kafe',
  pastane: 'Pastane',
  pastanesi: 'Pastanesi',
  firin: 'Fırın',
  firini: 'Fırını',
  ekmek: 'Ekmek',
  borek: 'Börek',
  borekci: 'Börekçi',
  boyoz: 'Boyoz',
  simit: 'Simit',
  tatli: 'Tatlı',
  tatlicisi: 'Tatlıcısı',
  baklava: 'Baklava',
  baklavaci: 'Baklavacı',
  kunefe: 'Künefe',
  kadayif: 'Kadayıf',
  sutlac: 'Sütlaç',
  dondurma: 'Dondurma',
  dondurmaci: 'Dondurmacı',
  waffle: 'Waffle',
  cikolata: 'Çikolata',
  chocolate: 'Chocolate',
  lokanta: 'Lokanta',
  lokantasi: 'Lokantası',
  restoran: 'Restoran',
  restaurant: 'Restaurant',
  mutfak: 'Mutfak',
  mutfagi: 'Mutfağı',
  sofra: 'Sofra',
  sofrasi: 'Sofrası',
  ocakbasi: 'Ocakbaşı',
  meyhane: 'Meyhane',
  balik: 'Balık',
  balikci: 'Balıkçı',
  balikcisi: 'Balıkçısı',
  midye: 'Midye',
  midyeci: 'Midyeci',
  tantuni: 'Tantuni',
  tantunici: 'Tantunici',
  durum: 'Dürüm',
  durumcu: 'Dürümcü',
  manti: 'Mantı',
  mantici: 'Mantıcı',
  corba: 'Çorba',
  corbaci: 'Çorbacı',
  corbacisi: 'Çorbacısı',
  kahvalti: 'Kahvaltı',
  evyemekleri: 'Ev Yemekleri',
  esnaf: 'Esnaf',
  bufe: 'Büfe',
  kumru: 'Kumru',
  kumrucu: 'Kumrucu',
  tost: 'Tost',
  tostcu: 'Tostçu',
  sandvic: 'Sandviç',
  steak: 'Steak',
  steakhouse: 'Steakhouse',
  sushi: 'Sushi',
  ramen: 'Ramen',
  makarna: 'Makarna',
  humus: 'Humus',
  meze: 'Meze',
  meshur: 'Meşhur',
  tarihi: 'Tarihi',
  lezzet: 'Lezzet',
  lezzetleri: 'Lezzetleri',
  dunyasi: 'Dünyası',
  evi: 'Evi',
  dukkani: 'Dükkanı',
  atolyesi: 'Atölyesi',
  bahce: 'Bahçe',
  bahcesi: 'Bahçesi',
  konak: 'Konak',
  konagi: 'Konağı',
  sarayi: 'Sarayı',
  usta: 'Usta',
  ustasi: 'Ustası',
  kardesler: 'Kardeşler',
  ogullari: 'Oğulları',
  ilk: 'İlk',
  isirik: 'Isırık',
  // Cities / districts
  izmir: 'İzmir',
  istanbul: 'İstanbul',
  ankara: 'Ankara',
  antalya: 'Antalya',
  bursa: 'Bursa',
  eskisehir: 'Eskişehir',
  adana: 'Adana',
  gaziantep: 'Gaziantep',
  antep: 'Antep',
  hatay: 'Hatay',
  antakya: 'Antakya',
  urfa: 'Urfa',
  sanliurfa: 'Şanlıurfa',
  diyarbakir: 'Diyarbakır',
  trabzon: 'Trabzon',
  konya: 'Konya',
  kayseri: 'Kayseri',
  mersin: 'Mersin',
  bodrum: 'Bodrum',
  fethiye: 'Fethiye',
  marmaris: 'Marmaris',
  cesme: 'Çeşme',
  alacati: 'Alaçatı',
  urla: 'Urla',
  bostanli: 'Bostanlı',
  karsiyaka: 'Karşıyaka',
  alsancak: 'Alsancak',
  bornova: 'Bornova',
  buca: 'Buca',
  kemeralti: 'Kemeraltı',
  kadikoy: 'Kadıköy',
  moda: 'Moda',
  besiktas: 'Beşiktaş',
  karakoy: 'Karaköy',
  beyoglu: 'Beyoğlu',
  nisantasi: 'Nişantaşı',
  sisli: 'Şişli',
  uskudar: 'Üsküdar',
  bakirkoy: 'Bakırköy',
  atasehir: 'Ataşehir',
  cankaya: 'Çankaya',
  bahcelievler: 'Bahçelievler',
  ayvalik: 'Ayvalık',
  cunda: 'Cunda',
  // Common single-word Turkish names that may appear in handles
  ali: 'Ali',
  mehmet: 'Mehmet',
  ahmet: 'Ahmet',
  mustafa: 'Mustafa',
  hakan: 'Hakan',
  hasan: 'Hasan',
  huseyin: 'Hüseyin',
  ibrahim: 'İbrahim',
  osman: 'Osman',
  kemal: 'Kemal',
  murat: 'Murat',
  baba: 'Baba',
  dayi: 'Dayı',
  amca: 'Amca',
  abla: 'Abla',
  anne: 'Anne',
  official: '',
  tr: '',
};

const KNOWN_SPLIT_KEYS = Object.keys(HANDLE_TOKEN_MAP)
  .filter((k) => HANDLE_TOKEN_MAP[k] !== '' && k.length >= 3)
  .sort((a, b) => b.length - a.length);

function capitalizeTr(word: string): string {
  if (!word) return '';
  return word.charAt(0).toLocaleUpperCase('tr') + word.slice(1).toLocaleLowerCase('tr');
}

function segmentConcatenatedAsciiToken(token: string): string[] {
  const lower = token.toLowerCase();
  if (HANDLE_TOKEN_MAP[lower] !== undefined) {
    return HANDLE_TOKEN_MAP[lower] ? [HANDLE_TOKEN_MAP[lower]] : [];
  }
  if (lower.length < 6) {
    return [capitalizeTr(token)];
  }

  // Greedy longest-match scan to split handles like "ilkisirikkokorec" or "cigerciapo"
  const parts: string[] = [];
  let idx = 0;
  let unknownBuffer = '';

  while (idx < lower.length) {
    let matchedKey = '';
    for (const key of KNOWN_SPLIT_KEYS) {
      if (lower.startsWith(key, idx)) {
        // Avoid splitting short words inside longer unrelated words unless remaining tail is empty or >= 2 chars
        const tailLen = lower.length - (idx + key.length);
        if (key.length >= 4 || tailLen === 0 || tailLen >= 3) {
          matchedKey = key;
          break;
        }
      }
    }

    if (matchedKey) {
      if (unknownBuffer) {
        parts.push(capitalizeTr(unknownBuffer));
        unknownBuffer = '';
      }
      parts.push(HANDLE_TOKEN_MAP[matchedKey]);
      idx += matchedKey.length;
    } else {
      unknownBuffer += lower[idx];
      idx += 1;
    }
  }

  if (unknownBuffer) {
    parts.push(capitalizeTr(unknownBuffer));
  }

  // Only accept segmentation if we matched at least one meaningful dictionary word
  return parts.length > 1 ? parts : [capitalizeTr(token)];
}

export function formatInstagramHandleAsName(username: string): string {
  const clean = username.replace(/^@/, '').trim();
  if (!clean) return '';

  // Split by delimiters and camelCase boundaries, stripping trailing numeric IDs if separated
  const rawTokens = clean
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[._\-\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const formatted: string[] = [];
  for (const token of rawTokens) {
    if (/^\d+$/.test(token)) continue;
    const strippedDigits = token.replace(/\d+$/, '');
    if (!strippedDigits) continue;
    const lower = strippedDigits.toLowerCase();
    if (HANDLE_TOKEN_MAP[lower] === '') continue; // skip noise like "official", "tr"
    const segmented = segmentConcatenatedAsciiToken(strippedDigits);
    formatted.push(...segmented);
  }

  return formatted.join(' ').trim().slice(0, STORAGE_LIMITS.NAME_MAX);
}

export function extractInstagramHandleFromUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return '';
    if (RESERVED_IG_PATHS.has(segments[0].toLowerCase())) return '';
    return segments[0].replace(/^@/, '').trim();
  } catch {
    return '';
  }
}

const CUISINE_KEYWORDS: readonly { tag: string; patterns: string[] }[] = [
  { tag: 'Kebap', patterns: ['kebap', 'kebab', 'adana', 'urfa kebap', 'cag kebap', 'beyti', 'ocakbasi'] },
  { tag: 'Köfte', patterns: ['kofte', 'izgara kofte', 'inegol', 'akcaabat', 'tekirdag kofte'] },
  { tag: 'Et', patterns: ['steak', 'steakhouse', 'steak_house', 'pirzola', 'antrikot', 'lokum et', 'kasap', 'et lokanta', 'et restoran', 'mangal'] },
  { tag: 'Tavuk', patterns: ['tavuk', 'kanat', 'pilic', 'tavukcu', 'chicken'] },
  { tag: 'Çiğ Köfte', patterns: ['cigkofte', 'cig kofte'] },
  { tag: 'Kokoreç', patterns: ['kokorec', 'sirdan', 'mumbar', 'uykuluk'] },
  { tag: 'Hamburger', patterns: ['hamburger', 'burger', 'cheeseburger', 'smash'] },
  { tag: 'Balık & Deniz Ürünleri', patterns: ['balik', 'deniz urun', 'seafood', 'fish', 'kalamar', 'karides', 'levrek', 'cipura', 'hamsi', 'ahtapot'] },
  { tag: 'Döner & İskender', patterns: ['doner', 'iskender', 'yaprak doner', 'et doner', 'tavuk doner'] },
  { tag: 'Lahmacun & Pide', patterns: ['lahmacun', 'pide', 'kiymali pide', 'kasarli pide', 'etli ekmek'] },
  { tag: 'Pizza', patterns: ['pizza', 'pizzeria', 'napoliten', 'margherita'] },
  { tag: 'Ev Yemeği', patterns: ['ev yemek', 'sulu yemek', 'esnaf lokanta', 'zeytinyagli', 'kuru fasulye', 'corba', 'iskembe', 'kelle paca'] },
  { tag: 'Kahve & Tatlı', patterns: ['kahve', 'coffee', 'coffee_shop', 'espresso', 'latte', 'roastery', 'tatli', 'pasta', 'pastry', 'baklava', 'kunefe', 'kadayif', 'waffle', 'sutlac', 'san sebastian', 'tiramisu', 'kruvasan'] },
  { tag: 'Kahvaltı', patterns: ['kahvalti', 'breakfast', 'serpme', 'brunch', 'menemen', 'boyoz', 'simit'] },
  { tag: 'Sokak Lezzetleri', patterns: ['sokak lezzet', 'sokak yemek', 'tantuni', 'midye', 'sogus', 'kumru', 'tost', 'islak hamburger', 'sandwich'] },
  { tag: 'Ciğer', patterns: ['ciger', 'arnavut ciger', 'edirne ciger'] },
  { tag: 'Mantı', patterns: ['manti', 'kayseri manti'] },
  { tag: 'Börek', patterns: ['borek', 'su boregi', 'kol boregi', 'kitir borek'] },
  { tag: 'Midye', patterns: ['midye', 'midye dolma', 'midye tava'] },
  { tag: 'Tantuni', patterns: ['tantuni'] },
  { tag: 'Söğüş', patterns: ['sogus'] },
  { tag: 'Sushi', patterns: ['sushi', 'susi', 'ramen'] },
  { tag: 'Dondurma', patterns: ['dondurma', 'gelato', 'ice_cream'] },
];

export function inferPlaceMetadataFromText(
  texts: Array<string | undefined>,
  knownRegions: string[] = []
): {
  category: PlaceCategory | null;
  cuisineTypes: string[];
  locationArea: string;
} {
  const combinedRaw = texts.filter(Boolean).join(' ');
  const folded = normalizeTurkishSearchText(combinedRaw);
  const compact = folded.replace(/[^a-z0-9]/g, '');

  const hasKeyword = (kw: string): boolean => {
    const kwFolded = normalizeTurkishSearchText(kw);
    const kwCompact = kwFolded.replace(/\s+/g, '');
    return folded.includes(kwFolded) || (kwCompact.length >= 4 && compact.includes(kwCompact));
  };

  // 1. Infer cuisine/product tags
  const cuisineTypes: string[] = [];
  for (const entry of CUISINE_KEYWORDS) {
    if (cuisineTypes.length >= STORAGE_LIMITS.MAX_CUISINE_TYPES) break;
    if (entry.patterns.some((p) => hasKeyword(p))) {
      cuisineTypes.push(entry.tag);
    }
  }

  // 2. Infer category
  let category: PlaceCategory | null = null;
  if (['pastane', 'baklava', 'kunefe', 'kadayif', 'waffle', 'dondurma', 'gelato', 'cikolata', 'profiterol', 'tatli'].some(hasKeyword)) {
    category = 'pastane';
  } else if (['kahve', 'coffee', 'espresso', 'roastery', 'matcha', 'kafe', 'cafe'].some(hasKeyword)) {
    category = 'cafe';
  } else if (['firin', 'bakery', 'ekmek', 'boyoz', 'simit', 'kruvasan', 'borek', 'pogaca'].some(hasKeyword)) {
    category = 'bakery';
  } else if (['esnaf', 'lokanta', 'sulu yemek', 'ev yemek', 'corba'].some(hasKeyword)) {
    category = 'esnaf';
  } else if (['bufe', 'kumru', 'tost', 'sandvic', 'tantuni', 'kokorec', 'midye', 'sogus', 'sokak lezzet'].some(hasKeyword)) {
    category = 'bufe';
  } else if (['pub', 'cocktail', 'kokteyl', 'bira', 'taproom', 'wine bar'].some(hasKeyword)) {
    category = 'bar';
  } else if (['bistro', 'brasserie', 'meyhane', 'ocakbasi', 'steakhouse'].some(hasKeyword)) {
    category = 'bistro';
  } else if (['restoran', 'restaurant', 'kebap', 'pide', 'lahmacun', 'balik', 'doner', 'pizza', 'burger', 'sushi'].some(hasKeyword)) {
    category = 'restaurant';
  }

  // 3. Infer region / locationArea
  let locationArea = '';
  for (const region of knownRegions) {
    const primary = region.split(',')[0]?.trim() || region.trim();
    if (primary.length >= 3 && hasKeyword(primary)) {
      locationArea = region;
      break;
    }
  }
  if (!locationArea) {
    for (const region of TURKISH_REGIONS) {
      if (region.folded.length >= 4 && hasKeyword(region.folded)) {
        locationArea = region.label;
        break;
      }
    }
  }

  return {
    category,
    cuisineTypes,
    locationArea: locationArea.slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX),
  };
}

function cleanInstagramDisplayName(rawName: string): string {
  return rawName
    .replace(/\(@[A-Za-z0-9._]+\)/g, '')
    .replace(/\s*[•·|]\s*Instagram.*$/i, '')
    .replace(/\s*-\s*Instagram.*$/i, '')
    .trim()
    .slice(0, STORAGE_LIMITS.NAME_MAX);
}

function cleanInstagramNoteSnippet(description: string): string {
  if (!description) return '';
  return description
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

export async function resolveSocialLink(
  rawInput: string,
  knownRegions: string[] = [],
  signal?: AbortSignal
): Promise<ResolvedInstagramPlace | null> {
  const parsed = extractPromoLinkInput(rawInput);
  if (!parsed.url || parsed.kind !== 'instagram') {
    return null;
  }

  let resolvedUrl = parsed.url;
  let username = extractInstagramHandleFromUrl(parsed.url);
  let displayName = '';
  let description = '';
  let locationText = '';
  let mapsUrl = '';
  let source: 'remote' | 'handle' = 'handle';

  try {
    const res = await fetch(
      `/api/resolve-social-link?url=${encodeURIComponent(parsed.url)}`,
      { signal }
    );
    if (res.ok) {
      const data = (await res.json()) as RemoteSocialResponse;
      if (data.resolvedUrl) resolvedUrl = data.resolvedUrl;
      if (data.username) username = data.username.trim();
      if (data.displayName) displayName = cleanInstagramDisplayName(data.displayName);
      if (data.description) description = data.description.trim();
      if (data.locationText) locationText = data.locationText.trim();
      if (data.mapsUrl) mapsUrl = data.mapsUrl.trim();
      if (displayName || description || locationText || mapsUrl) {
        source = 'remote';
      }
    }
  } catch {
    // Fallback gracefully to local handle/URL extraction (offline or static host)
  }

  if (signal?.aborted) {
    return null;
  }

  const handleAsName = formatInstagramHandleAsName(username);
  const name = (displayName || handleAsName || '').slice(0, STORAGE_LIMITS.NAME_MAX);
  const inferred = inferPlaceMetadataFromText(
    [displayName, handleAsName, username, description, locationText],
    knownRegions
  );

  const locationArea = (
    locationText ||
    inferred.locationArea ||
    ''
  ).slice(0, STORAGE_LIMITS.LOCATION_AREA_MAX);

  return {
    resolvedUrl,
    username,
    name,
    category: inferred.category,
    cuisineTypes: inferred.cuisineTypes,
    locationArea,
    mapsUrl,
    noteSnippet: cleanInstagramNoteSnippet(description),
    source,
  };
}
