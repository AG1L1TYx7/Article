/**
 * Nepal's provinces and districts, as the constitution and the gazette
 * define them.
 *
 * Reference data, kept in code rather than typed into a table by hand, so
 * that every deployment has the same seventy-seven districts spelled the
 * same way. Two people typing "Kathmandu" and "काठमाडौँ" have to reach the
 * same row or the alerting is quietly wrong for one of them.
 *
 * Both names are carried because the interface is bilingual and because a
 * Nepali speaker reporting from Rautahat should not have to pick their own
 * district out of an English list.
 *
 * Ids are slugs rather than generated: they appear in URLs
 * (/issues/district/rautahat), they are referenced by the seed, and a
 * stable readable id is worth more here than an opaque one.
 *
 * **What is not here:** the 753 local levels. A half-remembered list of
 * those is worse than none, because it looks authoritative and quietly
 * misfiles reports. District is the finest granularity anything depends on
 * today; Municipality exists in the schema so adding them later is a seed
 * rather than a migration. They should come from the Ministry of Federal
 * Affairs' own published list, not from memory.
 *
 * Sources for what is here: the Constitution of Nepal (Schedule 4, as
 * amended when the provinces were named), and the Election Commission's
 * district list.
 */

export interface DistrictSeed {
  id: string;
  name: string;
  nameNe: string;
}

export interface ProvinceSeed {
  id: string;
  number: number;
  name: string;
  nameNe: string;
  capital: string;
  districts: DistrictSeed[];
}

