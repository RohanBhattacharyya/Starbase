# OpenStarbound Instance Manager

This is a cross-platform desktop application built with Electron to manage OpenStarbound instances and mods, including integration with the Steam Workshop.

## Features

*   **First-Time Setup:** On first launch, guides the user to select their `packed.pak` file, which contains the core game assets.

*   **OpenStarbound Client Downloader:** Automatically downloads and extracts the latest Linux client from the official OpenStarbound GitHub releases. It intelligently identifies the correct `.zip` and nested `.tar` files.

*   **SteamCMD Integration:**
    *   Automatically downloads and sets up `steamcmd` (Steam Console Client).
    *   Allows browsing and searching for Starbound mods directly from the Steam Workshop within the application.
    *   Downloads selected mods from the Steam Workshop.

*   **Instance Management:**
    *   Create multiple, isolated game instances.
    *   Each instance has its own `mods` folder.
    *   Efficiently uses a symbolic link to the single `packed.pak` file to avoid duplicating large game assets.

*   **Mod Management:**
    *   View a list of installed mods for each instance.
    *   Enable or disable individual mods for a specific instance.
    *   Delete mods from an instance.

*   **Game Launcher:** Launches the selected OpenStarbound instance with its specific mod configuration.

*   **Instance Deletion:** Delete an entire game instance, including its associated mod files.

## Getting Started

To run the application:

1.  **Ensure Node.js and npm are installed.** You can download them from [nodejs.org](https://nodejs.org/).
2.  **Clone this repository.**
3.  **Navigate to the project directory** in your terminal.
4.  **Install dependencies:**
    ```bash
    npm install
    ```
5.  **Start the application:**
    ```bash
    npm start
    ```

## Development

*   **`main.js`**: The main Electron process, handling window creation, IPC communications, and backend logic (file operations, downloads, `steamcmd` interactions).
*   **`preload.js`**: A script that runs before the renderer process, exposing necessary Node.js modules and IPC communication channels to the renderer in a secure way.
*   **`index.html`**: The main user interface for instance and mod management.
*   **`setup.html`**: The initial setup screen for selecting the `packed.pak` file.
*   **`workshop.html`**: The dedicated window for browsing and downloading Steam Workshop mods.
*   **`renderer.js`**: The renderer process script for `index.html`, handling UI interactions and communicating with the main process.
*   **`workshop-renderer.js`**: The renderer process script for `workshop.html`, handling UI interactions for the workshop browser.

## Project Structure

```
.github/
src/
├── main.js
├── preload.js
├── renderer.js
├── setup.html
├── workshop.html
└── workshop-renderer.js
package.json
package-lock.json
README.md
```
