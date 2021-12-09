import { app, BrowserWindow } from 'electron';
import * as path from 'path';

import { mainAPI } from './mainAPI.js';
import { registerIpcMainHandlers } from './mainHandlers.js';

const WINDOW_WIDTH: number = 1024;
const WINDOW_HEIGHT: number = 768;

/*
 * Main entry point
 * - Starts background tasks
 * - Usually creates the main application window
 */
export async function startApplication(): Promise<void>
{
    // Install Main API IPC handlers
    registerIpcMainHandlers(mainAPI);

    // Create the UI browser window.
    let mainWindow: BrowserWindow = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        webPreferences: {
            // setup bridge to communicate safely with the isolated process
            preload: path.join(__dirname, 'preload.js')
        }
    });
    mainWindow.loadFile(path.join(__dirname, 'App.html'));

    // start backround monitoring tasks
    await mainAPI.startBackgroundTasks();

    // exit application when the last window is closed
    app.on('window-all-closed', async () => {
        await mainAPI.stopBackgroundTasks();
        app.quit();
    })
}

