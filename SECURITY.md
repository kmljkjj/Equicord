# Security Policy

## Reporting a vulnerability

Please do not open public issues for security problems. Instead:

1. Use GitHub's **private vulnerability reporting** for this repository (*Security → Report a vulnerability*), or
2. Contact the repository owner directly via GitHub.

Please include: the affected component (web extension / userscript / desktop injection / build scripts), steps to reproduce, an impact assessment, and a proof of concept if you have one. Reports are taken seriously and you will receive an acknowledgement as soon as possible.

## Scope

- All code in this repository, including build scripts, GitHub workflows and released assets.
- The browser extension and userscript published from this repository's releases.

Out of scope for this repository (report upstream):

- The Equilotl installer project: https://github.com/Equicord/Equilotl
- Third-party/user plugins that are not bundled here.

## Known security considerations

- **Installer downloads**: `pnpm inject` downloads a prebuilt installer binary from Equilotl's GitHub releases and executes it. When a `.sha256` checksum is published alongside the binary, it is verified before execution. A compromise of the upstream Equilotl repository or GitHub account is outside this repository's control — treat upstream releases with the same care as any third-party binary.
- **Self-updater (web extension)**: the in-app Updater downloads new builds exclusively from this repository's GitHub releases. The update channel is therefore only as trustworthy as this GitHub repository.
- **Runtime patching**: Equicord patches Discord's client at runtime. Only install builds from sources you trust, and review userplugins before adding them.
