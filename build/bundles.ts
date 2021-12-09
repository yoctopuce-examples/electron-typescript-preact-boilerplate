import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

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
        outfile: 'ui.js',
        write: false
    })
    // add root HTML file
    let appHtml: string = fs.readFileSync('./src/UI/App.html', 'utf8');
    result.outputFiles.push({ path:'App.html', contents: Buffer.from(appHtml), text: appHtml });

    return result;
}

export async function bundleToDisk(devmode: boolean, destDir: string)
{
    let writer = (buildResult: esbuild.BuildResult) => {
        for(let file of buildResult.outputFiles) {
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

// Helper for little-endian encoding
function leEncode(val: number)
{
    let bytes: number[] = [ val&0xff, (val>>8)&0xff, (val>>16)&0xff, (val>>24)&0xff ];
    return bytes.map((c: number) => String.fromCharCode(c)).join('');
}

// Quick'n dirty "asar" file writer: we don't need all the globbing, etc. functions
// that would come by importing the whole asar package. Even the integrity feature
// brings no security as the checksum is written in the same file... So let's make
// it deadly simple, this is what the "asar" file format was devised for !
export async function bundleToAsar(devmode: boolean, destFile: string)
{
    let index = {files:{}};
    let data = '';
    let append = (buildResult: esbuild.BuildResult) => {
        for(let file of buildResult.outputFiles) {
            index.files[path.basename(file.path)] = {
                offset: data.length.toString(),
                size: file.text.length,
                executable: false
            };
            data += file.text;
        }
    }
    let builders: Promise<void>[] = [
        buildMain(devmode).then(append),
        buildPreload(devmode).then(append),
        buildApp(devmode).then(append)
    ];
    await Promise.all(builders);
    let indexStr: string = JSON.stringify(index);
    let indexLen: number = indexStr.length;
    let header: Buffer = Buffer.alloc(16);
    [ 4, indexLen+8, indexLen+4, indexLen ].map((value, idx) => {
        header.writeInt32LE(value, 4*idx)
    });
    fs.writeFileSync(destFile, header.toString('binary')+indexStr+data, 'binary');
}
