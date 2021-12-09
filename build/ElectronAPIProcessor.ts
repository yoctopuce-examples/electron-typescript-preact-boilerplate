import * as tsmorph from 'ts-morph';

type StringDict = { [symbol: string]: string };
type TypeDecl = { file: string; decl: string };

/*
 * This class uses a TypeScript parser to analyze Electron main API code and
 * generate a matching safe preload code and interface API.
 */
export class ElectronAPIProcessor
{
    rootFile: string;
    rootClass: string;
    marker: string;
    interfaceName: string;
    ifClassName: string;
    definitions: StringDict;
    subinterfaces: StringDict;
    project: tsmorph.Project;
    bridgeAPI: any;

    constructor(sourceFiles: string, rootFile: string, rootClass: string, marker: string,
                interfaceName: string)
    {
        this.rootFile = rootFile;
        this.rootClass = rootClass;
        this.marker = marker;
        this.interfaceName = interfaceName;
        this.ifClassName = this.interfaceName[0].toUpperCase()+this.interfaceName.slice(1);
        this.definitions = { 'UnsubscribeFn': 'export type UnsubscribeFn = () => void;' };
        this.subinterfaces = {};
        this.project = new tsmorph.Project();
        this.project.addSourceFilesAtPaths(sourceFiles);
    }

    protected getGeneratedHeader(): string[]
    {
        return [
            '//',
            '// This file is generated automatically during the build process',
            '//',
            '// ==================>>>   DO NOT MODIFY IT MANUALLY <<<====================',
            '//',
            '// This content is created by parsing '+this.rootFile+' and looking for',
            '// method and properties marked with a comment "'+this.marker+'"',
            '//'
        ]
    }

    protected getLeadingComment(node: tsmorph.Node): string
    {
        return node.getLeadingCommentRanges().map(
            (range) => range.getText()
        ).join('\n');
    }

    protected formatComment(comment: string): string[]
    {
        if(!comment) return [];
        return comment.replace(this.marker, '').split(/\r?\n/);
    }

