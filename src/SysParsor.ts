import * as fs  from "fs";
import * as path from 'path';
import * as luaparse  from "luaparse"
import * as vscode from "vscode"

import { System} from "./Ecs"
import { Utils,SysLogger } from './Utils'
import { ComWSFileInfoList } from "./ComFileInfos"
import { ComStatusBar } from "./ComStatusBar"
import { GlobalAstInfo,DocInfo,LuaSyntaxItem,ScopeAstInfo,DocAstInfo,ELuaSyntaxItemType,Scope} from "./ComAst"
import { ComFileAstDirectory } from './ComFileAstDirectory'
import { ComConfig } from "./ComConfig"
//const luaparse = require('luaparse');

export class SysParsor implements System
{
    //单例
    static instance:SysParsor;
    static GetSingleton():SysParsor
    {
        if (SysParsor.instance == null) {
            SysParsor.instance = new SysParsor();
        }

        return SysParsor.instance;
    }

    diagnosticCollection:vscode.DiagnosticCollection;
    diagnostics : vscode.Diagnostic[];
    workspaceFilInfoList : ComWSFileInfoList;
    //当前分析文档语法树
    currentDocAst:DocAstInfo;
    currentScope;
    currentScopeAst:ScopeAstInfo;
    scopeAstStack=[];   //以scope为单位的分析结果放进这里，0为DocAstInfo，其他以ScopeAstInfo为主
    scopeStack = [];
    currentDoc : DocInfo;
    lastScopeAst;
    lastScope;
    globalScope;
    currentParseLine=0;

    currentAstNode;
    lastAstNode;
    tempFuncItem;
    private isNewScope = false;
    moduleChecker:ModuleChecker;
    
    DoSth( ) : void {

        SysLogger.getSingleton().log('Parsor start...');

        //遍历工作区所有文件，并把文件路径信息存入uris中
        this.workspaceFilInfoList = ComWSFileInfoList.getInstanse();
        let uris = this.workspaceFilInfoList.uris;
        vscode.workspace.findFiles("**/*.lua", "", 10000).then(
            value => {
                if (value == null) return

                value.forEach(element => {
                    uris.push(element);
                });

                SysLogger.getSingleton().log('UrisCount:' + uris.length);
                this._parseLuaFiles(uris);

            })
    }

    //安装诊断接口
    setupDiagnosticCollection( _diagnosticCollection :vscode.DiagnosticCollection)
    {
        this.diagnosticCollection = _diagnosticCollection;
    }


    private _parseLuaFiles( _uris:Array<vscode.Uri> ,isSaveCompletion: boolean = true):void
    {

        //是否已存在Completion

        //缓存所有文件的文件信息
        _uris.forEach(element => {
            var fileInfo = fs.statSync(element.fsPath);
            this.workspaceFilInfoList.fsStats.push(fileInfo);
        
        });

        let barItem = ComStatusBar.getSingleton().barItem;

        let index = 0;

        var func = {

            self:this,
            //打开和分析一个文件，迭代
            openAndParseFile : function (_uri:vscode.Uri) {
                try{
                    index++;
                    vscode.workspace.openTextDocument(_uri).then(              
                        //成功则分析完一个文件继续分析下一个
                        doc => {    
                            try{
                                if( _uri != undefined)
                                {
    
                                    //用于断点某个指定文档
                                    if (_uri.path.search("LuaDebug")!= -1) {
                                        //Bingo
                                        console.log("Bingo");
                                    }
    
                                    SysLogger.getSingleton().log("ParseLuaFile: " + _uri);
                                    barItem.text = _uri.path;
    
                                    func.self.parseOne(_uri,doc);
                                    //分析下一个
                                    func.openAndParseFile(_uris[index]);
    
                                    if (index == _uris.length + 1 ) {
                                        SysLogger.getSingleton().log('Parse Finished!!!');
                                    }
                                }
                            }catch(excp)
                            {
                                SysLogger.getSingleton().log('parseDocument Error:' + excp);
                            }                                                  
                        },
                        //失败情况继续
                        function(reason){  
                            SysLogger.getSingleton().log('OpenLuaFileFalse[' + _uri + ']:' + reason);
                            func.openAndParseFile(_uris[index]);
                        }
    
                    )
                }catch(excp)
                {
                    SysLogger.getSingleton().log('openAndParseFile Error:' + excp);
                }
                
            }
        }

        func.openAndParseFile(_uris[index]);

        barItem.text = "Parse Finished:" + _uris.length;
        barItem.show();
        
    }


