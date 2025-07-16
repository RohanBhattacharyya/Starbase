# Starbase Launcher

## Purpose

Starbase Launcher is a desktop application designed to manage multiple instances of OpenStarbound, a community-driven open-source re-implementation of the Starbound game engine. It allows users to:

*   Create and manage different OpenStarbound instances.
*   Select and switch between various OpenStarbound versions for each instance.
*   Enable and disable mods for each instance.
*   Browse and download mods directly from the Steam Workshop.
*   Launch OpenStarbound instances with their configured mods.

> [!NOTE]
> This was made using Gemini CLI!

> [!WARNING]  
> This has only been tested on Arch Linux!

## How to Build and Install

This application is built using Electron. To build and install it, follow these steps:

### Prerequisites

*   Node.js (LTS version recommended)
*   npm (Node Package Manager)
*   Git

### 1. Clone the Repository

```bash
git clone <repository_url>
cd Starbase
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Application

To build the application, you can use `electron-builder`. A `prebuild.js` script is used to handle the embedding of the Steam Web API Key, ensuring it's included in the compiled application without being exposed in plain text.

#### Building with an Embedded Steam Web API Key (Recommended)

To embed your Steam Web API Key, set the `STARBASE_STEAM_API_KEY` environment variable before running the build command. The `prebuild.js` script will automatically detect this variable, encode the key, and embed it into the application. This means the end-user will not need to manually enter an API key.

```bash
STARBASE_STEAM_API_KEY="YOUR_STEAM_WEB_API_KEY" npm run dist
```

Replace `"YOUR_STEAM_WEB_API_KEY"` with your actual Steam Web API Key. You can obtain a key from [https://steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey).

#### Building Without an Embedded Steam Web API Key

If you do not wish to embed a key, simply run the build command without setting the `STARBASE_STEAM_API_KEY` environment variable. Users will be prompted to enter their own Steam Web API Key the first time they attempt to browse the Steam Workshop.

```bash
npm run dist
```

### 4. Installation

After the build process completes, you will find the installer or executable files in the `dist/` directory, specific to your operating system. Run the appropriate installer or executable to install the application.

*   **Windows:** `Starbase Setup X.Y.Z.exe`
*   **macOS:** `Starbase-X.Y.Z.dmg`
*   **Linux:** `starbase-X.Y.Z.AppImage` or `starbase-X.Y.Z.deb` (depending on your build configuration)

## Usage

Once installed, launch the Starbase Launcher. The first time you run it, you will be prompted to select your Starbound `packed.pak` file. After this, you can start managing your OpenStarbound instances and mods.