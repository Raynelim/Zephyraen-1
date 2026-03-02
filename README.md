# Zephyraen Text RPG

A black-and-white browser text RPG prototype with Firebase Authentication and Realtime Database.

## Pages
- `index.html` (Login)
- `signup.html` (Signup)
- `game.html` (Game)

## Firebase
- Email/password authentication is enabled in `auth.js`.
- User stats are stored in Realtime Database at `players/{uid}/stats`.

## Run
1. Run the project from a local static server (for example VS Code Live Server).
2. Open `index.html` from the server URL.
3. Do not run via `file://` for Firebase module imports.

## Notes
- Current game scope is minimal (`Village` + `Settings`) and intended as a base for next features.
