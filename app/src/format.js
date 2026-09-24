// Formátování hodnot pro overlay (česká lokalizace).

const numberFormats = new Map();

export function formatNumber(value, decimals) {
  if (!numberFormats.has(decimals)) {
    numberFormats.set(decimals, new Intl.NumberFormat('cs-CZ', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }));
  }
  return numberFormats.get(decimals).format(value);
}

/** Číselná hodnota entity, nebo null (unavailable, unknown, nečíselné). */
export function numericState(entity) {
  if (!entity) return null;
  const n = Number.parseFloat(entity.state);
  return Number.isFinite(n) ? n : null;
}

const CARDINALS = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];

/** Meteorologický směr (odkud vítr vane) na českou světovou stranu. */
export function cardinal(degrees) {
  return CARDINALS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

/**
 * Přepočet tlaku stanice na hladinu moře (barometrická rovnice, standardní
 * teplotní gradient). Pro stanici bez nastavené nadmořské výšky.
 */
export function seaLevelPressure(stationHpa, altitudeM, temperatureC) {
  const t = (temperatureC ?? 15) + 273.15;
  return stationHpa * (1 - (0.0065 * altitudeM) / (t + 0.0065 * altitudeM)) ** -5.257;
}

const CONDITIONS = {
  'clear-night': 'jasno',
  cloudy: 'zataženo',
  exceptional: 'výjimečné počasí',
  fog: 'mlha',
  hail: 'kroupy',
  lightning: 'bouřky',
  'lightning-rainy': 'bouřky s deštěm',
  partlycloudy: 'polojasno',
  pouring: 'liják',
  rainy: 'déšť',
  snowy: 'sněžení',
  'snowy-rainy': 'déšť se sněhem',
  sunny: 'slunečno',
  windy: 'větrno',
  'windy-variant': 'větrno, oblačno',
};

export function conditionText(state) {
  return CONDITIONS[state] ?? null;
}

/** Míra oblačnosti 0–1 pro obarvení oblohy podle stavu weather entity. */
export function cloudiness(state) {
  switch (state) {
    case 'sunny': case 'clear-night': return 0;
    case 'partlycloudy': case 'windy': return 0.35;
    case 'windy-variant': return 0.55;
    case 'cloudy': case 'fog': return 0.8;
    case 'rainy': case 'snowy': case 'snowy-rainy': case 'hail': return 0.85;
    case 'pouring': case 'lightning': case 'lightning-rainy': return 1;
    default: return 0.2;
  }
}

const timeFormat = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });

export const formatTime = (date) => timeFormat.format(date);
export const formatDate = (date) => dateFormat.format(date);

/** „před 2 h“ apod. pro stáří dat. */
export function formatAge(seconds) {
  if (seconds < 3600) return `před ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `před ${Math.round(seconds / 3600)} h`;
  return `před ${Math.round(seconds / 86400)} d`;
}
