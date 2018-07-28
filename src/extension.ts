'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {DebugConfigurationProvider} from 'vscode';
import {SysLogger} from './Utils'
import {SysParsor} from './SysParsor'
import {ComConfig} from "./ComConfig"
import { GoDefinitionProvider } from "./providers/LuaDefinitionProvider"
import { LuaCompletionItemProvider } from "./providers/LuaCompletionProvider"
import {TestClassA} from './TestStatic'
import * as Net from 'net';

const LUA_MODE: vscode.DocumentFilter = { language: 'lua', scheme: 'file' };

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {


    //日志初始化
    SysLogger.getSingleton().init();
    SysLogger.getSingleton().log('Welcome to luahelper!');
    SysLogger.getSingleton().log('Logger init ok...');

    try{
        let diagnosticCollection = vscode.languages.createDiagnosticCollection('lua');
        //分析所有工作区所有lua文档
        let parsor = SysParsor.GetSingleton();
        parsor.setupDiagnosticCollection(diagnosticCollection);
        parsor.DoSth();

        //GotoDefinition
        let dpProvider = vscode.languages.registerDefinitionProvider(
            LUA_MODE,new GoDefinitionProvider()
        );

        //CompletionItemProvider
        let cpProvider = vscode.languages.registerCompletionItemProvider(
            LUA_MODE,new LuaCompletionItemProvider(), '.', ":",'"',"[","@"
        );

        //实时编辑分析
        let onDidChangedisPose = vscode.workspace.onDidChangeTextDocument(event => {

            event.contentChanges.forEach(element => {
               // console.log("change:" + element.text); 
            });

            if (ComConfig.GetSingleton().GetIsChangeTextCheck()) {

                if (event.document.languageId == "lua") {

                    //如果是模板文件忽略
                    if (event.document.uri.fsPath.toLowerCase().indexOf("filetemplates") > -1 || event.document.uri.fsPath.toLowerCase().indexOf("funtemplate") > -1) {
                        return;
                    }
                    
                    var uri = event.document.fileName;
                    SysParsor.GetSingleton().parseOne(event.document.uri,event.document);

                }
                
            }
        });


        //文件系统监听器,监听文件新建,删除事件
        let fswatcher = vscode.workspace.createFileSystemWatcher("**/*.lua");
        fswatcher.onDidCreate(eWithUri=>
        {
            console.log("OnFileCreate:" + eWithUri.fsPath );
            vscode.workspace.openTextDocument(eWithUri).then( 
                doc => {    
                    parsor.parseOne(eWithUri,doc);
                }   
            )

        });

        fswatcher.onDidDelete(eWithUri=>
        {
            console.log("OnFileDelete:" + eWithUri.fsPath );
            parsor.removeOneDocAst(eWithUri);
        });



        const provider = new MockConfigurationProvider()
        context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('mock', provider));
        context.subscriptions.push(provider);
        context.subscriptions.push(SysLogger.getSingleton());

        context.subscriptions.push(fswatcher);
        context.subscriptions.push(SysLogger.getSingleton());
        context.subscriptions.push(diagnosticCollection);     
        context.subscriptions.push(dpProvider);
        context.subscriptions.push(cpProvider);
        context.subscriptions.push(onDidChangedisPose);
        SysLogger.getSingleton().log('end.............');
        
        
    }catch( excp )
    {
        SysLogger.getSingleton().log('Extension Excp:' + excp);
    }
    

}

// this method is called when your extension is deactivated
export function deactivate() {
}


class MockConfigurationProvider implements vscode.DebugConfigurationProvider {

	private _server?: Net.Server;

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'markdown' ) {
				config.type = 'mock';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = true;
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

		// if (EMBED_DEBUG_ADAPTER) {
		// 	// start port listener on launch of first debug session
		// 	if (!this._server) {

		// 		// start listening on a random port
		// 		this._server = Net.createServer(socket => {
		// 			const session = new MockDebugSession();
		// 			session.setRunAsServer(true);
		// 			session.start(<NodeJS.ReadableStream>socket, socket);
		// 		}).listen(0);
		// 	}

		// 	// make VS Code connect to debug server instead of launching debug adapter
		// 	config.debugServer = this._server.address().port;
		// }

		return config;
	}

	dispose() {
		if (this._server) {
			this._server.close();
		}
	}
}