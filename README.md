# Lumiere Git
Lumiere Git is a desktop visual Git client.

# Build and test

```bash
pnpm start:electron   # Test Electron with Vite dev server 
pnpm dev:electron     # recompile electron/ and relaunch Electron against the running dev server
pnpm make:electron    # build both + electron-builder → release/
pnpm make:flatpak     # build both + a single-file Flatpak bundle → release/
pnpm make:win         # build both + a zipped Windows x64 app → release/ (works from Linux)
```

## Flatpak

`pnpm make:flatpak` needs `flatpak` and `flatpak-builder`, plus the Flathub remote. The first build
installs the runtime it needs (`org.freedesktop.Sdk//25.08` and
`org.electronjs.Electron2.BaseApp//25.08`) for the current user.

```bash
flatpak install --user "release/Lumiere Git-0.0.1-x86_64.flatpak"
flatpak run com.lolumi.lumieregit
```

The app runs git, ssh, gpg and git-lfs from the Flatpak runtime rather than the host's, and the
built-in terminal is a shell inside the sandbox.
