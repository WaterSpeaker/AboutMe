// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
	site: 'https://WaterSpeaker.github.io',
	base: '/AboutMe/',
	vite: {
		plugins: [tailwindcss()],
	},
});
