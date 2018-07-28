import * as vscode from 'vscode'

import { ComFileAstDirectory } from '../ComFileAstDirectory'
import { Utils } from '../Utils'
import {GlobalAstInfo ,ELuaSyntaxItemType , LuaSyntaxItem } from '../ComAst'

//CompletionItemProvider

export class LuaCompletionItemProvider implements vscode.CompletionItemProvider 
{
    //实现接口
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken) {

        return this._ProvideCompletionItems( document, position, token);
       // return [new vscode.CompletionItem('Hello World!')];

    }

    constructor()
    {
        this.completionItems = [];
    }

    reset()
    {
        this.completionItems = [];
    }

    completionItems:vscode.CompletionItem[];

    private _ProvideCompletionItems(document: vscode.TextDocument,
                                    position: vscode.Position,
                                    token: vscode.CancellationToken)//: Thenable<vscode.CompletionItem[]>
    {

        //入口
        //  2種情形
        //      1.特殊符號（. : " [ @）
        //              特殊符號.: 尋找父級Item對象，然後往下搜索羅列所有子Item
        //                     " [ @ 未作處理            
        //      2.普通字符提示（除上以外的其他情況，索引當前所在Scope,上一級Scope,全局syntaxItem）

        this.reset();

        try{

            var inputLineText = document.lineAt(position.line).text;
            var docAstInfo = ComFileAstDirectory.getSingleton().getDocAstInfoWithUri(document.uri.fsPath);
    
            //獲取當前輸入的字符
            var inputChar = document.getText(new vscode.Range(new vscode.Position(position.line,position.character-1),position));
            if(inputChar == '.' || inputChar == ':')
            {
                let tempChar:string;
                let startPos = 0;
                for (let index = position.character-1; index >=0; index--) {
                    tempChar = inputLineText.charAt(index);
                    if( tempChar != "")
                    {
                        let rets = tempChar.search("[\\s\\r\\t;]");
                        if(rets > -1)
                        {
                            startPos = index + 1;
                            break;
                        }
                    } 
                }
    
                //獲取整個輸入單詞
                let word = inputLineText.substr(startPos,position.character-startPos);
    
                //console.log("word:" + word);
                if(!word)
                {
                    return;
                }
    
                //查找.的前一個符號對應的符號Item
                let parentItem = this._searchSymbolItem(docAstInfo,word,position);
                let tempItem;
                //獲取其Chilren信息
                if ( parentItem ) {
    
                    parentItem.children.forEach((value, key, map) => {
                        let itemKind;
                        if (value.type == ELuaSyntaxItemType.Function) {
                            itemKind = vscode.CompletionItemKind.Function;
                        }else if (value.type == ELuaSyntaxItemType.Variable ) {
                            itemKind = vscode.CompletionItemKind.Variable;
                        }
                        
                        this.completionItems.push(this._createCompItem(key,itemKind));
                    });
                    
                }
                
            }else
            {
                //普通字符提示 
                //定位當前輸入位置屬於哪個Scope
                //查找DocAstInfo scopeStack 以定位输入所在scope按scope逐级网上查找

                if (docAstInfo.scopeAstStack) {

                    //忽略第一个[0],从后往前遍历，因为第一个是全局scope肯定命中，最往后越靠近输入点
                    for (let i = docAstInfo.scopeAstStack.length - 1 ; i > 0 ; i-- ) {

                        let scopeAstInfo = docAstInfo.scopeAstStack[i];

                        let offset = document.offsetAt(position);

                        if (scopeAstInfo.scope.startOffset < offset 
                                &&  offset <= scopeAstInfo.scope.endOffset ) {
                            //Bingo
                            let scopeAst = scopeAstInfo;
                            while(scopeAst)
                            {
                                //scope局部变量
                                scopeAst.localItems.forEach((value, key, map) => {
                                    let itemKind;
                                    if (value.type == ELuaSyntaxItemType.Function) {
                                        itemKind = vscode.CompletionItemKind.Function;
                                    }else if (value.type == ELuaSyntaxItemType.Variable ) {
                                        itemKind = vscode.CompletionItemKind.Variable;
                                    }
                                    
                                    this.completionItems.push(this._createCompItem(key,itemKind));
                                });

                                //scope参数
                                if (scopeAst.paramsItems) {
                                    scopeAst.paramsItems.forEach((value, key, map) => {
                                        let itemKind;
                                        if (value.type == ELuaSyntaxItemType.Function) {
                                            itemKind = vscode.CompletionItemKind.Function;
                                        }else if (value.type == ELuaSyntaxItemType.Variable ) {
                                            itemKind = vscode.CompletionItemKind.Variable;
                                        }
                                        
                                        this.completionItems.push(this._createCompItem(key,itemKind));
                                    });
                                }

                                //向上一级
                                scopeAst = scopeAst.parent
                            }

                            break;    
                        }
                    }     

                }

                //全局查找
                var globalItems = GlobalAstInfo.globalItems;
                //查找全局
                globalItems.forEach((value, key, map) => {
                    let itemKind;
                    if (value.type == ELuaSyntaxItemType.Function) {
                        itemKind = vscode.CompletionItemKind.Function;
                    }else if (value.type == ELuaSyntaxItemType.Variable ) {
                        itemKind = vscode.CompletionItemKind.Variable;
                    }
                    
                    this.completionItems.push(this._createCompItem(key,itemKind));
                });

            }


        }catch( excp )
        {
            console.log("_ProvideCompletionItems Excp:" + excp );
        }
        
        return this.completionItems;

    }

    /**
     * 創建一個提示項 參數參考vscode.CompletionItem
     * @param _label 
     * @param _detail 
     * @param _kind 
     * @param _documentation 
     */
    _createCompItem(
                    _label:string,
                    _kind?:vscode.CompletionItemKind,
                    _detail?:string,
                    _documentation?:string|vscode.MarkdownString
                    ):vscode.CompletionItem
    {
        let comp = new vscode.CompletionItem(_label);
        
        if (_detail) {
            comp.detail = _detail;
        }

        if (_kind) {
            comp.kind = _kind;
        }

        if (_documentation) {
            comp.documentation = _documentation;
        }

        return comp;
    }

    _searchSymbolItem(_docAstInfo, _word , _position):LuaSyntaxItem|null
    {
        if( !_docAstInfo )
        {
            return;
        }

        //先将所有':'统一替换成.
        _word = _word.replace(/:/g,'.');

        //分级取出关键字： 如 xx.xx.keyword 则分别取出祖宗，儿子，孙子...
        let tempNames: Array<string> = _word.split('.')
        let keywords = [];
        tempNames.forEach(e => {
            if ( e != "" ) {
                keywords.push(e);
            }   
        });

        if(keywords.length == 0)
        {
            console.log("Can't find keywords!" );
            return;
        }

        let item;
        let keywordRoot = keywords[0];
        //先查找keywords[0] 把祖宗找到
        //---------------------------------------------
        //查找DocAstInfo scopeStack 以确定scope按scope查找局部local定义
        try{

            let targetScope = Utils.findPositionScopeAst( _docAstInfo , _position );

            if (targetScope) 
            {
                //对self的支持
                if ( keywordRoot === 'self') 
                {
                    //查找当前scope selfObjName
                    let selfObjName = Utils.getCurrentScopeAstSelfObjName(targetScope);
                    if(selfObjName)
                    {
                        keywordRoot = selfObjName;
                    }
                }

                item = Utils.findDefinedItemInScopeAstInfo( keywordRoot , targetScope );
                item = item.item;
            }

            //旧的遍历方式 弃用 abandon
            // let checkLine = _position.line -1;
            // var scopeList = [];
            // if (_docAstInfo.scopeAstStack) {

            //     for (let i = 0; i < _docAstInfo.scopeAstStack.length; i++) {
            //         const scopeAstInfo = _docAstInfo.scopeAstStack[i];

            //         for (let j = 0; j < scopeAstInfo.scope.nodes.length; j++) {
            //             const node = scopeAstInfo.scope.nodes[j];
            //             if(node.type == 'Identifier')
            //             {
            //                 if (node.name == keywordRoot ) {
            //                     //找局部
            //                     item = Utils.findDefinedItemInScopeAstInfo( keywordRoot , scopeAstInfo );
            //                     item = item.item;
            //                     break;
            //                 }
            //             }
            //         }

            //         if(item)
            //         {
            //             break;
            //         }

            //     }
            // }

        }catch(excp)
        {
            console.log("查找DocAstInfo 错误 :" + excp );
        }

        if(!item)
        {
            var globalItems = GlobalAstInfo.globalItems;
            //查找全局
            item = globalItems.get(keywordRoot);
        }

        //只用查找一级的情况
        if(keywords.length == 1)
        {
            return item;
        }


        //需要查找子孙的情况,找到祖宗后找孙子
        let subitem = null;
        if(item)
        {
            //找子孙
            for (let index = 1; index < keywords.length; index++) 
            {
                const subkeyword = keywords[index];
                subitem = item.children.get(subkeyword);
                if(subitem)
                {
                    //找到继续找下一个孙子
                    continue;
                }else
                {
                    //没找到就不用继续找了
                    break;
                }
            }

        }

        //Check祖宗的赋值对象
        if( item && subitem == null)
        {
            if(item.valueItem.type != ELuaSyntaxItemType.Value)
            {
                //找子孙
                for (let index = 1; index < keywords.length; index++) 
                {
                    const subkeyword = keywords[index];
                    subitem = item.valueItem.children.get(subkeyword);
                    if(subitem)
                    {
                        //找到继续找下一个孙子
                        continue;
                    }else
                    {
                        //没找到就不用继续找了
                        break;
                    }
                }
            }
        }


        //最终找到
        if(subitem)
        {
            return subitem;
        }

        return;

    }

}