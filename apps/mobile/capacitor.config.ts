import type { CapacitorConfig } from '@capacitor/cli';

// The iOS and Android apps run the same SvelteKit build as the web app, so every platform has the same features.
const config: CapacitorConfig = {
	appId: 'com.countx3.app',
	appName: 'countx3',
	webDir: '../web/build',
};

export default config;
