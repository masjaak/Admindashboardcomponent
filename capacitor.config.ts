import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.freshbloom.admindashboard',
  appName: 'HouseApp Admin',
  webDir: 'build',
  server: {
    iosScheme: 'http',
  },
};

export default config;
