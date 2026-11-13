import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  // WXT defaults Firefox to MV2; we need MV3 everywhere (storage.session, alarms).
  manifestVersion: 3,
  manifest: {
    name: 'Tabbed In',
    description: 'Lock yourself to one tab until the timer ends.',
    permissions: ['tabs', 'alarms', 'storage'],
    action: { default_title: 'Tabbed In' },
    browser_specific_settings: {
      gecko: {
        id: 'tabbed-in@ankrypted',
        // Required by AMO for new extensions; we collect nothing.
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});
