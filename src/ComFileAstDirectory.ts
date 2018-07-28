import * as vscode from "vscode"
import { DocAstInfo } from './ComAst'
/**
 *  Uri path <-> 文档Ast信息目录
 */
export class ComFileAstDirectory 
{
    static instance:ComFileAstDirectory;
    static getSingleton(){
        if (ComFileAstDirectory.instance == null) {
            ComFileAstDirectory.instance = new ComFileAstDirectory;
        }

        return ComFileAstDirectory.instance;
    }
 
    /**
     * 设置DocAstInfo
     * @param _strUri 
     * @param _docAstInfo 
     */
    setDocAstInfo( _strUriPath:string , _docAstInfo:DocAstInfo)
    {
        this.fileAstDirectory.set(_strUriPath,_docAstInfo);
    }

    /**
     * 移除一个
     * @param _strUriPath 
     */
    deleteOne(_strUriPath:string)
    {
        this.fileAstDirectory.delete(_strUriPath);
    }

    /**
     * 由uir获取DocAstInfo
     * @param _strUri 
     */
    getDocAstInfoWithUri(_strUriPath):DocAstInfo
    {
        return this.fileAstDirectory.get(_strUriPath);
    }

    /**
     * 由DocName获取文档Uri
     * @param _docName 
     */
    getUriWithDocName( _docName : string ):vscode.Uri
    {
        for(var key in this.fileAstDirectory) 
        {
            if(this.fileAstDirectory[key].docInfo.name == _docName)
            {
                return this.fileAstDirectory[key].docInfo.uri;
            }
        }
    }


    private constructor(){}

    //uri <-> DocAstInfo 映射表
    private fileAstDirectory:Map<string,DocAstInfo> = new Map();

}