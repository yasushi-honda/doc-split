/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        // DocSplit テーマカラー（ダークブルー）
        brand: {
          50: '#f0f4ff',
          100: '#e0e8ff',
          200: '#c7d4fe',
          300: '#a4b8fc',
          400: '#7c92f8',
          500: '#5a6df1',
          600: '#4149e5',
          700: '#353bcb',
          800: '#2d33a4',
          900: '#1a365d', // メインカラー
          950: '#0f172a',
        },
      },
    },
  },
  plugins: [],
}
