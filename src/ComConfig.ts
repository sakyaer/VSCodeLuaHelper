
import * as vscode from 'vscode'

export class ComConfig 
{
    scriptRoots : Array<string>|null = null;
    requireFunNames:Array<string>;

    static instance : ComConfig;
    static GetSingleton() : ComConfig
    {
        if (ComConfig.instance == null) 
        {
            ComConfig.instance = new ComConfig();

        }
        return ComConfig.instance;
    }

    private constructor()
    {
        this.requireFunNames = new Array<string>();
        this.requireFunNames.push("require")
        this.requireFunNames.push("import")
    }

    GetIsluaFunArgCheck()
    {
        return this._GetBoolConfigValue("luaFunArgCheck");
    }

    //模块方法嵌套检查,如果在一个方法中出现另外一个模块方法会认为是错误的
    GetIsModuleFunNestingCheck()
    {
        return this._GetBoolConfigValue("moduleFunNestingCheck");
    }

    //检查代码中运算符号是否正确,如果重载了运算符 需要将该项设置为false
    GetIsLuaOperatorCheck():boolean|undefined
    {
        return this._GetBoolConfigValue("luaOperatorCheck");
    }

    //是否编辑文本实时语法检测
    GetIsChangeTextCheck():boolean|undefined
    {
        return this._GetBoolConfigValue("changeTextCheck");
    }

    private _GetBoolConfigValue(_configKey:string):boolean
    {
        let luaideConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("luahelper");
        let moduleFunNestingCheck:boolean|undefined = luaideConfig.get<boolean>(_configKey);
        if (moduleFunNestingCheck == undefined) {
            moduleFunNestingCheck = false;
        }
        return moduleFunNestingCheck;
    }


    GetScriptRoot():Array<string>  
    {
        if (this.scriptRoots == null ) 
        {
            this.scriptRoots = new Array<string>();
            let luaideConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("luahelper")
            let scriptRootConfig = luaideConfig.get<Array<string>>("scriptRoots");

            if(scriptRootConfig!=undefined)
            {
                
            }else
            {
                scriptRootConfig = [];
            }

            if (scriptRootConfig.length === 0) {
                scriptRootConfig.push(vscode.workspace.rootPath);
            }

            scriptRootConfig.forEach(rootpath => {
                var    scriptRoot = rootpath.replace(/\\/g, "/");
                scriptRoot =  scriptRoot.replace(new RegExp("/", "gm"), ".")
                //scriptRoot = scriptRoot.toLowerCase();//大小写敏感
                this.scriptRoots.push(scriptRoot)
  
            })

        }

        return this.scriptRoots;
    }

    
}