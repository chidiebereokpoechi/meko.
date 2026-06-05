/** @type {import('tailwindcss').Config} */
// Theme lifted from spenny.io-web: the same primary purple + slate palette.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#6e24ff",
        "primary-dark": "#3600a3",
      },
    },
  },
  plugins: [],
};
