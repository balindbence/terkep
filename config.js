// Úthírnök beállítások
// ---------------------------------------------------------------
// KÖZÖSSÉGI MÓD: töltsd ki a Supabase projekted adataival (README.md),
// és akkor mindenki látja mindenki jelzését élőben.
// Ha üresen hagyod, az app HELYI módban fut (csak a saját eszközödön tárol).
window.UTHIRNOK_CONFIG = {
  SUPABASE_URL: "",        // pl. "https://abcdxyz.supabase.co"
  SUPABASE_ANON_KEY: "",   // Project Settings → API → anon public key

  // Ingyenes nyilvános szolgáltatások (később cserélhetők sajátra)
  OSRM_URL: "https://router.project-osrm.org",
  NOMINATIM_URL: "https://nominatim.openstreetmap.org",
  OVERPASS_URL: "https://overpass-api.de/api/interpreter",

  // Kezdő térképközép, ha nincs GPS (Bicske)
  DEFAULT_CENTER: [47.4906, 18.6366],
  DEFAULT_ZOOM: 13,

  // Frissítés-figyelés az asztali és androidos appban (GitHub Releases)
  GITHUB_REPO: "balindbence/uthirnok",

  // Milyen gyakran frissüljenek a közösségi jelzések (ms)
  POLL_MS: 15000,
};
