import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';

import { ElectronAPIProcessor } from './ElectronAPIProcessor.js';
import { bundleToDisk, bundleToAsar } from './bundles.js';

export async function mirrorSafeAPI(): Promise<void>
{
    let processor = new ElectronAPIProcessor('./src/Main/*.ts',
        'mainAPI.ts', 'MainAPI', 'Safe API:',
        'preloadAPI')
    processor.extractContextBridgeAPI();
    fs.writeFileSync('./src/UI/preloadAPI.ts', processor.createPreloadAPI());
    fs.writeFileSync('./src/UI/preload.ts', processor.createPreloadTs());
    fs.writeFileSync('./src/Main/mainHandlers.ts', processor.createMainHandlers());
}

export async function watchSafeAPI(): Promise<void>
{
    let building: boolean = true;
    let changed: boolean = true;
    let rebuild = async () => {
        console.log('Rebuilding electron IPC interfaces...');
        do {
            changed = false;
            await mirrorSafeAPI();
        } while(changed);
        building = false;
    }
    fs.watch('./src/Main', async (eventType: any, filename: string) => {
        if(filename != 'mainHandlers.ts') {
            changed = true;
            if(!building) {
                building = true;
                rebuild();
            }
        }
    });
}

async function buildAll(devmode: boolean)
{
    const destDir = (devmode ? './debug' : './dist/resources');
    console.log('Building Electron/TypeScript/JSX app...');
    let startTime = Date.now();
    await mirrorSafeAPI();
    if(devmode) {
        await bundleToDisk(devmode, './debug');
    } else {
        await bundleToAsar(devmode, './dist/resources/app.asar');
    }
    console.log('Done in '+(Date.now() - startTime)+'ms');
}

export async function watchAll(): Promise<void>
{
    let subprocess: child_process.ChildProcess | null = null;
    let building: boolean = true;
    let changed: boolean = true;
    let buildError: boolean = false;
    let rebuildAndStart = async () => {
        console.log('Rebuilding application, then starting Electron in dev mode');
        try {
            do {
                do {
                    changed = false;
                    await mirrorSafeAPI();
                } while (changed);
                await bundleToDisk(true, './debug');
            } while (changed);
            console.log('Rebuild done');
            buildError = false;
            building = false;
            subprocess = child_process.spawn('npx.cmd',['electron','debug'],{ stdio: 'inherit' });
            subprocess.on('exit', (exitCode: number) => {
                if(!building && !buildError) {
                    console.error('Electron terminated by user, exiting watch mode.')
                    process.exit(exitCode);
                }
            });
        } catch(e) {
            buildError = true;
            building = false;
            console.log(e);
        }
    }
    rebuildAndStart();
    fs.watch('./src/Main', (eventType: any, filename: string) => {
        if(filename != 'mainHandlers.ts') {
            changed = true;
            if(!building) {
                building = true;
                rebuildAndStart();
            }
        }
    });

}

function clean(dir: string)
{
    fs.readdirSync(dir).forEach((entry) => {
        if(/[^.].*[.](js|map|html|css)/.test(entry)) {
            let fullpath: string = path.join(dir, entry);
            let filestat: fs.Stats = fs.statSync(fullpath);
            if(!filestat.isDirectory()) {
                fs.unlinkSync(fullpath);
            }
        }
    });
}

// When started as stand-alone script, provides build capabilities
let args: string[] = process.argv.slice(2);
if(args.length == 0) {
    console.log("argument expected: build")
} else {
    switch(args[0]) {
        case "generate-api":
            mirrorSafeAPI();
            break;
        case "watch-api":
            watchSafeAPI();
            break;
        case "build-dev":
            buildAll(true);
            break;
        case "start-dev":
            watchAll();
            break;
        case "build-prod":
            buildAll(false);
            break;
        case "clean":
            clean('./debug');
            break;
    }
}
