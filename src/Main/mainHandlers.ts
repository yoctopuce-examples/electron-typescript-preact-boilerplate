//
// This file is generated automatically during the build process
//
// ==================>>>   DO NOT MODIFY IT MANUALLY <<<====================
//
// This content is created by parsing mainAPI.ts and looking for
// method and properties marked with a comment "Safe API:"
//
import { ipcMain } from 'electron';
import { MainAPI } from './mainAPI.js';

type UnsubscribeFn = () => void;

// Note: the use of "this" below is not a parameter but a type annotation!
function registerIpcHandlers(this: MainAPI): void
{
    //  Retrieve current todo list
    ipcMain.handle('invoke-getTodoList', (event: any): Promise<string[]> => {
        return this.getTodoList();
    });
    //  Update current todo list
    ipcMain.on('send-setTodoList', (event: any, items: string[]): void => {
        this.setTodoList(items);
    });
    //  Flush todo list items to disk
    ipcMain.on('send-saveToDisk', (event: any): void => {
        this.saveToDisk();
    });
}

export function registerIpcMainHandlers(api: MainAPI): void
{
    (registerIpcHandlers.bind(api))();
}