import { app, BrowserWindow } from 'electron';
import path from 'path';

// Disable hardware acceleration to see if it fixes any potential webgl issues, although usually it's better on for canvas. 
// We'll keep it default (on) unless we run into issues.

const isDev = process.env.NODE_ENV !== 'development';

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Ensure we have access to features
      contextIsolation: true,
      nodeIntegration: false,
    },
    // We want a dark theme natively
    backgroundColor: '#121212',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#121212',
      symbolColor: '#ffffff',
    }
  });

  // Depending on env, load vite dev server or static file
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // Open devtools in development
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