    protected parseType(type: tsmorph.Type): TypeDecl
    {
        let fullTypeStr = type.getText();
        let fileMatch: any = fullTypeStr.match(/import\("[^"]*\/([^"\/]+)"\)\./);
        let unscopedType: string = fullTypeStr.replace(/import\("[^"]*"\)\./, '');
        return {
            file: (fileMatch? (fileMatch as string[])[1] : ''),
            decl: unscopedType
        };
    }

    // Triggers the analysis of Electron main API
    //
    public extractContextBridgeAPI(filename: string = this.rootFile, classname: string = this.rootClass): any
    {
        let src = this.project.getSourceFileOrThrow(filename);
        let res: any = {};

        // Save exported types and interfaces
        let types = src.getTypeAliases();
        let interfaces = src.getInterfaces();
        for(let typeDef of [...types , ...interfaces]) {
            let name: string = typeDef.getName();
            if(this.definitions[name] || !typeDef.isExported()) continue;
            this.definitions[name] = typeDef.getText();
        }

        // Search for flagged properties to expose them as sub-objects
        let classDef = src.getClassOrThrow(classname);
        for(let propDef of classDef.getProperties()) {
            let comment = this.getLeadingComment(propDef);
            if(comment.indexOf(this.marker) < 0) continue;
            let propname: string = propDef.getName();
            let proptype = propDef.getType();
            if(proptype.isClassOrInterface()) {
                let typeinfo: TypeDecl = this.parseType(proptype);
                res[propname] = {
                    'type': 'object',
                    'comment': this.formatComment(comment),
                    'members': this.extractContextBridgeAPI(typeinfo.file + '.ts', typeinfo.decl)
                };
                this.subinterfaces[typeinfo.file] = res[propname].members;
            }
        }

        // Search for flagged API methods to expose them as functions
        for(let methDef of classDef.getMethods()) {
            let comment = this.getLeadingComment(methDef);
            if(comment.indexOf(this.marker) < 0) continue;
            let methname: string = methDef.getName();
            let retType = this.parseType(methDef.getReturnType()).decl;
            let callType = (retType == 'void' ? 'send' : 'invoke');
            let params = methDef.getParameters().map((paramDef) => {
                let paramName = paramDef.getName();
                let paramType = paramDef.getType();
                if(paramDef.hasInitializer() || paramDef.isOptional()) {
                    paramName += '?';
                }
                return paramName + ': ' + this.parseType(paramType).decl
            })
            res[methname] = {
                'type': callType,
                'comment': this.formatComment(comment),
                'event': callType+'-'+methname,
                'params': params,
                'retType': retType
            };
        }

        // Search for references to "mainAPI.send" method with event literals (or literal consts)
        // to expose them as subscriptions in the preload API
        if(classname == this.rootClass) {
            for(let ref of classDef.getMethodOrThrow('send').findReferencesAsNodes()) {
                let callExpr = ref.getFirstAncestorByKind(tsmorph.SyntaxKind.CallExpression);
                if(!callExpr) continue;
                let args = callExpr.getArguments();
                if(args.length >= 1 && args[0].getType().getLiteralValue && args[0].getType().getLiteralValue()) {
                    let eventName = args[0].getType().getLiteralValueOrThrow().toString();
                    let comment = this.getLeadingComment(callExpr);
                    if(!comment || comment.indexOf(this.marker) < 0) {
                        comment = '// '+this.marker+' Receive '+eventName+' notifications';
                    }
                    let service = ('-'+eventName).replace(/-(.)/g,(x,y)=>y.toUpperCase());
                    let params = args.slice(1).map((argDef, idx) => {
                        let argName = 'arg'+(idx+1);
                        if(argDef.getKind() == tsmorph.SyntaxKind.Identifier) {
                            argName = argDef.getText();
                        }
                        return argName + ': ' + this.parseType(argDef.getType()).decl
                    })
                    let context = callExpr.getSourceFile().getBaseNameWithoutExtension();
                    (this.subinterfaces[context] || res)['register'+service+'Callback'] = {
                        'type': 'subscribe',
                        'comment': this.formatComment(comment),
                        'event': eventName,
                        'params': params
                    }
                    this.definitions[service+'Callback'] =
                        'export type '+service+'Callback = ('+params.join(', ')+') => void;';
                }
            }

            // Also save the result for later use
            this.bridgeAPI = res;
        }

        return res;
    }

    // Generate Electron preload API declaration for UI code
    //
    createPreloadAPI(apiDef: any = this.bridgeAPI, indentStr: string = ''): string
    {
        let apiLines: string[] = [];

        if(apiDef == this.bridgeAPI) {
            // Start by including all required types and interfaces
            apiLines = this.getGeneratedHeader();
            for(let sym in this.definitions) {
                apiLines.push(this.definitions[sym]);
            }
            apiLines.push('');
            apiLines.push('export interface '+this.ifClassName+' {');
        }

        // Then create the API interface
        indentStr += '    ';
        for(let name in apiDef) {
            let item = apiDef[name];
            if(item.comment.length > 0) {
                apiLines.push(...item.comment.map((line:string) => { return indentStr+line }));
            }
            switch(item.type) {
                case 'object':
                    apiLines.push(indentStr+name+': {');
                    apiLines.push(this.createPreloadAPI(item.members, indentStr));
                    apiLines.push(indentStr+'},');
                    apiLines.push('');
                    break;
                case 'invoke':
                case 'send':
                    apiLines.push(indentStr+name+'('+item.params.join(', ')+'): '+item.retType+',');
                    break;
                case 'subscribe':
                    let cbType = name.slice(8); // prune "register" prefix
                    let cbName = cbType[0].toLowerCase()+cbType.slice(1);
                    apiLines.push(indentStr+name+'('+cbName+': '+cbType+'): UnsubscribeFn,');
                    break;
            }
        }
        // Remove last comma
        if(apiLines.length > 0) {
            apiLines[apiLines.length-1] = apiLines[apiLines.length-1].slice(0, -1);
        }

        if(apiDef == this.bridgeAPI) {
            apiLines.push('}');
            apiLines.push('');
            apiLines.push('export const '+this.interfaceName+' = (window as any)?.'+this.interfaceName+' as '+this.ifClassName+';');
        }

        return apiLines.join('\n');
    }

    // Generate Electron ContextBridge code for UI preloader
    //
    createPreloadTs(apiDef: any = this.bridgeAPI, indentStr: string = ''): string
    {
        let apiLines: string[] = [];

        if(apiDef == this.bridgeAPI) {
            let imports: string = this.ifClassName;
            for(let sym in this.definitions) {
                imports += ', '+sym;
            }
            apiLines = this.getGeneratedHeader();
            apiLines.push('import { contextBridge, ipcRenderer, IpcRendererEvent } from \'electron\';');
            apiLines.push('import { '+imports+' } from \'./'+this.interfaceName+'.js\';');
            apiLines.push('');
            apiLines.push('const '+this.interfaceName+': '+this.ifClassName+' = {');
        }

        // Then create the API interface
        indentStr += '    ';
        for(let name in apiDef) {
            let item = apiDef[name];
            if(item.comment.length > 0) {
                apiLines.push(...item.comment.map((line:string) => { return indentStr+line }));
            }
            switch(item.type) {
                case 'object':
                    apiLines.push(indentStr+name+': {');
                    apiLines.push(this.createPreloadTs(item.members, indentStr));
                    apiLines.push(indentStr+'},');
                    apiLines.push('');
                    break;
                case 'invoke':
                case 'send':
                    let fparams = item.params.join(', ');
                    let fargs = item.params.map((param:string) => param.replace(/[?]?:.*/,''));
                    let evArgs = [ '\''+item.event+'\'', ...fargs ]
                    let retsym = (item.type == 'invoke' ? 'return ' : '');
                    apiLines.push(indentStr+name+': (('+fparams+'): '+item.retType+' => {');
                    apiLines.push(indentStr+'    '+retsym+'ipcRenderer.'+item.type+'('+evArgs+');');
                    apiLines.push(indentStr+'}),');
                    break;
                case 'subscribe':
                    let cbType = name.slice(8); // prune "register" prefix
                    let cbName = cbType[0].toLowerCase()+cbType.slice(1);
                    let evParams = [ 'event: IpcRendererEvent', ...item.params ].join(', ');
                    let cbArgs = item.params.map((param:string) => param.replace(/:.*/,'')).join(', ');
                    apiLines.push(indentStr+name+': (('+cbName+': '+cbType+'): UnsubscribeFn => {');
                    apiLines.push(indentStr+'    let subscription = ('+evParams+') => { '+cbName+'('+cbArgs+'); };');
                    apiLines.push(indentStr+'    let unsubscribe = () => { ipcRenderer.removeListener(\''+item.event+'\', subscription); };');
                    apiLines.push(indentStr+'    ipcRenderer.on(\''+item.event+'\', subscription);');
                    apiLines.push(indentStr+'    return unsubscribe;');
                    apiLines.push(indentStr+'}),');
                    break;
            }
        }
        // Remove last comma
        if(apiLines.length > 0) {
            apiLines[apiLines.length-1] = apiLines[apiLines.length-1].slice(0, -1);
        }

        if(apiDef == this.bridgeAPI) {
            apiLines.push('};');
            apiLines.push('');
            apiLines.push('contextBridge.exposeInMainWorld(\''+this.interfaceName+'\', '+this.interfaceName+');');
        }

        return apiLines.join('\n');
    }

    // Generate Electron Main API interface declaration (helper for createMainHandlers)
    //
    createMainAPIinterface(apiDef: any = this.bridgeAPI, indentStr: string = ''): string
    {
        let apiLines: string[] = [];

        if(apiDef == this.bridgeAPI) {
            for(let sym in this.definitions) {
                apiLines.push(this.definitions[sym].replace(/^export /,''));
            }
            apiLines.push('interface MainAPIInterface {');
        }
        indentStr += '    ';
        for(let name in apiDef) {
            let item = apiDef[name];
            switch(item.type) {
                case 'object':
                    apiLines.push(indentStr+name+': {');
                    apiLines.push(this.createMainAPIinterface(item.members, indentStr));
                    apiLines.push(indentStr+'},');
                    break;
                case 'invoke':
                case 'send':
                    apiLines.push(indentStr+name+'('+item.params.join(', ')+'): '+item.retType+',');
                    break;
            }
        }
        // Remove last comma
        if(apiLines.length > 0) {
            apiLines[apiLines.length-1] = apiLines[apiLines.length-1].slice(0, -1);
        }
        if(apiDef == this.bridgeAPI) {
            apiLines.push('}');
        }
        return apiLines.join('\n');
    }

    // Generate Ipc endpoint for Main process
    //
    createMainHandlers(apiDef: any = this.bridgeAPI, scope: string = 'this'): string
    {
        let apiLines: string[] = [];

        if(apiDef == this.bridgeAPI) {
            let rootJs: string = this.rootFile.replace(/\.ts$/,'.js');
            apiLines = this.getGeneratedHeader();
            apiLines.push('import { ipcMain } from \'electron\';');
            apiLines.push('import { '+this.rootClass+' } from \'./'+rootJs+'\';');
            apiLines.push('');
            for(let sym in this.definitions) {
                apiLines.push(this.definitions[sym].replace(/^export /,''));
            }
            apiLines.push('');
            apiLines.push('// Note: the use of "this" below is not a parameter but a type annotation!');
            apiLines.push('function registerIpcHandlers(this: MainAPI): void');
            apiLines.push('{');
        }

        // Then create the API interface
        let indentStr = '    ';
        for(let name in apiDef) {
            let item = apiDef[name];
            let scopedName = scope+'.'+name;
            if(item.comment.length > 0) {
                apiLines.push(...item.comment.map((line:string) => { return indentStr+line }));
            }
            switch(item.type) {
                case 'object':
                    apiLines.push(this.createMainHandlers(item.members, scopedName));
                    break;
                case 'invoke':
                case 'send':
                    let params = [ 'event: any', ...item.params].join(', ');
                    let fargs = item.params.map((param:string) => param.replace(/[?]?:.*/,''));
                    let method = (item.type == 'invoke' ? 'handle' : 'on');
                    let retsym = (item.type == 'invoke' ? 'return ' : '');
                    apiLines.push(indentStr+'ipcMain.'+method+'(\''+item.event+'\', ('+params+'): '+item.retType+' => {');
                    apiLines.push(indentStr+'    '+retsym+scopedName+'('+fargs+');');
                    apiLines.push(indentStr+'});');
                    break;
            }
        }

        if(apiDef == this.bridgeAPI) {
            apiLines.push('}');
            apiLines.push('');
            apiLines.push('export function registerIpcMainHandlers(api: '+this.rootClass+'): void');
            apiLines.push('{');
            apiLines.push('    (registerIpcHandlers.bind(api))();');
            apiLines.push('}');
        }

        return apiLines.join('\n');
    }
}
