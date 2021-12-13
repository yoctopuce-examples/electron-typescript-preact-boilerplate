var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __markAsModule = (target) => __defProp(target, "__esModule", { value: true });
var __export = (target, all) => {
  __markAsModule(target);
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __reExport = (target, module2, desc) => {
  if (module2 && typeof module2 === "object" || typeof module2 === "function") {
    for (let key of __getOwnPropNames(module2))
      if (!__hasOwnProp.call(target, key) && key !== "default")
        __defProp(target, key, { get: () => module2[key], enumerable: !(desc = __getOwnPropDesc(module2, key)) || desc.enumerable });
  }
  return target;
};
var __toModule = (module2) => {
  return __reExport(__markAsModule(__defProp(module2 != null ? __create(__getProtoOf(module2)) : {}, "default", module2 && module2.__esModule && "default" in module2 ? { get: () => module2.default, enumerable: true } : { value: module2, enumerable: true })), module2);
};

// build/scripts.ts
__export(exports, {
  mirrorSafeAPI: () => mirrorSafeAPI,
  watchAll: () => watchAll,
  watchSafeAPI: () => watchSafeAPI
});
var fs2 = __toModule(require("fs"));
var path2 = __toModule(require("path"));
var child_process = __toModule(require("child_process"));

// build/ElectronAPIProcessor.ts
var tsmorph = __toModule(require("ts-morph"));
var ElectronAPIProcessor = class {
  constructor(sourceFiles, rootFile, rootClass, marker, interfaceName) {
    this.rootFile = rootFile;
    this.rootClass = rootClass;
    this.marker = marker;
    this.interfaceName = interfaceName;
    this.ifClassName = this.interfaceName[0].toUpperCase() + this.interfaceName.slice(1);
    this.definitions = { "UnsubscribeFn": "export type UnsubscribeFn = () => void;" };
    this.subinterfaces = {};
    this.project = new tsmorph.Project();
    this.project.addSourceFilesAtPaths(sourceFiles);
  }
  getGeneratedHeader() {
    return [
      "//",
      "// This file is generated automatically during the build process",
      "//",
      "// ==================>>>   DO NOT MODIFY IT MANUALLY <<<====================",
      "//",
      "// This content is created by parsing " + this.rootFile + " and looking for",
      '// method and properties marked with a comment "' + this.marker + '"',
      "//"
    ];
  }
  getLeadingComment(node) {
    return node.getLeadingCommentRanges().map((range) => range.getText()).join("\n");
  }
  formatComment(comment) {
    if (!comment)
      return [];
    return comment.replace(this.marker, "").split(/\r?\n/);
  }
  parseType(type) {
    let fullTypeStr = type.getText();
    let fileMatch = fullTypeStr.match(/import\("[^"]*\/([^"\/]+)"\)\./);
    let unscopedType = fullTypeStr.replace(/import\("[^"]*"\)\./, "");
    return {
      file: fileMatch ? fileMatch[1] : "",
      decl: unscopedType
    };
  }
  extractContextBridgeAPI(filename = this.rootFile, classname = this.rootClass) {
    let src = this.project.getSourceFileOrThrow(filename);
    let res = {};
    let types = src.getTypeAliases();
    let interfaces = src.getInterfaces();
    for (let typeDef of [...types, ...interfaces]) {
      let name = typeDef.getName();
      if (this.definitions[name] || !typeDef.isExported())
        continue;
      this.definitions[name] = typeDef.getText();
    }
    let classDef = src.getClassOrThrow(classname);
    for (let propDef of classDef.getProperties()) {
      let comment = this.getLeadingComment(propDef);
      if (comment.indexOf(this.marker) < 0)
        continue;
      let propname = propDef.getName();
      let proptype = propDef.getType();
      if (proptype.isClassOrInterface()) {
        let typeinfo = this.parseType(proptype);
        res[propname] = {
          "type": "object",
          "comment": this.formatComment(comment),
          "members": this.extractContextBridgeAPI(typeinfo.file + ".ts", typeinfo.decl)
        };
        this.subinterfaces[typeinfo.file] = res[propname].members;
      }
    }
    for (let methDef of classDef.getMethods()) {
      let comment = this.getLeadingComment(methDef);
      if (comment.indexOf(this.marker) < 0)
        continue;
      let methname = methDef.getName();
      let retType = this.parseType(methDef.getReturnType()).decl;
      let callType = retType == "void" ? "send" : "invoke";
      let params = methDef.getParameters().map((paramDef) => {
        let paramName = paramDef.getName();
        let paramType = paramDef.getType();
        if (paramDef.hasInitializer() || paramDef.isOptional()) {
          paramName += "?";
        }
        return paramName + ": " + this.parseType(paramType).decl;
      });
      res[methname] = {
        "type": callType,
        "comment": this.formatComment(comment),
        "event": callType + "-" + methname,
        "params": params,
        "retType": retType
      };
    }
    if (classname == this.rootClass) {
      for (let ref of classDef.getMethodOrThrow("send").findReferencesAsNodes()) {
        let callExpr = ref.getFirstAncestorByKind(tsmorph.SyntaxKind.CallExpression);
        if (!callExpr)
          continue;
        let args2 = callExpr.getArguments();
        if (args2.length >= 1 && args2[0].getType().getLiteralValue && args2[0].getType().getLiteralValue()) {
          let eventName = args2[0].getType().getLiteralValueOrThrow().toString();
          let comment = this.getLeadingComment(callExpr);
          if (!comment || comment.indexOf(this.marker) < 0) {
            comment = "// " + this.marker + " Receive " + eventName + " notifications";
          }
          let service = ("-" + eventName).replace(/-(.)/g, (x, y) => y.toUpperCase());
          let params = args2.slice(1).map((argDef, idx) => {
            let argName = "arg" + (idx + 1);
            if (argDef.getKind() == tsmorph.SyntaxKind.Identifier) {
              argName = argDef.getText();
            }
            return argName + ": " + this.parseType(argDef.getType()).decl;
          });
          let context = callExpr.getSourceFile().getBaseNameWithoutExtension();
          (this.subinterfaces[context] || res)["register" + service + "Callback"] = {
            "type": "subscribe",
            "comment": this.formatComment(comment),
            "event": eventName,
            "params": params
          };
          this.definitions[service + "Callback"] = "export type " + service + "Callback = (" + params.join(", ") + ") => void;";
        }
      }
      this.bridgeAPI = res;
    }
    return res;
  }
  createPreloadAPI(apiDef = this.bridgeAPI, indentStr = "") {
    let apiLines = [];
    if (apiDef == this.bridgeAPI) {
      apiLines = this.getGeneratedHeader();
      for (let sym in this.definitions) {
        apiLines.push(this.definitions[sym]);
      }
      apiLines.push("");
      apiLines.push("export interface " + this.ifClassName + " {");
    }
    indentStr += "    ";
    for (let name in apiDef) {
      let item = apiDef[name];
      if (item.comment.length > 0) {
        apiLines.push(...item.comment.map((line) => {
          return indentStr + line;
        }));
      }
      switch (item.type) {
        case "object":
          apiLines.push(indentStr + name + ": {");
          apiLines.push(this.createPreloadAPI(item.members, indentStr));
          apiLines.push(indentStr + "},");
          apiLines.push("");
          break;
        case "invoke":
        case "send":
          apiLines.push(indentStr + name + "(" + item.params.join(", ") + "): " + item.retType + ",");
          break;
        case "subscribe":
          let cbType = name.slice(8);
          let cbName = cbType[0].toLowerCase() + cbType.slice(1);
          apiLines.push(indentStr + name + "(" + cbName + ": " + cbType + "): UnsubscribeFn,");
          break;
      }
    }
    if (apiLines.length > 0) {
      apiLines[apiLines.length - 1] = apiLines[apiLines.length - 1].slice(0, -1);
    }
    if (apiDef == this.bridgeAPI) {
      apiLines.push("}");
      apiLines.push("");
      apiLines.push("export const " + this.interfaceName + " = (window as any)?." + this.interfaceName + " as " + this.ifClassName + ";");
    }
    return apiLines.join("\n");
  }
  createPreloadTs(apiDef = this.bridgeAPI, indentStr = "") {
    let apiLines = [];
    if (apiDef == this.bridgeAPI) {
      let imports = this.ifClassName;
      for (let sym in this.definitions) {
        imports += ", " + sym;
      }
      apiLines = this.getGeneratedHeader();
      apiLines.push("import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';");
      apiLines.push("import { " + imports + " } from './" + this.interfaceName + ".js';");
      apiLines.push("");
      apiLines.push("const " + this.interfaceName + ": " + this.ifClassName + " = {");
    }
    indentStr += "    ";
    for (let name in apiDef) {
      let item = apiDef[name];
      if (item.comment.length > 0) {
        apiLines.push(...item.comment.map((line) => {
          return indentStr + line;
        }));
      }
      switch (item.type) {
        case "object":
          apiLines.push(indentStr + name + ": {");
          apiLines.push(this.createPreloadTs(item.members, indentStr));
          apiLines.push(indentStr + "},");
          apiLines.push("");
          break;
        case "invoke":
        case "send":
          let fparams = item.params.join(", ");
          let fargs = item.params.map((param) => param.replace(/[?]?:.*/, ""));
          let evArgs = ["'" + item.event + "'", ...fargs];
          let retsym = item.type == "invoke" ? "return " : "";
          apiLines.push(indentStr + name + ": ((" + fparams + "): " + item.retType + " => {");
          apiLines.push(indentStr + "    " + retsym + "ipcRenderer." + item.type + "(" + evArgs + ");");
          apiLines.push(indentStr + "}),");
          break;
        case "subscribe":
          let cbType = name.slice(8);
          let cbName = cbType[0].toLowerCase() + cbType.slice(1);
          let evParams = ["event: IpcRendererEvent", ...item.params].join(", ");
          let cbArgs = item.params.map((param) => param.replace(/:.*/, "")).join(", ");
          apiLines.push(indentStr + name + ": ((" + cbName + ": " + cbType + "): UnsubscribeFn => {");
          apiLines.push(indentStr + "    let subscription = (" + evParams + ") => { " + cbName + "(" + cbArgs + "); };");
          apiLines.push(indentStr + "    let unsubscribe = () => { ipcRenderer.removeListener('" + item.event + "', subscription); };");
          apiLines.push(indentStr + "    ipcRenderer.on('" + item.event + "', subscription);");
          apiLines.push(indentStr + "    return unsubscribe;");
          apiLines.push(indentStr + "}),");
          break;
      }
    }
    if (apiLines.length > 0) {
      apiLines[apiLines.length - 1] = apiLines[apiLines.length - 1].slice(0, -1);
    }
    if (apiDef == this.bridgeAPI) {
      apiLines.push("};");
      apiLines.push("");
      apiLines.push("contextBridge.exposeInMainWorld('" + this.interfaceName + "', " + this.interfaceName + ");");
    }
    return apiLines.join("\n");
  }
  createMainAPIinterface(apiDef = this.bridgeAPI, indentStr = "") {
    let apiLines = [];
    if (apiDef == this.bridgeAPI) {
      for (let sym in this.definitions) {
        apiLines.push(this.definitions[sym].replace(/^export /, ""));
      }
      apiLines.push("interface MainAPIInterface {");
    }
    indentStr += "    ";
    for (let name in apiDef) {
      let item = apiDef[name];
      switch (item.type) {
        case "object":
          apiLines.push(indentStr + name + ": {");
          apiLines.push(this.createMainAPIinterface(item.members, indentStr));
          apiLines.push(indentStr + "},");
          break;
        case "invoke":
        case "send":
          apiLines.push(indentStr + name + "(" + item.params.join(", ") + "): " + item.retType + ",");
          break;
      }
    }
    if (apiLines.length > 0) {
      apiLines[apiLines.length - 1] = apiLines[apiLines.length - 1].slice(0, -1);
    }
    if (apiDef == this.bridgeAPI) {
      apiLines.push("}");
    }
    return apiLines.join("\n");
  }
  createMainHandlers(apiDef = this.bridgeAPI, scope = "this") {
    let apiLines = [];
    if (apiDef == this.bridgeAPI) {
      let rootJs = this.rootFile.replace(/\.ts$/, ".js");
      apiLines = this.getGeneratedHeader();
      apiLines.push("import { ipcMain } from 'electron';");
      apiLines.push("import { " + this.rootClass + " } from './" + rootJs + "';");
      apiLines.push("");
      for (let sym in this.definitions) {
        apiLines.push(this.definitions[sym].replace(/^export /, ""));
      }
      apiLines.push("");
      apiLines.push('// Note: the use of "this" below is not a parameter but a type annotation!');
      apiLines.push("function registerIpcHandlers(this: MainAPI): void");
      apiLines.push("{");
    }
    let indentStr = "    ";
    for (let name in apiDef) {
      let item = apiDef[name];
      let scopedName = scope + "." + name;
      if (item.comment.length > 0) {
        apiLines.push(...item.comment.map((line) => {
          return indentStr + line;
        }));
      }
      switch (item.type) {
        case "object":
          apiLines.push(this.createMainHandlers(item.members, scopedName));
          break;
        case "invoke":
        case "send":
          let params = ["event: any", ...item.params].join(", ");
          let fargs = item.params.map((param) => param.replace(/[?]?:.*/, ""));
          let method = item.type == "invoke" ? "handle" : "on";
          let retsym = item.type == "invoke" ? "return " : "";
          apiLines.push(indentStr + "ipcMain." + method + "('" + item.event + "', (" + params + "): " + item.retType + " => {");
          apiLines.push(indentStr + "    " + retsym + scopedName + "(" + fargs + ");");
          apiLines.push(indentStr + "});");
          break;
      }
    }
    if (apiDef == this.bridgeAPI) {
      apiLines.push("}");
      apiLines.push("");
      apiLines.push("export function registerIpcMainHandlers(api: " + this.rootClass + "): void");
      apiLines.push("{");
      apiLines.push("    (registerIpcHandlers.bind(api))();");
      apiLines.push("}");
    }
    return apiLines.join("\n");
  }
};

// build/bundles.ts
var esbuild = __toModule(require("esbuild"));
var fs = __toModule(require("fs"));
var path = __toModule(require("path"));

// build/MiniAsarWriter.ts
var MiniAsarWriter = class {
  constructor() {
    this.index = { files: {} };
    this.data = "";
  }
  addFile(filename, content) {
    this.index.files[filename] = {
      offset: this.data.length.toString(),
      size: content.length,
      executable: false
    };
    this.data += content;
  }
  makeArchive() {
    let indexStr = JSON.stringify(this.index);
    let indexLen = indexStr.length;
    let header = Buffer.alloc(16);
    [4, indexLen + 8, indexLen + 4, indexLen].map((value, idx) => {
      header.writeInt32LE(value, 4 * idx);
    });
    return header.toString("binary") + indexStr + this.data;
  }
};

// build/bundles.ts
async function buildMain(devmode) {
  let main = devmode ? "./src/dev-main.ts" : "./src/prod-main.ts";
  let result = await esbuild.build({
    bundle: true,
    entryPoints: [main],
    define: {
      "process.env.NODE_ENV": devmode ? '"development"' : '"production"'
    },
    minify: !devmode,
    external: ["electron", "esbuild"],
    platform: "node",
    target: "es2018",
    sourcemap: devmode,
    outfile: "index.js",
    write: false
  });
  if (result.outputFiles) {
    let devPkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    let runPkg = {};
    for (let key in devPkg) {
      if (["name", "version", "description", "author", "license"].includes(key)) {
        runPkg[key] = devPkg[key];
      }
    }
    runPkg["main"] = "index.js";
    runPkg["scripts"] = { "start": "npx electron ." };
    let pkgJson = JSON.stringify(runPkg);
    result.outputFiles.push({ path: "package.json", contents: Buffer.from(pkgJson), text: pkgJson });
  }
  return result;
}
async function buildPreload(devmode) {
  return await esbuild.build({
    bundle: true,
    entryPoints: ["./src/UI/preload.ts"],
    define: {
      "process.env.NODE_ENV": devmode ? '"development"' : '"production"'
    },
    minify: !devmode,
    external: ["electron"],
    platform: "node",
    target: "es2018",
    sourcemap: devmode,
    outfile: "preload.js",
    write: false
  });
}
async function buildApp(devmode) {
  let result = await esbuild.build({
    bundle: true,
    entryPoints: ["./src/UI/App.tsx"],
    define: {
      "process.env.NODE_ENV": devmode ? '"development"' : '"production"'
    },
    minify: !devmode,
    external: ["electron"],
    platform: "neutral",
    target: "es2018",
    sourcemap: devmode,
    loader: { ".png": "dataurl" },
    outfile: "ui.js",
    write: false
  });
  if (result.outputFiles) {
    let appHtml = fs.readFileSync("./src/UI/App.html", "utf8");
    result.outputFiles.push({ path: "App.html", contents: Buffer.from(appHtml), text: appHtml });
  }
  return result;
}
async function bundleToDisk(devmode, destDir) {
  let writer = (buildResult) => {
    for (let file of buildResult.outputFiles || []) {
      fs.writeFileSync(path.join(destDir, path.basename(file.path)), file.contents);
    }
  };
  let builders = [
    buildMain(devmode).then(writer),
    buildPreload(devmode).then(writer),
    buildApp(devmode).then(writer)
  ];
  return Promise.all(builders);
}
async function bundleToAsar(devmode, destFile) {
  let asarWriter = new MiniAsarWriter();
  let addFilesToAsar = (buildResult) => {
    for (let file of buildResult.outputFiles || []) {
      asarWriter.addFile(path.basename(file.path), file.text);
    }
  };
  let builders = [
    buildMain(devmode).then(addFilesToAsar),
    buildPreload(devmode).then(addFilesToAsar),
    buildApp(devmode).then(addFilesToAsar)
  ];
  await Promise.all(builders);
  fs.writeFileSync(destFile, asarWriter.makeArchive(), "binary");
}

// build/scripts.ts
async function mirrorSafeAPI() {
  let processor = new ElectronAPIProcessor("./src/Main/*.ts", "mainAPI.ts", "MainAPI", "Safe API:", "preloadAPI");
  processor.extractContextBridgeAPI();
  fs2.writeFileSync("./src/UI/preloadAPI.ts", processor.createPreloadAPI());
  fs2.writeFileSync("./src/UI/preload.ts", processor.createPreloadTs());
  fs2.writeFileSync("./src/Main/mainHandlers.ts", processor.createMainHandlers());
}
async function watchSafeAPI() {
  let building = true;
  let changed = true;
  let rebuild = async () => {
    console.log("Rebuilding electron IPC interfaces...");
    do {
      changed = false;
      await mirrorSafeAPI();
    } while (changed);
    building = false;
  };
  fs2.watch("./src/Main", async (eventType, filename) => {
    if (filename != "mainHandlers.ts") {
      changed = true;
      if (!building) {
        building = true;
        rebuild();
      }
    }
  });
}
async function buildAll(devmode) {
  const destDir = devmode ? "./debug" : "./dist/resources";
  console.log("Building Electron/TypeScript/JSX app...");
  let startTime = Date.now();
  await mirrorSafeAPI();
  if (devmode) {
    await bundleToDisk(devmode, "./debug");
  } else {
    await bundleToAsar(devmode, "./dist/resources/app.asar");
  }
  console.log("Done in " + (Date.now() - startTime) + "ms");
}
async function watchAll() {
  let subprocess = null;
  let building = true;
  let changed = true;
  let buildError = false;
  let rebuildAndStart = async () => {
    console.log("Rebuilding application, then starting Electron in dev mode");
    try {
      do {
        do {
          changed = false;
          await mirrorSafeAPI();
        } while (changed);
        await bundleToDisk(true, "./debug");
      } while (changed);
      console.log("Rebuild done");
      buildError = false;
      building = false;
      subprocess = child_process.spawn("npx.cmd", ["electron", "debug"], { stdio: "inherit" });
      subprocess.on("exit", (exitCode) => {
        if (!building && !buildError) {
          console.error("Electron terminated by user, exiting watch mode.");
          process.exit(exitCode);
        }
      });
    } catch (e) {
      buildError = true;
      building = false;
      console.log(e);
    }
  };
  rebuildAndStart();
  fs2.watch("./src/Main", (eventType, filename) => {
    if (filename != "mainHandlers.ts") {
      changed = true;
      if (!building) {
        building = true;
        rebuildAndStart();
      }
    }
  });
}
function clean(dir) {
  fs2.readdirSync(dir).forEach((entry) => {
    if (/[^.].*[.](js|map|html|css)/.test(entry)) {
      let fullpath = path2.join(dir, entry);
      let filestat = fs2.statSync(fullpath);
      if (!filestat.isDirectory()) {
        fs2.unlinkSync(fullpath);
      }
    }
  });
}
var args = process.argv.slice(2);
if (args.length == 0) {
  console.log("argument expected: build");
} else {
  switch (args[0]) {
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
      clean("./debug");
      break;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  mirrorSafeAPI,
  watchAll,
  watchSafeAPI
});
