
import * as vscode from "vscode"
import * as fs  from "fs"

//文档信息
export class DocInfo
{
    doc : vscode.TextDocument;
    name : string;
    fileInfo : fs.Stats;
    constructor(doc : vscode.TextDocument,name : string,fileInfo : fs.Stats)
    {
        this.doc = doc;
        this.name = name;
        this.fileInfo = fileInfo;
    }
}


//一个文本预分析后，用一个抽象的语法树表达，语法树的基本单元为一个语法项
//一个语法项的类型
export enum ELuaSyntaxItemType
{
    Invalid=0,
    Variable,
    Function,
    Value,
}

//一个语法项
export class LuaSyntaxItem
{
    type;
    valueItem;          //此项的赋值对象
    functionAstNode;
    astNode;
    parent;
    children;
    docInfo : DocInfo;
    constructor(type,astNode,parent,docInfo)
    {
        this.type = type;
        this.astNode = astNode;
        this.parent = parent;
        this.docInfo = docInfo;
        this.children = new Map<string,LuaSyntaxItem>();
    }
}




//一个Scope块的语法树
export class ScopeAstInfo
{
    scopeIndex : number;
    //scope起始行数从0计数 提供对块的快速索引
    startline :number = -1;
    endline :number = -1;
    scope : Scope ;
    parent : ScopeAstInfo;
    docAst : DocAstInfo;
    //提供对块内self的指向
    selfObjName: string;
    localItems = new Map<string,LuaSyntaxItem>();
    //如果这个区域是函数则有参数
    paramsItems = new Map<string,LuaSyntaxItem>();
    subScopeItems = new Map<string,ScopeAstInfo>();
    
}

//缓存全局表AST信息
export class GlobalAstInfo
{ 
    static globalItems=new Map<string,LuaSyntaxItem>();
}

//文档语法树
export class DocAstInfo
{
    docInfo : DocInfo;
    scopeAstInfo : ScopeAstInfo;
    scopeAstStack : ScopeAstInfo[];
    moduleTableItem : LuaSyntaxItem|null;
    constructor(docInfo:DocInfo)
    {
        this.docInfo = docInfo;
    }
}

//作用域
export class Scope {
    startOffset ;
    endOffset ;
    nodes ;
    parentScope ;
    constructor() {
        this.nodes = [];
        this.parentScope = null;
    }
    containsScope(otherScope) {
        let currentScope = otherScope;
        while (currentScope !== null) {
            if (currentScope === this) {
                return true;
            }
            currentScope = currentScope.parentScope;
        }
        return false;
    }
}
