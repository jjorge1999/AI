import { defineConfig } from 'cypress';
import { nxE2EPreset } from '@nx/cypress/plugins/cypress-preset';

export default defineConfig({
  e2e: {
    ...nxE2EPreset(__filename, {
      cypressDir: 'e2e/src',
      webServerCommands: {
        default: 'npx nx serve',
      },
      ciWebServerCommand: 'npx nx serve',
    }),
    baseUrl: 'http://localhost:4200',
    supportFile: 'e2e/src/support/e2e.ts',
    specPattern: 'e2e/src/e2e/**/*.cy.{js,jsx,ts,tsx}',
    defaultCommandTimeout: 15000,
    requestTimeout: 15000,
    responseTimeout: 15000,
  },
});
