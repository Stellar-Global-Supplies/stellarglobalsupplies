/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sgs: {
          green:  '#00B98E',
          green2: '#00D4A3',
          green3: '#00F0B8',
          cyan:   '#00E5FF',
          navy:   '#020617',
          dark:   '#060f1e',
          mid:    '#0c1a2e',
        },
        agent: {
          analyst:    '#6366f1',
          strategist: '#8b5cf6',
          business:   '#06b6d4',
          cloud:      '#f59e0b',
          marketing:  '#10b981',
          executive:  '#ef4444',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      spacing: {
        'sidebar':    '268px',
        'sidebar-sm': '68px',
        'header':     '64px',
      },
      animation: {
        'fade-in':    'fadeIn 0.35s ease-out',
        'slide-up':   'slideUp 0.30s ease-out',
        'shimmer':    'shimmer 2.2s linear infinite',
        'blink':      'blink 1s step-start infinite',
        'spin-slow':  'spin 6s linear infinite',
        'orb':        'orb 14s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:   { from: { opacity: '0', transform: 'translateY(8px)' },  to: { opacity: '1', transform: 'translateY(0)' } },
        slideUp:  { from: { opacity: '0', transform: 'translateY(18px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer:  { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        blink:    { '50%': { opacity: '0' } },
        orb:      { '0%,100%': { transform: 'scale(1) translate(0,0)' }, '33%': { transform: 'scale(1.08) translate(30px,-20px)' }, '66%': { transform: 'scale(0.95) translate(-20px,20px)' } },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'sgs-grid': "url(\"data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 .5H40M.5 0V40' stroke='%2300B98E' stroke-opacity='0.05'/%3E%3C/svg%3E\")",
      },
      boxShadow: {
        'glow-green': '0 0 30px rgba(0,185,142,0.30)',
        'glow-cyan':  '0 0 30px rgba(0,229,255,0.20)',
        'sgs':        '0 32px 96px rgba(0,0,0,0.60)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      dropShadow: {
        'glow': ['0 0 12px rgba(0,185,142,0.40)'],
      },
    },
  },
  plugins: [],
};
