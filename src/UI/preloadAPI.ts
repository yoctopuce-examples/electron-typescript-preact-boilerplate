//
// This file is generated automatically during the build process
//
// ==================>>>   DO NOT MODIFY IT MANUALLY <<<====================
//
// This content is created by parsing mainAPI.ts and looking for
// method and properties marked with a comment "Safe API:"
//
export type UnsubscribeFn = () => void;

export interface PreloadAPI {
    //  Retrieve current todo list
    getTodoList(): Promise<string[]>,
    //  Update current todo list
    setTodoList(items: string[]): void,
    //  Flush todo list items to disk
    saveToDisk(): void
}

export const preloadAPI = (window as any)?.preloadAPI as PreloadAPI;