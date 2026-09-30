/** @type {import('tailwindcss').Config} */

/**
 * JjeloTech design tokens.
 *
 * Palette and type come from design/JjeloTech Mockups.html. The anchor values
 * are the ones the mockups actually use; surrounding steps are derived to give
 * usable scales.
 *
 * Theme is switched by a `dark` class on <html>, set by ThemeProvider. Screens
 * pick their theme by surface, not by user preference: admin and record
 * surfaces are light; capture, auth, superadmin and marketing are dark.
 */

// Primary — JjeloTech blue. 600 is the anchor (#1d4ed8).
const brand = {
  50: '#eef3fd',
  100: '#dbe6fb',
  200: '#bed2f8',
  300: '#8fb3ff',
  400: '#5b8def',
  500: '#3366e0',
  600: '#1d4ed8', // anchor
  700: '#1a43b8',
  800: '#173a99',
  900: '#152f78',
  950: '#0f1f4d',
}

// Accent — JjeloTech orange. 500 is the anchor (#f7941d).
// Deliberately sparing: the EMS hero tile, primary actions on dark surfaces,
// and needs-attention states. Not a general-purpose accent.
const accent = {
  50: '#fef6ec',
  100: '#fce9cf',
  200: '#f9d5a2',
  300: '#f7b35e', // warning text and borders in the mockups
  400: '#f7a23d',
  500: '#f7941d', // anchor
  600: '#d97c12',
  700: '#a8600f',
  800: '#8a5712', // warning text on light surfaces
  900: '#6b4310',
}

const success = {
  50: '#e7f8f0',
  100: '#d1f0e2',
  300: '#6fe0a8',
  400: '#34cc86',
  500: '#12b76a',
  600: '#0d9a59',
  700: '#067647',
}

export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand,
        accent,
        success,

        // Neutrals — the mockups' text and surface greys.
        ink: {
          50: '#f7f9fc',
          100: '#f2f4f9',
          200: '#eef1f7',
          250: '#e6eaf2',
          300: '#e0e5ee',
          400: '#a9b7cd',
          450: '#93a2bb',
          500: '#7f8fab',
          550: '#667085',
          600: '#5a667c',
          700: '#475467',
          800: '#344054',
          900: '#101828', // darkest text, and the lighter dark surface
          950: '#0b1220', // darkest ground
        },

        danger: {
          50: '#fdeceb',
          100: '#fbd9d7',
          400: '#e8564a',
          500: '#d9352a',
          600: '#b42318',
          700: '#912019',
        },

        /**
         * Compatibility aliases.
         *
         * ~75 class names across the app still use the primary and secondary
         * scales. Pointing both at brand makes them render as JjeloTech blue
         * immediately, so nothing looks stale mid-migration. `secondary` is
         * offset two steps darker so existing primary→secondary gradients keep
         * their depth instead of going flat.
         *
         * Remove both once the pages are restyled (step 4 of DESIGN_AUDIT.md).
         */
        primary: brand,
        secondary: {
          50: brand[100],
          100: brand[200],
          200: brand[300],
          300: brand[400],
          400: brand[500],
          500: brand[600],
          600: brand[700],
          700: brand[800],
          800: brand[900],
          900: brand[950],
        },
      },

      fontFamily: {
        sans: ['Archivo', 'system-ui', '-apple-system', 'sans-serif'],
      },

      boxShadow: {
        // The mockups use elevation sparingly — soft and close, not dramatic.
        card: '0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.10)',
        raised: '0 4px 8px -2px rgba(16, 24, 40, 0.10), 0 2px 4px -2px rgba(16, 24, 40, 0.06)',
        overlay: '0 12px 16px -4px rgba(16, 24, 40, 0.08), 0 4px 6px -2px rgba(16, 24, 40, 0.03)',
        modal: '0 20px 24px -4px rgba(16, 24, 40, 0.08), 0 8px 8px -4px rgba(16, 24, 40, 0.03)',
        // Kept: existing pages reference these until they are restyled.
        soft: '0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.05)',
        glow: '0 0 20px rgba(29, 78, 216, 0.3)',
      },

      animation: {
        float: 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },

      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
  plugins: [],
}
