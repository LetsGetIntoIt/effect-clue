import { defineConfig } from 'vite';
import cssAutoImport from 'vite-plugin-css-auto-import';
import preact from '@preact/preset-vite';

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [cssAutoImport(), preact()],
});
