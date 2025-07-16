
const fs = require('fs');
const path = require('path');

const apiKey = process.env.STARBASE_STEAM_API_KEY;

if (!apiKey) {
    console.warn('WARN: STARBASE_STEAM_API_KEY environment variable not set. The compiled application will require users to enter their own key.');
    process.exit(0); // Exit gracefully
}

const buildDir = path.join(__dirname, 'build');
if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir);
}

const encodedKey = Buffer.from(apiKey).toString('base64');
const config = {
    apiKey: encodedKey
};

fs.writeFileSync(path.join(buildDir, 'config.json'), JSON.stringify(config));
console.log('API key has been encoded and stored for the build.');
