import type { Configuration } from "electron-builder";

const config: Configuration = {
  appId: "com.lolumi.lumieregit",
  productName: "Lumiere Git",
  copyright: "Copyright (C) Logiciel Lumiere",
  directories: {
    output: "release",
    // SvelteKit already writes the renderer to build/, electron-builder's default resources dir.
    buildResources: "resources",
  },
  files: [
    "build/**",
    "electron/dist/**",
    // Marks electron/dist as CommonJS inside the ESM root package.
    "electron/package.json",
    "package.json",
    "!**/*.map",
  ],
  // Native module must live outside the asar archive to be loadable.
  asarUnpack: ["**/node_modules/node-pty/**"],
  npmRebuild: true,
  linux: {
    target: ["AppImage", "deb"],
    // Hicolor sizes resized from appIcon.png; regenerate them when the icon changes.
    icon: "assets/icons",
    category: "Development",
    syncDesktopName: true,
    maintainer: "Logiciel Lumiere <support@lolumi.com>",
    desktop: {
      entry: {
        Name: "Lumiere Git",
        Icon: "lumiere-git",
        Comment: "Lumiere Git is a desktop visual Git client.",
        Categories: "Utility",
        Keywords: "git;development",
        StartupWMClass: "com.lolumi.lumieregit",
        Terminal: "false",
        Type: "Application",
      },
    },
  },
  // Built separately with `pnpm make:flatpak` (needs flatpak + flatpak-builder on the build machine).
  flatpak: {
    // The Sdk doubles as the runtime: unlike the Platform it ships git, ssh and gpg, which the
    // app runs inside the sandbox.
    runtime: "org.freedesktop.Sdk",
    runtimeVersion: "25.08",
    sdk: "org.freedesktop.Sdk",
    base: "org.electronjs.Electron2.BaseApp",
    baseVersion: "25.08",
    // Flatpak only exports icons named after the app id.
    desktop: { entry: { Icon: "com.lolumi.lumieregit" } },
    finishArgs: [
      "--socket=wayland",
      "--socket=x11",
      "--share=ipc",
      "--device=dri",
      "--share=network",
      // Repositories can live anywhere, including removable drives.
      "--filesystem=host",
      "--socket=ssh-auth",
      "--socket=gpg-agent",
      // OS keyring, for safeStorage.
      "--talk-name=org.freedesktop.secrets",
      "--talk-name=org.kde.kwalletd5",
      "--talk-name=org.kde.kwalletd6",
      "--talk-name=org.freedesktop.Notifications",
    ],
  },
  mac: {
    target: ["dmg"],
    category: "public.app-category.developer-tools",
    icon: "assets/appIcon.png",
  },
  win: {
    target: ["nsis"],
    icon: "assets/appIcon.ico",
  },
  // `-p always` in make:electron publishes here. Replace with your release server
  // (e.g. a `generic` provider behind gitea.lolumi.com) before cutting releases.
  publish: null,
};

export default config;
