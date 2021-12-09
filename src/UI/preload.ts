//
// This file is generated automatically during the build process
//
// ==================>>>   DO NOT MODIFY IT MANUALLY <<<====================
//
// This content is created by parsing mainAPI.ts and looking for
// method and properties marked with a comment "Safe API:"
//
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { PreloadAPI, UnsubscribeFn } from './preloadAPI.js';

const preloadAPI: PreloadAPI = {
    //  Retrieve current todo list
    getTodoList: ((): Promise<string[]> => {
        return ipcRenderer.invoke('invoke-getTodoList');
    }),
    //  Update current todo list
    setTodoList: ((items: string[]): void => {
        ipcRenderer.send('send-setTodoList',items);
    }),
    //  Flush todo list items to disk
    saveToDisk: ((): void => {
        ipcRenderer.send('send-saveToDisk');
    })
};

contextBridge.exposeInMainWorld('preloadAPI', preloadAPI);