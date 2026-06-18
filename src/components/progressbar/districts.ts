export const DISTRICT_OPTIONS = [
  {
    id: 'kalburagi',
    label: 'NSL Sugars, Aland, Kalburagi',
    shortLabel: 'Aland, Kalburagi',
  },
  {
    id: 'vijayapura',
    label: 'ICPL Sugar Factory, Indi, Vijayapura',
    shortLabel: 'Indi, Vijayapura',
  },
  {
    id: 'bagalkot',
    label: 'ICPL Sugar Factory, Mudhol, Bagalkot',
    shortLabel: 'Mudhol, Bagalkot',
  },
  {
    id: 'mandya',
    label: 'Chamundeshwari Sugars, Maddur, Mandya',
    shortLabel: 'Maddur, Mandya',
  },
] as const;

export type DistrictId = (typeof DISTRICT_OPTIONS)[number]['id'];