export const PROVINCES: ProvinceSeed[] = [
  {
    id: "koshi",
    number: 1,
    name: "Koshi",
    nameNe: "कोशी",
    capital: "Biratnagar",
    districts: [
      { id: "bhojpur", name: "Bhojpur", nameNe: "भोजपुर" },
      { id: "dhankuta", name: "Dhankuta", nameNe: "धनकुटा" },
      { id: "ilam", name: "Ilam", nameNe: "इलाम" },
      { id: "jhapa", name: "Jhapa", nameNe: "झापा" },
      { id: "khotang", name: "Khotang", nameNe: "खोटाङ" },
      { id: "morang", name: "Morang", nameNe: "मोरङ" },
      { id: "okhaldhunga", name: "Okhaldhunga", nameNe: "ओखलढुङ्गा" },
      { id: "panchthar", name: "Panchthar", nameNe: "पाँचथर" },
      { id: "sankhuwasabha", name: "Sankhuwasabha", nameNe: "संखुवासभा" },
      { id: "solukhumbu", name: "Solukhumbu", nameNe: "सोलुखुम्बु" },
      { id: "sunsari", name: "Sunsari", nameNe: "सुनसरी" },
      { id: "taplejung", name: "Taplejung", nameNe: "ताप्लेजुङ" },
      { id: "terhathum", name: "Terhathum", nameNe: "तेह्रथुम" },
      { id: "udayapur", name: "Udayapur", nameNe: "उदयपुर" },
    ],
  },
  {
    id: "madhesh",
    number: 2,
    name: "Madhesh",
    nameNe: "मधेश",
    capital: "Janakpur",
    districts: [
      { id: "bara", name: "Bara", nameNe: "बारा" },
      { id: "dhanusha", name: "Dhanusha", nameNe: "धनुषा" },
      { id: "mahottari", name: "Mahottari", nameNe: "महोत्तरी" },
      { id: "parsa", name: "Parsa", nameNe: "पर्सा" },
      { id: "rautahat", name: "Rautahat", nameNe: "रौतहट" },
      { id: "saptari", name: "Saptari", nameNe: "सप्तरी" },
      { id: "sarlahi", name: "Sarlahi", nameNe: "सर्लाही" },
      { id: "siraha", name: "Siraha", nameNe: "सिराहा" },
    ],
  },
  {
    id: "bagmati",
    number: 3,
    name: "Bagmati",
    nameNe: "बागमती",
    capital: "Hetauda",
    districts: [
      { id: "bhaktapur", name: "Bhaktapur", nameNe: "भक्तपुर" },
      { id: "chitwan", name: "Chitwan", nameNe: "चितवन" },
      { id: "dhading", name: "Dhading", nameNe: "धादिङ" },
      { id: "dolakha", name: "Dolakha", nameNe: "दोलखा" },
      { id: "kathmandu", name: "Kathmandu", nameNe: "काठमाडौँ" },
      { id: "kavrepalanchok", name: "Kavrepalanchok", nameNe: "काभ्रेपलाञ्चोक" },
      { id: "lalitpur", name: "Lalitpur", nameNe: "ललितपुर" },
      { id: "makwanpur", name: "Makwanpur", nameNe: "मकवानपुर" },
      { id: "nuwakot", name: "Nuwakot", nameNe: "नुवाकोट" },
      { id: "ramechhap", name: "Ramechhap", nameNe: "रामेछाप" },
      { id: "rasuwa", name: "Rasuwa", nameNe: "रसुवा" },
      { id: "sindhuli", name: "Sindhuli", nameNe: "सिन्धुली" },
      { id: "sindhupalchok", name: "Sindhupalchok", nameNe: "सिन्धुपाल्चोक" },
    ],
  },
  {
    id: "gandaki",
    number: 4,
    name: "Gandaki",
    nameNe: "गण्डकी",
    capital: "Pokhara",
    districts: [
      { id: "baglung", name: "Baglung", nameNe: "बागलुङ" },
      { id: "gorkha", name: "Gorkha", nameNe: "गोरखा" },
      { id: "kaski", name: "Kaski", nameNe: "कास्की" },
      { id: "lamjung", name: "Lamjung", nameNe: "लमजुङ" },
      { id: "manang", name: "Manang", nameNe: "मनाङ" },
      { id: "mustang", name: "Mustang", nameNe: "मुस्ताङ" },
      { id: "myagdi", name: "Myagdi", nameNe: "म्याग्दी" },
      { id: "nawalpur", name: "Nawalpur", nameNe: "नवलपुर" },
      { id: "parbat", name: "Parbat", nameNe: "पर्वत" },
      { id: "syangja", name: "Syangja", nameNe: "स्याङ्जा" },
      { id: "tanahun", name: "Tanahun", nameNe: "तनहुँ" },
    ],
  },
  {
    id: "lumbini",
    number: 5,
    name: "Lumbini",
    nameNe: "लुम्बिनी",
    capital: "Deukhuri",
    districts: [
      { id: "arghakhanchi", name: "Arghakhanchi", nameNe: "अर्घाखाँची" },
      { id: "banke", name: "Banke", nameNe: "बाँके" },
      { id: "bardiya", name: "Bardiya", nameNe: "बर्दिया" },
      { id: "dang", name: "Dang", nameNe: "दाङ" },
      { id: "eastern-rukum", name: "Eastern Rukum", nameNe: "रुकुम पूर्व" },
      { id: "gulmi", name: "Gulmi", nameNe: "गुल्मी" },
      { id: "kapilvastu", name: "Kapilvastu", nameNe: "कपिलवस्तु" },
      { id: "palpa", name: "Palpa", nameNe: "पाल्पा" },
      { id: "parasi", name: "Parasi", nameNe: "परासी" },
      { id: "pyuthan", name: "Pyuthan", nameNe: "प्युठान" },
      { id: "rolpa", name: "Rolpa", nameNe: "रोल्पा" },
      { id: "rupandehi", name: "Rupandehi", nameNe: "रुपन्देही" },
    ],
  },
  {
    id: "karnali",
    number: 6,
    name: "Karnali",
    nameNe: "कर्णाली",
    capital: "Birendranagar",
    districts: [
      { id: "dailekh", name: "Dailekh", nameNe: "दैलेख" },
      { id: "dolpa", name: "Dolpa", nameNe: "डोल्पा" },
      { id: "humla", name: "Humla", nameNe: "हुम्ला" },
      { id: "jajarkot", name: "Jajarkot", nameNe: "जाजरकोट" },
      { id: "jumla", name: "Jumla", nameNe: "जुम्ला" },
      { id: "kalikot", name: "Kalikot", nameNe: "कालिकोट" },
      { id: "mugu", name: "Mugu", nameNe: "मुगु" },
      { id: "salyan", name: "Salyan", nameNe: "सल्यान" },
      { id: "surkhet", name: "Surkhet", nameNe: "सुर्खेत" },
      { id: "western-rukum", name: "Western Rukum", nameNe: "रुकुम पश्चिम" },
    ],
  },
  {
    id: "sudurpashchim",
    number: 7,
    name: "Sudurpashchim",
    nameNe: "सुदूरपश्चिम",
    capital: "Godawari",
    districts: [
      { id: "achham", name: "Achham", nameNe: "अछाम" },
      { id: "baitadi", name: "Baitadi", nameNe: "बैतडी" },
      { id: "bajhang", name: "Bajhang", nameNe: "बझाङ" },
      { id: "bajura", name: "Bajura", nameNe: "बाजुरा" },
      { id: "dadeldhura", name: "Dadeldhura", nameNe: "डडेलधुरा" },
      { id: "darchula", name: "Darchula", nameNe: "दार्चुला" },
      { id: "doti", name: "Doti", nameNe: "डोटी" },
      { id: "kailali", name: "Kailali", nameNe: "कैलाली" },
      { id: "kanchanpur", name: "Kanchanpur", nameNe: "कञ्चनपुर" },
    ],
  },
];

/** Every district, flattened, with the province it belongs to. */
export const DISTRICTS: (DistrictSeed & { provinceId: string })[] = PROVINCES.flatMap((p) =>
  p.districts.map((d) => ({ ...d, provinceId: p.id }))
);

export const DISTRICT_COUNT = DISTRICTS.length;
export const PROVINCE_COUNT = PROVINCES.length;
