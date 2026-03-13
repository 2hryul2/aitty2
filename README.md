# Aitty

Aitty is a Windows desktop SSH + AI terminal application built with:

- `WPF (.NET 8)` as the native desktop host
- `WebView2` for the embedded frontend shell
- `React + Vite` for the actual UI
- `SSH.NET` for SSH connectivity
- Anthropic Claude API integration for the AI panel

## Architecture

This repository is a hybrid desktop app.

- `src/Aitty/`
  - WPF desktop host
  - WebView2 container
  - IPC bridge handlers
  - SSH / config / key / AI services in C#
- `webapp/`
  - React frontend loaded into WebView2 during development and packaged for production later

The WPF app talks to the frontend through JSON-based IPC messages.

## Requirements

- Windows
- `.NET 8 SDK`
- Node.js 18+
- npm 9+
- WebView2 Runtime

## Development Run

You need two processes during development.

### 1. Start the web frontend

```powershell
cd D:\source\aitty2\webapp
npm.cmd install
npm.cmd run dev
```

This starts Vite on `http://localhost:5173`.

### 2. Start the WPF host app

In a second terminal:

```powershell
cd D:\source\aitty2
dotnet run --project .\src\Aitty\Aitty.csproj
```

In `DEBUG`, the WPF app loads the frontend from `http://localhost:5173` inside WebView2.

## Environment Variables

Use `.env.example` as reference.

- Frontend build-time defaults (`VITE_*`)
  - `VITE_DEFAULT_SSH_HOST`
  - `VITE_DEFAULT_SSH_PORT`
  - `VITE_DEFAULT_SSH_USERNAME`
  - `VITE_DEFAULT_OLLAMA_ENDPOINT`
- Backend runtime default
  - `AITTY_OLLAMA_ENDPOINT`

## Current UI

The app currently renders:

- a top header with app title and subtitle
- a left `SSH Terminal` panel
  - connection form for host / port / username / password / private key
  - xterm.js terminal surface
  - connect / disconnect / clear controls
- a draggable center splitter
- a right `AI CLI Terminal` panel
  - xterm.js-based AI terminal
  - Claude API configuration commands
  - model switching and streaming status badges

## SSH Features

Implemented in `src/Aitty/Services/SshService.cs`:

- password authentication
- private key authentication
- shell stream creation
- shell write / read
- one-shot command execution
- connection state tracking

## AI Features

Implemented in `src/Aitty/Services/ClaudeApiService.cs`:

- Claude Messages API calls
- streaming responses
- model switching
- conversation history
- system prompt configuration

## Testing

Frontend tests:

```powershell
cd D:\source\aitty2\webapp
npm.cmd test
npm.cmd run test:ui
```

WPF build check:

```powershell
cd D:\source\aitty2
dotnet build .\src\Aitty\Aitty.csproj
```

## Important Note

Before any release or deployment build, explicit user confirmation must be obtained first.

## Security Note

SSH `password` and `passphrase` are not persisted to config storage. Only non-secret connection metadata is saved.

## Known Issues

- The previous README described the repository like a root-level Node app, which was incorrect.
- Production packaging flow is not fully documented yet.

## Repository Layout

```text
Aitty.sln
src/
  Aitty/
    App.xaml
    MainWindow.xaml
    Ipc/
    Models/
    Services/
webapp/
  src/
  package.json
  vite.config.ts
.env.example
README.md
```
