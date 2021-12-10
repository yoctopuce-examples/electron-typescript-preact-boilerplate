import { app, BrowserWindow } from 'electron';
import * as esbuild from 'esbuild';
import * as fs from 'fs';

import { startApplication } from './Main/main.js'
import { mainAPI } from './Main/mainAPI.js'

// Define a file watcher for TypeScript / Preact transpilation and hot reload
async function watcher()
{
    // Rebuild UI from sources, prepare for incremental rebuild
    const appBuilder: esbuild.BuildResult = await esbuild.build({
        bundle: true,
        entryPoints: [ './src/UI/App.tsx' ],
        define: { 'process.env.NODE_ENV': 'development' },
        external: [ 'electron' ],
        incremental: true,
        minify: false,
        sourcemap: true,
        platform: 'neutral',
        target: 'es2018',
        loader: { '.png': 'dataurl' },
        outfile: 'debug/ui.js',
    })

    // Soft-reload watcher for UI files
    let building: boolean = false;
    let changed: boolean = false;
    const rebuild = async (): Promise<void> => {
        console.log("watcher: Rebuild and restart UI");
        do {
            changed = false;
            if(appBuilder.rebuild) await appBuilder.rebuild();
        } while(changed);
        building = false;
        mainAPI.restartUI();
    };

    const preloadFiles: string[] = [ 'preload.ts', 'preloadAPI.ts' ];
    fs.watch('./src/UI', (eventType: any, filename: string) => {
        if(preloadFiles.indexOf(filename) >= 0) {
            // when preload file changes, we need a full restart
            app.quit();
            return;
        }
        changed = true;
        if(!building) {
            building = true;
            rebuild();
        }
    });
}

console.log('Starting electron with hot-reload watcher for the UI')
app.whenReady().then(watcher).then(startApplication);
