# Biome

Overworld's local desktop client for running Waypoint world models. Biome connects to a local GPU server to stream interactive AI-generated environments.

## Requirements

- Node.js 18+
- Rust (latest stable)
- A running Waypoint GPU server

## Installation

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Configuration

Biome stores its configuration in your system's app config directory:

- **Windows:** `%APPDATA%\com.owl.biome\config.json`
- **macOS:** `~/Library/Application Support/com.owl.biome/config.json`
- **Linux:** `~/.config/com.owl.biome/config.json`

You can open the config file directly from the app by clicking the gear icon in the bottom-right corner.

### Config Options

```json
{
  "gpu_server": {
    "host": "localhost",
    "port": 8082,
    "use_ssl": false
  },
  "api_keys": {
    "openai": "",
    "fal": ""
  },
  "features": {
    "prompt_sanitizer": true,
    "seed_generation": false
  }
}
```

| Option | Description |
|--------|-------------|
| `gpu_server.host` | Hostname of the Waypoint GPU server |
| `gpu_server.port` | Port number (default: 8082) |
| `gpu_server.use_ssl` | Use WSS instead of WS |
| `api_keys.openai` | OpenAI API key for prompt sanitization |
| `api_keys.fal` | fal.ai API key for seed image generation |
| `features.prompt_sanitizer` | Enable AI-powered prompt sanitization |
| `features.seed_generation` | Generate seed images for prompts |

## Development

```bash
# Start development server
npm run dev

# Start Tauri development
npm run tauri dev

# Build frontend only
npm run build

# Build full application
npm run tauri build
```

## Releases

To trigger a new release build:

```bash
# Create and push a version tag
git tag v0.1.0
git push origin v0.1.0
```

This will automatically build the Windows installer and publish it to GitHub Releases. You can also trigger a build manually from the Actions tab using "Run workflow".

## Project Structure

```
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── context/            # React context providers
│   ├── css/                # Stylesheets
│   ├── hooks/              # Custom React hooks
│   └── utils/              # Utility functions
├── src-tauri/              # Tauri/Rust backend
│   └── src/
│       ├── lib.rs          # Tauri commands
│       └── main.rs         # Entry point
└── public/                 # Static assets
```

