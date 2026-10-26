/* Quantum Xi Mine Atlas: runtime configuration.
   Map tiles default to Esri's keyless public tile services. To use keyed tiles, set ONE of the keys below
   (or let the GitHub Actions deploy step write this file from the MAPTILER_KEY / ESRI_API_KEY repository secrets).
   Keys used in a browser are public: restrict them to your Pages domain in the provider's dashboard.
   provider: 'esri' (keyless, default) | 'esri-key' (ArcGIS Location Platform API key) | 'maptiler' */
window.QX_CONFIG = {
  tiles: {
    provider: 'esri',
    esriApiKey: '',
    maptilerKey: ''
  }
};