    /**
     * 从uri<->DocAst目录中移除
     * @param _uri 
     */
    removeOneDocAst(_uri: vscode.Uri)
    {
        ComFileAstDirectory.getSingleton().deleteOne(_uri.fsPath);
    }

    /**
     * 分析一个新的文档，分析结果DocAst放入uri<->DocAst目录中
     * @param _uri 
     * @param doc 
     */
    parseOne(_uri: vscode.Uri, doc:vscode.TextDocument)
    {

        //清理
        this._reset();
        //清理当前文档旧的错误信息
        this.diagnosticCollection.set(_uri,this.diagnostics );

        //初始化文档信息 ast信息
        var fileInfo = fs.statSync(_uri.fsPath);
        var fileName = Utils.GetFileNameFromUri(_uri);

        this.currentDoc = new DocInfo(doc,fileName,fileInfo);
        this.currentDocAst = new DocAstInfo(this.currentDoc);
        this.currentDocAst.scopeAstStack = this.scopeAstStack;

        //放入文档Ast映射表
        ComFileAstDirectory.getSingleton().setDocAstInfo(_uri.fsPath,this.currentDocAst);

        try{

            var ast:luaparse.ast = luaparse.parse(doc.getText(),{
                comments: true,
                locations: true,
                ranges: true,
                scope:true,
                onCreateNode:(node)=>{

                    
                    this.currentParseLine = node.loc.start.line-1;
                    var templineTex = this.currentDoc.doc.lineAt(node.loc.start.line-1);
                    SysLogger.getSingleton().log("current line:" + this.currentParseLine +  "type:"  + node.type + "Content:" + templineTex.text);

                    if(this.isNewScope)
                    {

                        //取出头部分析是否是函数 是函數設置當前ScopeAst 參數Item
                        var line = node.loc.start.line-1;

                        var posEnd = null; 
                        var posStart = null;
                        var lineTex = this.currentDoc.doc.lineAt(node.loc.start.line-1);

                        var matchRet = lineTex.text.match("function\\s*[a-zA-Z_.:]*\\(");//"function(\\s+[a-zA-Z_]\\w*(.[a-zA-Z_]\\w*)*\\s*)?\\s*\\("

                        if ( matchRet !=null) {

                            //如果方法是成员方法（:）取类名作为域self名称
                            let className = matchRet[0].replace(/(function|\s|\()/g,"");
                            let names = className.split(":");
                            if ( names ) {
                                className = names[0];
                            }
                            this.currentScopeAst.selfObjName = className;

                            //找参数
                            var startCharactor = lineTex.text.search("\\(");

                            posStart = new vscode.Position(node.loc.start.line-1,startCharactor);
                            var i=0;   
                            while(i<10)
                            {
                                //取参数 最多10次
                                lineTex = this.currentDoc.doc.lineAt(line+i);
                                var searchIndex = lineTex.text.search("\\)");
                                if(searchIndex!=-1)
                                {
                                    posEnd = new vscode.Position(line+i ,searchIndex+1);
                                    break;
                                }
    
                                i++;
                            }
    
                            if(posEnd)
                            {
                                var tempStr = this.currentDoc.doc.getText(new vscode.Range(posStart,posEnd));
                                tempStr = tempStr.replace(/(\(|\)|\t|\s|\r|\n)/g,"");
                                var params = tempStr.split(',');
                                //取参数
                                var retParam = [];
                                params.forEach(element => {
                                    if (element.length !=0 ) {
                                        retParam.push(element);
                                    }
                                    
                                });

                                //设置参数到当前ScopeAst
                                retParam.forEach(param => {
                                    this.currentScopeAst.paramsItems.set(param,
                                        new LuaSyntaxItem(ELuaSyntaxItemType.Function,node,null,this.currentDoc));
                                });

                            }
                        }
                        
                        this.isNewScope = false;
                    }

                    //解析
                    try{
                        this._onCreateNodeParse(this,node);
                    }catch(excp)
                    {
                        SysLogger.getSingleton().log("解析出错:" + excp + "|" + node.loc.start.line);
                    }

                    //缓存每次解析的node的type用于下一个node判断需要依赖前一个node类型时使用
                    this._lastParseNodeType = node.type;
                    
    
                },
                onCreateScope:()=>{
        
                    //表示进入一个新的Scope区域，主要用于提前分析函数头
                    this.isNewScope = true;

                    const newScope = new Scope();
                    if (this.globalScope == null) {
                        this.globalScope = newScope;
                    }
                    newScope.parentScope = this.scopeStack.length ? this.scopeStack[this.scopeStack.length - 1] : null;
                    this.scopeStack.push(newScope);

                    //一个新的Scope
                    var newScopeAst = new ScopeAstInfo();
                    newScopeAst.parent = this.currentScopeAst;
                    newScopeAst.scopeIndex = this.scopeAstStack.length;
                    newScopeAst.scope = newScope;
                    newScopeAst.docAst = this.currentDocAst;        
                    newScopeAst.startline = this.currentParseLine;
                    this.scopeAstStack.push(newScopeAst);
                    this.currentScopeAst = newScopeAst;

                    SysLogger.getSingleton().log("New scope Index:" + newScopeAst.scopeIndex);

                },
                onDestroyScope : ()=>{
                    this.isNewScope = false;
                    this.lastScope = this.scopeStack.pop();
                    this.lastScopeAst = this.currentScopeAst;
                    this.lastScopeAst.endline = this.currentParseLine;
                    this.currentScopeAst = this.currentScopeAst.parent;
                    
                }
            });

        }catch( excp )
        {
            //luaparse 捕获到的错误直接提供给vscode 错误检测
            let rangeStr:string = (excp.message.match("\\[\.+\\]"))[0];
            let message = excp.message.substr(rangeStr.length,excp.message.length);
            rangeStr = rangeStr.replace(/(\[|\])/g,"");
            let rets = rangeStr.split(':');
            let line = parseInt(rets[0])-1;
            let col = parseInt(rets[1]);

            //SysLogger.log("luaparse.parse Error:" + excp + "|" );

            let lineTex = this.currentDoc.doc.lineAt(line);
            let range:vscode.Range = new vscode.Range(new vscode.Position(line,col),new vscode.Position(line,lineTex.text.length));
            this.diagnostics.push(new vscode.Diagnostic(range,message));
            this.diagnosticCollection.set(_uri,this.diagnostics );
        }

    }

    private _reset()
    {
        this.currentParseLine = 0;
        this.currentDocAst = null;
        this.currentScope = null;
        this.currentScopeAst = null;
        this.scopeStack = [];
        this.scopeAstStack=[];
        this.diagnostics = new Array<vscode.Diagnostic>();
        this.moduleChecker = new ModuleChecker();
    }

    //缓存table的定义Items
    _tempTableItemsMap : Map<string,LuaSyntaxItem> = null;
    //缓存每次解析的node的type用于下一个node判断需要依赖前一个node类型时使用
    _lastParseNodeType : string = null;

    /**
     * luaParse onCreateNode事件调用
     * @param ps 
     * @param node 
     */
    private _onCreateNodeParse( ps:SysParsor , node )
    {
        ps.currentAstNode = node;

        //忽略Chunk
        if (node.type === 'Chunk') {

            if ( ps.moduleChecker.isModuleFile === true ) {
                this.currentDocAst.moduleTableItem =  ps.moduleChecker.moduleItem;
            }
            
            return;
        }


        if (node.type === 'Comment' ) {
            return;
        }

        //检测是否是module
        ps.moduleChecker.onCreateNodeParse( ps , node );

        switch(node.type)
        {
            //表定义式判断{x=?,y=?} 两种方式取一
            case 'TableConstructorExpression':
                //TableConstructorExpression的识别在赋值之前，先暂存
                this._tempTableItemsMap = new Map<string,LuaSyntaxItem>();

                for (let index = 0; index < node.fields.length; index++) {
                    const element = node.fields[index];
                    if ( element.type == 'TableKeyString') {
                        if(element.key.type == 'Identifier'){
                            var tempItem = new LuaSyntaxItem(ELuaSyntaxItemType.Variable,element.key,null,this.currentDoc);
                            this._tempTableItemsMap.set(element.key.name,tempItem);
                        }
                    }
                    
                }
                break;
            //赋值式判断
            case 'AssignmentStatement':

                var variable = node.variables[0];
                //特殊情形判断： _G[xxx] = ?
                if ( variable.type == 'IndexExpression') {
                    if (variable.base.type == 'Identifier') {
                        if (variable.base.name == '_G') {
                            //绑到全局表上
                            if (variable.index.type == 'Identifier') {
                                //查找此Identifier的实际值
                                var ret = Utils.findDefinedItemInScopeAstInfo(variable.index.name,this.currentScopeAst);
                                var targetItem = ret.item;
                                if(targetItem)
                                {
                                    if (targetItem.valueItem) {
                                        //获取赋值对象
                                        var valItem2 = ps.getAssignmentValueItem( ps , node.init[0] );
                                        if(valItem2)
                                        {
                                            //可变长参数 '...' 为文件名
                                            if(targetItem.valueItem.astNode.type == 'VarargLiteral')
                                            {                 
                                                GlobalAstInfo.globalItems.set(ps.currentDoc.name,valItem2);
                                            }
                                            else if(targetItem.valueItem.astNode.type == 'StringLiteral' ||
                                            targetItem.valueItem.astNode.type == 'NumericLiteral')
                                            {
                                                GlobalAstInfo.globalItems.set(targetItem.valueItem.astNode.value,valItem2);
                                            }
                                        }

                                    }
                                    
                                }
                            }
                        }
                    }
                }

                //如果是Identifier则直接挂到globalItems上去
                if( variable.type == 'Identifier')
                {

                    if (ps.currentScopeAst.paramsItems != undefined) {
                        //如果已定义则忽略
                        if(ps.currentScopeAst.paramsItems.has(variable.name))
                        {
                            break;
                        }
                    }


                    //如果是模块则挂到模块表上
                    if ( ps.moduleChecker.isModuleFile === true ) {

                        if (ps.moduleChecker.moduleItem.children.has(variable.name)) {
                            break;
                        }

                        var tempItem = new LuaSyntaxItem(ELuaSyntaxItemType.Variable,node,null,this.currentDoc);
                        ps.moduleChecker.moduleItem.children.set(variable.name,tempItem);
                        break;
                    }


                    //否则挂到全局表上
                    if (GlobalAstInfo.globalItems.has(variable.name) || ps.currentScopeAst.localItems.has(variable.name))
                    {
                        break;
                    }

                    var tempItem = new LuaSyntaxItem(ELuaSyntaxItemType.Variable,node,null,this.currentDoc);
                    if(!GlobalAstInfo.globalItems.has(variable.name))
                    {
                        GlobalAstInfo.globalItems.set(variable.name,tempItem);
                    }

                    //简单赋值关联，只关联非MemberExpression类型
                    tempItem.valueItem = ps.getAssignmentValueItem(ps,node.init[0]);
                    
                }else if( variable.type == 'MemberExpression')
                {

                    //递归判断多层嵌套定义
                    ps._checkMemberExpressionInModule(ps,variable)
                }

                break;
            case 'LocalStatement':
                variable = node.variables[0];  
                let localTempItem = null;
                if(variable.type == 'Identifier')
                {

                    localTempItem = new LuaSyntaxItem(ELuaSyntaxItemType.Variable,node,null,this.currentDoc);
                    if(!ps.currentScopeAst.localItems.has(variable.name))
                    {
                        ps.currentScopeAst.localItems.set(variable.name,localTempItem);   
                    }

                    //简单赋值关联，只关联非MemberExpression类型
                    if(node.init.length>0)
                    {
                        localTempItem.valueItem = ps.getAssignmentValueItem(ps,node.init[0]);
                    }

                  
                }else if(variable.type == 'MemberExpression')
                {
                    //递归判断多层嵌套定义
                    localTempItem = ps._checkMemberExpressionLocal(variable,ps,null);

                }

                //当前一个node是TableConstructorExpression表示这个是表格定义
                if ( this._lastParseNodeType == 'TableConstructorExpression' ) {
                    localTempItem.children = this._tempTableItemsMap;
                }

                break;
            case 'FunctionDeclaration':

                if (ps.lastScope) {

                    //说明是临时函数定义
                    if (!node.identifier) {
                        ps.tempFuncItem = new LuaSyntaxItem(ELuaSyntaxItemType.Function,node,null,this.currentDoc);
                        break;
                    }

                    //挂接的根节点是全局
                    var rootItems = GlobalAstInfo.globalItems;
                    //如果是模块则挂到模块表上
                    if ( ps.moduleChecker.isModuleFile === true ) {
                        rootItems = ps.moduleChecker.moduleItem.children;
                    }

                    // //非模块的挂接关系链
                    // if(node.identifier.type == 'Identifier')
                    // {
                    //     if(node.isLocal == true)
                    //     {
                    //         var item = ps.currentScopeAst.localItems.get(node.identifier.name);
                    //         if(!item)
                    //         {
                    //             item = new LuaSyntaxItem(ELuaSyntaxItemType.Function,node.identifier,null,this.currentDoc);
                    //             item.functionAstNode = node;
                    //             ps.currentScopeAst.localItems.set(node.identifier.name,item);
                    //         }
                    //     }else
                    //     {
                    //         item = GlobalAstInfo.globalItems.get(node.identifier.name);
                    //         if(!item)
                    //         {
                    //             item = new LuaSyntaxItem(ELuaSyntaxItemType.Function,node.identifier,null,this.currentDoc);
                    //             item.functionAstNode = node;
                    //             GlobalAstInfo.globalItems.set(node.identifier.name,item);
                    //         }
                    //     }
                    // }else if( node.identifier.type =='MemberExpression')//函数定义式如果是memberexp则递归检测挂接
                    // {
                    //     item = ps._checkMemberExpression(ps,node.identifier,null,ELuaSyntaxItemType.Function);
                    //     if (item) {
                    //         item.functionAstNode = node; 
                    //         item.type = ELuaSyntaxItemType.Function;
                    //     }

                    // }

                    if(node.identifier.type == 'Identifier')
                    {
                        if(node.isLocal == true)
                        {
                            var item = ps.currentScopeAst.localItems.get(node.identifier.name);
                            if(!item)
                            {
                                item = new LuaSyntaxItem(ELuaSyntaxItemType.Function,node.identifier,null,this.currentDoc);
                                item.functionAstNode = node;
                                ps.currentScopeAst.localItems.set(node.identifier.name,item);
                            }
                        }else
                        {
                            item = rootItems.get(node.identifier.name);

                            if(!item)
                            {
                                item = new LuaSyntaxItem(ELuaSyntaxItemType.Function,node.identifier,null,this.currentDoc);
                                item.functionAstNode = node;
                                rootItems.set(node.identifier.name,item);
                            }
                        }
                    }else if( node.identifier.type =='MemberExpression')//函数定义式如果是memberexp则递归检测挂接
                    {
                        item = ps._checkMemberExpressionInModule(ps,node.identifier,null,ELuaSyntaxItemType.Function);
                        if (item) {
                            item.functionAstNode = node; 
                            item.type = ELuaSyntaxItemType.Function;
                        }

                    }

                    //ScopeAst中前置分析的函数参数Item项不准确,这里覆盖，以提供详细参数Node信息
                    node.parameters.forEach(element => {
                        ps.lastScopeAst.paramsItems.set(element.name,
                            new LuaSyntaxItem(ELuaSyntaxItemType.Variable,element,null,this.currentDoc));
                    });

                    break;

                }
        }

        if (ps.scopeStack.length === 0) {
           throw new Error('Empty scope stack when encountering node of type ' + node.type);
        }


        const scope = ps.scopeStack[ps.scopeStack.length - 1];
        node.scope = scope;
        //记录scope的范围信息
        if(scope.startOffset == null)
        {
            scope.startOffset = node.range[0];
        }
        scope.endOffset = node.range[1];
        
        scope.nodes.push(node);
        if (node.type === 'Identifier' && node.name === '__scope_marker__') {
            ps.currentScope = scope;
        }
        else if (node.type === 'CallExpression' && node.base.type === 'MemberExpression') {
            const { name, container } = ps._getIdentifierName(node.base);
            if (name === '__completion_helper__') {
                //ps.completionTableName = container;
            }
        }

        ps.lastAstNode = ps.currentAstNode;
    }


    // /**
    //  * 检测成员表达式 中每一项是否已定义，已定义则挂接
    //  * @param parsor 
    //  * @param node 
    //  * @param lastItem 
    //  * @param type
    //  */
    // _checkMemberExpression(parsor:SysParsor,
    //                         node,
    //                         lastItem:LuaSyntaxItem = null,
    //                         type:ELuaSyntaxItemType = null)
    // {

    //     let itemType = ELuaSyntaxItemType.Variable;
    //     if ( type ) {
    //         itemType = type
    //     }
    //     var tempItem = new LuaSyntaxItem(itemType,node.identifier,null,this.currentDoc);
    //     if(lastItem!=null)
    //     {
    //         lastItem.parent = tempItem;
    //         tempItem.children.set(lastItem.astNode.name,lastItem);
    //     }

    //     if (node.base.type == 'Identifier') {

    //         var rootItem;

    //         //逐级取item
    //         var ret = Utils.findDefinedItemInScopeAstInfo(node.base.name,parsor.currentScopeAst);
    //         rootItem = ret.item;
    //         if(rootItem)
    //         {
    //             if (ret.isParamItem == false ) {
    //                 rootItem.children.set(node.identifier.name,tempItem);
    //             }
    //         }//没有取到则去全局表取
    //         else if(GlobalAstInfo.globalItems.has(node.base.name) )
    //         {
    //             rootItem = GlobalAstInfo.globalItems.get(node.base.name);
    //             rootItem.children.set(node.identifier.name,tempItem);
    //         }

    //         if (rootItem) {
    //             return;
    //         }
   
    //         //没定义则说明是全局
    //         rootItem = GlobalAstInfo.globalItems;
    //         rootItem.set(node.base.name,tempItem);
                 
    //     }else if(node.base.type == 'MemberExpression')
    //     {
    //         parsor._checkMemberExpression(parsor,node.base,tempItem,null);
    //     }

    //     return tempItem;
    // }


    /**
     * local声明的MemberExp解析
     * @param node 
     * @param parsor 
     * @param lastItem 
     */
    private _checkMemberExpressionLocal(node,parsor:SysParsor,lastItem:LuaSyntaxItem = null)
    {

        var tempItem = new LuaSyntaxItem(ELuaSyntaxItemType.Variable,node.identifier,null,this.currentDoc);
        if(lastItem!=null)
        {
            lastItem.parent = tempItem;
            tempItem.children.set(lastItem.astNode.name,lastItem);
        }

        if (node.base.type == 'Identifier') {

            var rootItem;

            rootItem = parsor.currentScopeAst.localItems;
            //如果已定义则挂接
            if (rootItem.has(node.base.name))
            {
                var root = rootItem.get(node.base.name);
                root.children.set(node.identifier.name,tempItem);
            }else
            {
                rootItem.set(node.base.name,tempItem);
            }

            return tempItem;
                 
        }else if(node.base.type == 'MemberExpression')
        {
            parsor._checkMemberExpressionLocal(node.base,parsor,tempItem);
        }
        
    }

    /**
     *  简单赋值关联 如果值节点是基础类型 则赋值到item.valueItem
     *  如果是已定义变量则直接挂接到item.valueItem
     * @param ps                parsor
     * @param valueNode         value node
     * @param varItem           被赋值的变量Item
     */
    getAssignmentValueItem(ps:SysParsor, valueNode )
    {

        var item;
        //基础类型直接创建值类型Item
        if (    
            valueNode.type == 'StringLiteral'||
            valueNode.type == 'NumericLiteral'||
            valueNode.type == 'BooleanLiteral'||
            valueNode.type == 'NilLiteral'||
            valueNode.type == 'VarargLiteral')
        {
            item = new LuaSyntaxItem(ELuaSyntaxItemType.Value,valueNode,null,ps.currentDoc);
        }

        //变量类型则寻找已存在变量定义,找到则把其儿子们复制到新Item中
        if( valueNode.type == 'Identifier')
        {
            item = Utils.findDefinedItemInScopeAstInfo(valueNode.name,ps.currentScopeAst);
            item = item.item;
        }

        return item;

    }


    /**
     * 从标识符Node中取标识符名称 {表示符名，标识符 Base Name},
     * 如果Node类型不是'MemberExpression'则container为null
     * @param identifier    luaparse中identifierNode
     */
    private _getIdentifierName(identifier) {
        if (identifier) {
            switch (identifier.type) {
                case 'Identifier':
                    return { name: identifier.name, container: null };
                case 'MemberExpression':
                    switch (identifier.base.type) {
                        case 'Identifier':
                            return { name: identifier.identifier.name, container: identifier.base.name };
                        default:
                            return { name: identifier.identifier.name, container: null };
                    }
            }
        }
        return { name: null, container: null };
    }


    /**
     * 检测成员表达式 Module版本 中每一项是否已定义，已定义则挂接
     * @param parsor 
     * @param node 
     * @param lastItem 
     * @param type
     */
    private _checkMemberExpressionInModule(parsor:SysParsor,
                            node,
                            lastItem:LuaSyntaxItem = null,
                            type:ELuaSyntaxItemType = null)
    {

        let itemType = ELuaSyntaxItemType.Variable;
        if ( type ) {
            itemType = type
        }
        var tempItem = new LuaSyntaxItem(itemType,node.identifier,null,this.currentDoc);
        if(lastItem!=null)
        {
            lastItem.parent = tempItem;
            tempItem.children.set(lastItem.astNode.name,lastItem);
        }

        if (node.base.type == 'Identifier') {

            var rootItem;

            //把self名称换成类名
            if ( node.base.name === 'self' ) {
                
                let selfObjName = Utils.getCurrentScopeAstSelfObjName(parsor.currentScopeAst);
                if(selfObjName)
                {
                    node.base.name = selfObjName;
                }           
                
            }

            //逐级取item
            var ret = Utils.findDefinedItemInScopeAstInfo(node.base.name,parsor.currentScopeAst);
            rootItem = ret.item;
            if(rootItem)
            {
                if (ret.isParamItem == false ) 
                {
                    if(!rootItem.children.has(node.identifier.name))
                    {
                        rootItem.children.set(node.identifier.name,tempItem);
                    }else
                    {
                        //如果存在则直接挂接子项
                        var item = rootItem.children.get(node.identifier.name);
                        if (lastItem!=null) {
                            item.children.set(lastItem.astNode.name,lastItem);
                        }
                        
                    }
                }

                return;
            }
            
            
            //没有取到同时该文件是Module则去Module中取
            if(parsor.moduleChecker.isModuleFile === true && parsor.moduleChecker.moduleItem.children.has(node.base.name))
            {
                rootItem = parsor.moduleChecker.moduleItem.children.get(node.base.name);
                if(rootItem)
                {
                    //如果没有的话则挂接
                    if (!rootItem.children.has(node.identifier.name)) 
                    {
                        rootItem.children.set(node.identifier.name,tempItem);
                    }else
                    {
                        //如果存在则直接挂接子项
                        var item = rootItem.children.get(node.identifier.name);
                        if (lastItem!=null) {
                            item.children.set(lastItem.astNode.name,lastItem);
                        }
                        
                    }

                    return;
                }
            }
            
            //都没取到并且SeeAll则去全局表中取
            if(GlobalAstInfo.globalItems.has(node.base.name) )
            {
                rootItem = GlobalAstInfo.globalItems.get(node.base.name);
                //如果没有的话则挂接
                if (!rootItem.children.has(node.identifier.name)) 
                {
                    rootItem.children.set(node.identifier.name,tempItem);
                }else
                {
                    //如果存在则直接挂接子项
                    var item = rootItem.children.get(node.identifier.name);
                    if (lastItem!=null) {
                        item.children.set(lastItem.astNode.name,lastItem);
                    }
                    
                }

                return;
            }
            
   
            //没定义则说明是全局或者是Module下
            if (parsor.moduleChecker.isModuleFile === true) 
            {
                rootItem = parsor.moduleChecker.moduleItem.children;
            }else
            {
                rootItem = GlobalAstInfo.globalItems;
            }
            
            rootItem.set(node.base.name,tempItem);
                 
        }else if(node.base.type == 'MemberExpression')
        {
            parsor._checkMemberExpressionInModule(parsor,node.base,tempItem,null);
        }

        return tempItem;
    }




}


class ModuleChecker 
{

