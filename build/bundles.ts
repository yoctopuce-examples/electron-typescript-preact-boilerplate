import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

import { MiniAsarWriter } from './MiniAsarWriter.js'

export async function buildMain(devmode: boolean): Promise<esbuild.BuildResult>
{
    // bundle main process code
    let main: string = (devmode ? './src/dev-main.ts' : './src/prod-main.ts');
    let result: esbuild.BuildResult = await esbuild.build({
        bundle: true,
        entryPoints: [ main ],
        define: {
            'process.env.NODE_ENV': (devmode ? '"development"' : '"production"')
        },
        minify: !devmode,
        external: [ 'electron', 'esbuild' ],
        platform: 'node',
        target: 'es2018',
        sourcemap: devmode,
        outfile: 'index.js',
        write: false
    });
    if(result.outputFiles) {
        // add a runtime package.json created from project package.json
        let devPkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        let runPkg: any = {};
        for(let key in devPkg) {
            if(['name','version','description','author','license'].includes(key)) {
                runPkg[key] = (devPkg as any)[key];
            }
        }
        runPkg['main'] = 'index.js';
        runPkg['scripts'] = { 'start': 'npx electron .' };
        let pkgJson = JSON.stringify(runPkg);
        result.outputFiles.push({ path:'package.json', contents: Buffer.from(pkgJson), text: pkgJson });
    }

    return result;
}

export async function buildPreload(devmode: boolean): Promise<esbuild.BuildResult>
{
    // bundle the UI preload file
    return await esbuild.build({
        bundle: true,
        entryPoints: [ './src/UI/preload.ts' ],
        define: {
            'process.env.NODE_ENV': (devmode ? '"development"' : '"production"')
        },
        minify: !devmode,
        external: [ 'electron' ],
        platform: 'node',
        target: 'es2018',
        sourcemap: devmode,
        outfile: 'preload.js',
        write: false
    })
}

export async function buildApp(devmode: boolean): Promise<esbuild.BuildResult>
{
    // bundle the User Interface files
    let result: esbuild.BuildResult = await esbuild.build({
        bundle: true,
        entryPoints: [ './src/UI/App.tsx' ],
        define: {
            'process.env.NODE_ENV': (devmode ? '"development"' : '"production"')
        },
        minify: !devmode,
        external: [ 'electron' ],
        platform: 'neutral',
        target: 'es2018',
        sourcemap: devmode,
        loader: { '.png': 'dataurl' },
        outfile: 'ui.js',
        write: false
    })
    if(result.outputFiles) {
        // add root HTML file
        let appHtml: string = fs.readFileSync('./src/UI/App.html', 'utf8');
        result.outputFiles.push({path: 'App.html', contents: Buffer.from(appHtml), text: appHtml});
    }

    return result;
}

export async function bundleToDisk(devmode: boolean, destDir: string)
{
    let writer = (buildResult: esbuild.BuildResult) => {
        for(let file of buildResult.outputFiles || []) {
            fs.writeFileSync(path.join(destDir, path.basename(file.path)), file.contents);
        }
    }
    let builders: Promise<void>[] = [
        buildMain(devmode).then(writer),
        buildPreload(devmode).then(writer),
        buildApp(devmode).then(writer)
    ];
    return Promise.all(builders);
}

export async function bundleToAsar(devmode: boolean, destFile: string)
{
    let asarWriter = new MiniAsarWriter();
    let addFilesToAsar = (buildResult: esbuild.BuildResult) => {
        for(let file of buildResult.outputFiles || []) {
            asarWriter.addFile(path.basename(file.path), file.text);
        }
    }
    let builders: Promise<void>[] = [
        buildMain(devmode).then(addFilesToAsar),
        buildPreload(devmode).then(addFilesToAsar),
        buildApp(devmode).then(addFilesToAsar)
    ];
    await Promise.all(builders);

    fs.writeFileSync(destFile, asarWriter.makeArchive(), 'binary');
}
