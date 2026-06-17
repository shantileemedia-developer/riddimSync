import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log("Cleaning previous build folders...");
  try {
    fs.rmSync(path.join(__dirname, 'dist-desktop'), { recursive: true, force: true });
  } catch (e) {}

  let success = false;
  for (let i = 0; i < 5; i++) {
    try {
      console.log(`\n--- Attempt ${i + 1} to run electron-builder ---`);
      execSync('npx electron-builder --win', { stdio: 'inherit' });
      success = true;
      break;
    } catch (err) {
      console.log(`Attempt ${i + 1} failed. Windows Defender might have locked a .tmp file.`);
      console.log('Waiting 5 seconds before retrying...');
      execSync('powershell -Command "Start-Sleep -Seconds 5"');
    }
  }

  if (!success) {
    console.error("All 5 attempts failed. Cannot compile the .exe.");
    process.exit(1);
  }

  console.log("\nBuild successful! Looking for the .exe file...");
  const distDesktop = path.join(__dirname, 'dist-desktop');
  const files = fs.readdirSync(distDesktop);
  const exeFile = files.find(f => f.endsWith('.exe'));

  if (exeFile) {
    console.log(`Found executable: ${exeFile}`);
    const dest = path.join(__dirname, 'public', 'StudioDESK-Installer.exe');
    fs.copyFileSync(path.join(distDesktop, exeFile), dest);
    console.log(`Copied to ${dest}`);
  } else {
    console.error("Could not find the generated .exe file!");
    process.exit(1);
  }
}

run();
