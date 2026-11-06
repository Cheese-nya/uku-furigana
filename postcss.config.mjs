const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // Tailwind expands all imports here; preserve layer priority for pre-99 WebViews.
    "@csstools/postcss-cascade-layers": {},
  },
};

export default config;