    isModuleFile :boolean = false;
    isSeeAll : boolean = false;
    moduleName : string;
    moduleItem : LuaSyntaxItem;

    private hasModuleFlag:boolean = false;
    private hasModuleNameDefined = false


    onCreateNodeParse( _parsor:SysParsor , _node  )
    {
            //识别module
            if (_node.type === 'Identifier' && _node.name === 'module') 
            {
                this.hasModuleFlag = true;
                return;
            }

            if ( this.hasModuleFlag ) {
                //判断是否是Module定义
                if (_node.type === 'StringLiteral')
                {
                    this.isModuleFile = true;
                    this.moduleName = _node.value;

                    //创建此模块 synItem并绑定到GlobalAst上
                    this.moduleItem = new LuaSyntaxItem(ELuaSyntaxItemType.Variable,_node,null,_parsor.currentDoc);
                    GlobalAstInfo.globalItems.set(_parsor.currentDoc.name,this.moduleItem);
                    this.hasModuleNameDefined = true;
                }

                this.hasModuleFlag = false;
                return;
            }

            //识别package.seeall
            if( this.hasModuleNameDefined )
            {
                if(_node.type === 'Identifier' && _node.name === 'package')
                {
                    return;
                }

                if (_node.type === 'Identifier' && _node.name === 'seeall') 
                {
                    this.isSeeAll = true;
                }

                this.hasModuleNameDefined = false;
            }
    }

}