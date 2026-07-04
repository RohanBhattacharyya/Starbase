
const fs = require('fs');
const path = require('path');

const apiKey = process.env.STARBASE_STEAM_API_KEY;
const buildDir = path.join(__dirname, 'build');
const configPath = path.join(buildDir, 'config.json');

if (!apiKey) {
    console.warn('WARN: STARBASE_STEAM_API_KEY environment variable not set. The compiled application will require users to enter their own key.');
    if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
        console.warn('WARN: Removed existing build/config.json because no API key was provided.');
    }
    process.exit(0); // Exit gracefully
}

if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir);
}

const encodedKey = Buffer.from(apiKey).toString('base64');
if (process.env.GITHUB_ACTIONS) {
    console.log(`::add-mask::${apiKey}`);
    console.log(`::add-mask::${encodedKey}`);
}

const config = {
    apiKey: encodedKey
};

fs.writeFileSync(configPath, JSON.stringify(config));
console.log('API key has been encoded and stored for the build.');
