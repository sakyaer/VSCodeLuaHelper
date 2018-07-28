import {Component} from "./Ecs"
import * as vscode from "vscode"
import * as fs from "fs"

//工作区文件信息列表
export class ComWSFileInfoList implements Component
{
    mid : number = 0;
    mname: string = "WorkspaceFileInfo";
    mtype: number = 0;

    //单例
    static instanse : ComWSFileInfoList;
    static getInstanse() : ComWSFileInfoList{
       
        if( ComWSFileInfoList.instanse == null)
        {
            ComWSFileInfoList.instanse = new ComWSFileInfoList;
        }

        return ComWSFileInfoList.instanse;
    }
    
    //所有文件uris fsStats（详细信息）
    uris: Array<vscode.Uri> = new Array<vscode.Uri>();
    fsStats: Array<fs.Stats> = new Array<fs.Stats>();
    
}