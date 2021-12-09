import { h, render, Component, ComponentChild, RefObject, createRef } from 'preact';
import { preloadAPI } from './preloadAPI.js';

import './App.css';

interface AppProps {
    title: string;
}

class App extends Component<AppProps, any>
{
    render(): ComponentChild
    {
        document.title = this.props.title;
        return <div>
            <h1>{this.props.title}</h1>
            <ToDoList/>
        </div>;
    }
}

interface ListState {
    todoItems: string[];
    readOnly: boolean;
}

class ToDoList extends Component<any, ListState>
{
    state: ListState = { todoItems: [], readOnly: true };
    inputRef: RefObject<HTMLInputElement> = createRef<HTMLInputElement>();

    // Helpers to simplify setState syntax
    set todoItems(newValue: string[]) { this.setState({ todoItems: newValue })}
    set readOnly(newValue: boolean) { this.setState({ readOnly: newValue })}

    reload = async () => {
        this.todoItems = await preloadAPI.getTodoList();
        this.readOnly = true;
    }

    edit = () => {
        this.readOnly = false;
    }

    add = () => {
        if(this.inputRef.current) {
            let newItems: string[] = this.state.todoItems;
            newItems.push(this.inputRef.current.value)
            this.todoItems = newItems;
        }
    }

    delete = (item:string) => {
        let newItems = this.state.todoItems;
        let idx = newItems.indexOf(item);
        if(idx >= 0) newItems.splice(idx, 1);
        this.todoItems = newItems;
    }

    save = () => {
        preloadAPI.setTodoList(this.state.todoItems);
        this.readOnly = true;
    }

    async componentDidMount()
    {
        await this.reload();
    }

    render(): ComponentChild
    {
        return <div class={"ToDoList"}>
            { (this.state.readOnly ? [
                    <ul>
                        { this.state.todoItems.map((item: string) => <li>{item}</li>) }
                    </ul>,
                    <button type={"button"} onClick={this.edit}>Edit</button>
                ] : [
                    <ul>
                        { this.state.todoItems.map((item: string) => <li>
                            {item} <button type={"button"} onClick={()=>this.delete(item)}>delete</button>
                        </li>) }
                    </ul>,
                    <div>New item: <input ref={this.inputRef}/><button type={"button"} onClick={this.add}>Add</button></div>,
                    <button type={"button"} onClick={this.save}>Save</button>,
                    <button type={"button"} onClick={this.reload}>Cancel</button>
                ]) }
        </div>;
    }
}

render(<App title="Simple to-do list" />, document.body);
