

import * as vscode from "vscode"
import { Component } from "./Ecs";

//状态栏组件
export class ComStatusBar implements Component
{
    mid : number = 0;
    mname: string = "ComStatusBar";
    mtype: number = 0;

    //单例实现
    static instance : ComStatusBar;
    static getSingleton():ComStatusBar
    {
        if (ComStatusBar.instance == null) {
            ComStatusBar.instance = new ComStatusBar();
        }
        return ComStatusBar.instance;
    }

    barItem:vscode.StatusBarItem;
    private constructor(){
        this.barItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)
    }

}