/** @type {import('tailwindcss').Config} */
module.exports = {
 // This content array tells Tailwind where to look for class names in your files.
 content: [
   "./index.html",
   "./src/**/*.{js,ts,jsx,tsx}",
 ],
 theme: {
   extend: {
     fontFamily: {
       // Defines 'Inter' as a custom font utility.
       inter: ['Inter', 'sans-serif'],
     }
   },
 },
 plugins: [],
}