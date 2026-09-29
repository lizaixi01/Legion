# Current project location

The active source project is D:/Projects/Proactive Agent. The earlier GUI development copy was merged on 2026-09-29 and retained at .local/consolidation/retired-gui-copy for recovery.

The desktop Legion shortcut currently opens the installed application at %LOCALAPPDATA%/Programs/Legion/Legion.exe. It does not automatically rebuild source changes. After building TypeScript, package with electron-builder and update the installed application while it is closed. The executable and resources/app.asar must come from the same build (ASAR integrity). User data lives in %APPDATA%/legion and must be preserved.

2026-09-29: the general-project-chat fix was built and deployed to that installation. Previous executable and archive are backed up in .local/installed-before-general-chat. Source development remains available via npm run desktop; its separate data directory is .gui-profile. Do not confuse that development window with the installed application's data.

## Legion Beta desktop entry

Desktop `Legion Beta.lnk` launches `desktop/launch-beta.ps1` from this source project. It builds TypeScript on every launch, logs to `.gui-profile/beta-launch.log`, and starts Electron only after a successful build. Failures display a message with the log path. No second source project is created. The shortcut uses the same icon as Legion.

Development windows are titled Legion Beta and use a separate Windows AppUserModelID. Development chats remain in the source project's .chats directory and browser settings in .gui-profile; installed Legion keeps its data in %APPDATA%/legion. Both can run simultaneously. If Beta is already running, clicking the shortcut focuses that instance; close and reopen Beta after backend changes to load the new build.

Verified 2026-09-29: actual desktop shortcut opened a Legion Beta window alongside installed Legion. A second click reused the Beta window. An isolated failing compiler fixture returned exit code 1 without launching the app; the real build and main-process syntax check passed.
