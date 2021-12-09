import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';

export class MainAPI
{
    todoItems: string[] = [];

    // Safe API: Retrieve current todo list
    public async getTodoList(): Promise<string[]>
    {
        return this.todoItems;
    }

    // Safe API: Update current todo list
    public setTodoList(items: string[]): void
    {
        this.todoItems = items;
    }

    // Safe API: Flush todo list items to disk
    public saveToDisk(): void
    {
        fs.writeFileSync('./todo.json', JSON.stringify(this.todoItems),  'utf-8');
    }

    /**
     * Application start/stop API
     */
    public async startBackgroundTasks(): Promise<void>
    {
        // reload todolist from disk on startup
        if(fs.existsSync('./todo.json')) {
            this.todoItems = JSON.parse(fs.readFileSync('./todo.json', 'utf-8'));
        }
    }

    public async stopBackgroundTasks(): Promise<void>
    {
        // save current state to disk before exit
        this.saveToDisk();
    }

    public restartUI(): void
    {
        for(let bw of BrowserWindow.getAllWindows()) {
            bw.webContents.reloadIgnoringCache();
        }
    }

    // Internal IPC helper: emit an event to any renderer process
    send(channel: string, ...args: any[]): void
    {
        for(let bw of BrowserWindow.getAllWindows()) {
            bw.webContents.send(channel, ...args);
        }
    }
}

export const mainAPI: MainAPI = new MainAPI();
