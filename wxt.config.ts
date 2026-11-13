import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  // WXT defaults Firefox to MV2; we need MV3 everywhere (storage.session, alarms).
  manifestVersion: 3,
  hooks: {
    // WXT adds host_permissions for runtime-registered content scripts. We want
    // site access to be optional (requested on first Start), so strip it.
    'build:manifestGenerated': (_wxt, manifest) => {
      delete manifest.host_permissions;
    },
  },
  manifest: {
    name: 'Tabbed In',
    description: 'Lock yourself to one tab until the timer ends.',
    // notifications + offscreen: the bell and notification when the timer ends.
    permissions: ['tabs', 'alarms', 'storage', 'scripting', 'notifications', 'offscreen'],
    // Site access for the on-page widget is requested on first Start, not at install.
    optional_host_permissions: ['<all_urls>'],
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
