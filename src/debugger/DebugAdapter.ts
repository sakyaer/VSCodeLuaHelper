import { DebugProtocol } from 'vscode-debugprotocol';
import { DebugSession, LoggingDebugSession , InitializedEvent,TerminatedEvent,
         StoppedEvent, BreakpointEvent, OutputEvent,Thread, StackFrame, Scope, Source, Handles, Breakpoint} from 'vscode-debugadapter';
import { BreakpointChecker } from './BreakPointInfo';
import { LuaDebugServer , EConnState,LuaDebuggerProtocal } from './LuaDebugServer';
import * as child_process from 'child_process';
import { RuntimeLoader } from './RuntimeLoader';
import { DebugMonitor ,LuaDebugVarInfo} from './DebugMonitor'
var fs = require('fs');
var ospath = require('path');


export class LuaDebugAdapter extends LoggingDebugSession
{
    
    public isHitBreak: boolean = false
    _bpChecker:BreakpointChecker;
    _luaDebugServer:LuaDebugServer;
    _debugMonitor:DebugMonitor;
    runtimeType:string;
    luaStartProc:child_process.ChildProcess;
    runtimeLoader : RuntimeLoader;
    _fileSuffix : string = ".lua";
    pathMaps: Map<string, Array<string>>;
    public localRoot: string;



    get gpChecker()
    {
        return this._bpChecker;
    }

    constructor()
    {
        super("debugLog.txt");
        // this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(false);
        this.setDebuggerColumnsStartAt1(false);

    }


	public dalog( msg:string )
	{
		//this.sendEvent(new OutputEvent("DA:" + msg + "\n"));
	}

    public log( msg:string )
    {
        this.sendEvent(new OutputEvent(msg + "\n"));
    }

    //data數據結構
    /**data[
     *      stack = [1：[
     *                  src         = 
     *                  scoreName   =
     *                  currentline =
     *                  linedefined =
     *                  what        =
     *                  nameWhat    =
     *              ]];
     *      vars =  [
     *                  1:var1;
     *                  2:var2;
     *              ]
     *      funcs = [
     *                  1:func1;
     *                  2:func2;                 
     *              ]
     *      event = "C2S_HITBreakPoint"
     *      funcsLength = #funcs
     * ]
     * 
    **/
    protected setupProcessHanlders() {
		this._luaDebugServer.on('C2S_HITBreakPoint', result => {
			this._debugMonitor.setStackInfos(result.data.stack)
			this.sendEvent(new StoppedEvent('breakpoint', 1));
		})
		this._luaDebugServer.on('C2S_LuaPrint', result => {
            this.log("lua: " + result.data.msg);
		})

	}

    protected initializeRequest(response: DebugProtocol.InitializeResponse, 
                            args: DebugProtocol.InitializeRequestArguments): void 
    {

        this.dalog("initializeRequest....");

        this.pathMaps = new Map<string, Array<string>>();

        //配置DA是否支持一些可选的功能
        // config the capabilities of this debug adapter
        response.body = response.body || {};
        // the adapter implements the configurationDoneRequest.
        response.body.supportsConfigurationDoneRequest = true;
        // make VS Code to use 'evaluate' when hovering over source
        response.body.supportsEvaluateForHovers = true;

        this.sendEvent(new InitializedEvent()); 
        this.sendResponse(response);       

        this.on("close", (event, self:LuaDebugAdapter = this) => {
            self._luaDebugServer.close();
        });
            
	}
	

	protected attachRequest(response: DebugProtocol.AttachResponse, args: any): void {

		this.dalog("attachRequest....");
		this._luaDebugServer = new LuaDebugServer(this, args);
		this._debugMonitor = new DebugMonitor(this._luaDebugServer, this)
		this.localRoot = args.localRoot
		this.runtimeType = args.runtimeType
		//this.isProntToConsole = args.printType
		this.sendEvent(new OutputEvent("正在检索文件目录" + "\n"))
		this.initPathMaps(args.scripts)
		this.sendEvent(new OutputEvent("检索文件目录完成" + "\n"))
		//注册事件
		this.setupProcessHanlders()
		this.sendResponse(response);
	}
	

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: any) 
    {

        if ( args.noDebug === true ) {
            this.shutdown();
            return;
        }

        let da = this;
        this.dalog("launchRequest....");

        this._luaDebugServer = new LuaDebugServer(this, args);
        this._debugMonitor = new DebugMonitor(this._luaDebugServer,this);

        this.runtimeType = args.runtimeType
        this.localRoot = args.localRoot;
        this.setupProcessHanlders();
        

        this._luaDebugServer.on('ListenerReady', result => {

            da.dalog("ListenerReady....");
            da.dalog("loadRuntime....");
            
            //launch lua runtime
            if (da.luaStartProc) {
                da.luaStartProc.kill()
            }

            da.runtimeLoader = new RuntimeLoader(this);
            da.luaStartProc = da.runtimeLoader.loadRuntime(args);
            
            da.luaStartProc.on('error', error => {
                da.dalog("error:" + error.message);
            });
            
            da.luaStartProc.stderr.setEncoding('utf8');
            da.luaStartProc.stderr.on('data', error => {
                if (typeof(error) == 'string' ) {
                    da.dalog("stderr:-------------------------------------------");
                    da.dalog( error );
                }
            });


            da.luaStartProc.stdout.setEncoding('utf8');
            da.luaStartProc.stdout.on('data', data => {
                if (typeof(data) == 'string' ) {
                    da.dalog("stdout:-------------------------------------------");
                    da.dalog( data );
                }
            });


            da.luaStartProc.on('close', function (code) {
                da.dalog("da process close");
                if (da.runtimeLoader.childPid) {
                    try {
                        process.kill(da.runtimeLoader.childPid);
                    }
                    catch (e) {
                        da.dalog('error..');
                    }
                }
                if(da.runtimeType == "standalone"){
                    da.sendEvent(new TerminatedEvent());
                }
                
            });

		})
   

        this.sendResponse(response);
	}


    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void 
    {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		//this._configurationDone.notify();
    }

    
    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void 
    {

        this.dalog("setBreakPointsRequest....");
        if( this._bpChecker == null)
        {
            this._bpChecker = new BreakpointChecker();
        }

		var path = args.source.path;
		var clientLines = args.lines;

        var breakpoints:DebugProtocol.Breakpoint[] = this._bpChecker.verifiedBreakPoint(path,clientLines);

        var breakInfoStr = "";
        breakpoints.forEach(element => {
            breakInfoStr += element.line;
        });

		response.body = {
			breakpoints: breakpoints
        };
        
        if (this._luaDebugServer != null && this._luaDebugServer.connState == EConnState.Connected) {
			var data = this._bpChecker.getClientBreakPointInfo(path)
			//这里需要做判断 如果 是 断点模式 那么就需要 用mainSocket 进行发送 如果为运行模式就用 breakPointSocket
            // this._luaDebugServer.sendMsg(LuaDebuggerProtocal.S2C_SetBreakPoints, data, 
            //     this.isHitBreak == true ? this._luaDebugServer.mainSocket : this._luaDebugServer.breakPointSocket);
            this._luaDebugServer.sendMsg(LuaDebuggerProtocal.S2C_SetBreakPoints, data, this._luaDebugServer.mainSocket);
        }
        
        this.sendResponse(response);
        this.dalog("setBreakPointsResponse....");
        
    }

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		if (this.luaStartProc) {
			this.luaStartProc.kill()
		}
		super.disconnectRequest(response, args);
	}


    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void
    {
		response.body = {
			threads: [
				new Thread(1, "thread 1")
			]
		};
		this.sendResponse(response);
    }

    

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void
    {
        this.dalog("stackTraceRequest....");

        var stackInfos: Array<any> = this._debugMonitor.getStackInfos()
		const frames = new Array<StackFrame>();
        

		for (var i = 0; i < stackInfos.length; i++) {
            
            var stacckInfo = stackInfos[i];

			var path: string = stacckInfo.src;
			if (path == "=[C]") {
                path = ""

			} else {
				if (path.indexOf(this._fileSuffix) == -1) {
					path = path + this._fileSuffix;
                }

				path = this.convertToServerPath(path)
            }
            

			var tname = path.substring(path.lastIndexOf("/") + 1)
			var line = stacckInfo.currentline
		
			frames.push(new StackFrame(i, stacckInfo.scoreName,
				new Source(tname, path),
                line))
        }
        


		response.body = {
			stackFrames: frames,
			totalFrames: frames.length
        };
        


        this.sendResponse(response);
        
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void
    {
        this.dalog("scopesRequest.... frameID:" + args.frameId);

        const scopes = this._debugMonitor.createScopes(args.frameId)
		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);

    }

    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void
    {
        this.dalog("variablesRequest....");

        var da: LuaDebugAdapter = this;
		var luaDebugVarInfo: LuaDebugVarInfo = this._debugMonitor.getDebugVarsInfoByVariablesReference(args.variablesReference)
		if (luaDebugVarInfo) {
			this._debugMonitor.getVarsInfos(args.variablesReference,
				function (variables) {
					response.body = {
						variables: variables
					};
					da.sendResponse(response);
				});
		}
		else {
			this.sendResponse(response)
		}
    }

    //跳过 F5
    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void
    {
        this.dalog("continueRequest....");
        this._debugMonitor.clear()
		//this.isHitBreak = false
		this._luaDebugServer.sendMsg(LuaDebuggerProtocal.S2C_RUN,
			{
				runTimeType: this.runtimeType,
			})
		this.sendResponse(response);
    }

    protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments) : void 
    {
        this.dalog("reverseContinueRequest....");
    }

    //单步跳过 F10
    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void
    {
        this.dalog("nextRequest....");
        this._debugMonitor.clear()
		var da = this;
		// this.sendEvent(new OutputEvent("nextRequest 单步跳过-->"))
		// if (this.scopesManager_) {
		// 	this.sendEvent(new OutputEvent("scopesManager_ not null"))
		// } else {
		// 	this.sendEvent(new OutputEvent("scopesManager_ null"))
		// }
		function callBackFun(isstep, isover) {
			if (isstep) {
				da.sendEvent(new StoppedEvent("step", 1));
			}
		}
		try {
			this._debugMonitor.stepReq(callBackFun, LuaDebuggerProtocal.S2C_NextRequest)
		} catch (error) {
			this.sendEvent(new OutputEvent("nextRequest error:" + error))
		}
		this.sendResponse(response);
	}

	/**
	 * 单步跳入
	 */
    protected stepInRequest(response: DebugProtocol.StepInResponse): void 
    {
        this.dalog("stepInRequest....");
		this._debugMonitor.clear();
		var da = this;
		this._debugMonitor.stepReq(function (isstep, isover) {
                if (isover) {
                    this.sendEvent(new TerminatedEvent());
                    return;
                }
                if (isstep) {
                    da.sendEvent(new StoppedEvent("step", 1));
                }
            },
             LuaDebuggerProtocal.S2C_StepInRequest
        );
		da.sendResponse(response);
    }
    
	protected pauseRequest(response: DebugProtocol.PauseResponse): void {
		this.sendResponse(response);
		// this.rubyProcess.Run('pause');
	}


    //取变量值
    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void
    {
        this.dalog("evaluateRequest....");
        var da: LuaDebugAdapter = this;
		var frameId = args.frameId;
		if (frameId == null) {
			frameId = 0;
		}
		var expression = args.expression;
		var eindex = expression.lastIndexOf("..")
		if (eindex > -1) {
			expression = expression.substring(eindex + 2)
		}
		eindex = expression.lastIndexOf('"')
		if (eindex == 0) {
			var body = {
				result: expression + '"',
				variablesReference: 0
			}
			response.body = body
			da.sendResponse(response);
			return
		}
		if (args.context == "repl" && args.expression == ">load") {
			// this.luaProcess.runLuaScript({ luastr: getLoadLuaScript(), frameId: args.frameId }, function (body) {
			// 	response.body = body
			// 	da.sendResponse(response);
			// })
			return
		}
		var index: number = 1
		var scopesManager = this._debugMonitor;
		var callBackFun = function (body) {
			if (body == null) {
				index++;
				if (index > 3) {
					response.body =
						{
							result: "nil",
							variablesReference: 0
						}
					da.sendResponse(response);
				} else {
					scopesManager.evaluateRequest(frameId, expression, index, callBackFun, args.context)
				}
			} else {
				response.body = body;
				da.sendResponse(response);
			}
		}
		this._debugMonitor.evaluateRequest(frameId, expression, index, callBackFun, args.context)
    }

    public convertToServerPath(path: string): string {
		if (path.indexOf('@') == 0) {
			path = path.substring(1);
		}
		path = path.replace(/\\/g, "/");
        path = path.replace(new RegExp("/./", "gm"), "/");
        
		var nindex: number = path.lastIndexOf("/");
		var fileName: string = path.substring(nindex + 1);

		fileName = fileName.substr(0,fileName.length - 4) + this._fileSuffix;
		path = path.substr(0,path.length - 4)  + this._fileSuffix;

        var paths: Array<string> = this.pathMaps.get(fileName);
		if (!paths) {
			return path;
		}
		var clientPaths = path.split("/");

		var isHit: boolean = true;
		var hitServerPath = "";
		var pathHitCount: Array<number> = new Array<number>();
		for (var index = 0; index < paths.length; index++) {
			var serverPath = paths[index];
			pathHitCount.push(0);
			var serverPaths = serverPath.split("/");
			var serverPathsCount = serverPaths.length;
			var clientPathsCount = clientPaths.length;
			while (true) {

				if (clientPaths[clientPathsCount--] != serverPaths[serverPathsCount--]) {
					isHit = false;
					break;
				} else {
					pathHitCount[index]++;
				}
				if (clientPathsCount <= 0 || serverPathsCount <= 0) {
					break;
				}
			}
		}
		//判断谁的命中多 

		var maxCount = 0;
		var hitIndex = -1;
		for (var j = 0; j < pathHitCount.length; j++) {
			var count = pathHitCount[j];
			if (count >= maxCount && count > 0) {
				hitIndex = j;
				maxCount = count;
			}
		}
		if (hitIndex > -1) {
			return paths[hitIndex];
		}

    }
    
    private initPathMaps(scripts: Array<string>) {
		var paths: Array<string> = new Array<string>();
		if (scripts) {
			for (var index = 0; index < scripts.length; index++) {
				var scriptPath = scripts[index]
				scriptPath = scriptPath.replace(/\\/g, "/");
				if (scriptPath.charAt(scriptPath.length - 1) != "/") {
					scriptPath += "/"
				}
				paths.push(ospath.normalize(scriptPath))
			}
		}
		paths.push(ospath.normalize(this.localRoot))

		function sortPath(p1, p2) {
			if (p1.length < p2.length) return 0
			else return 1
		}
		paths = paths.sort(sortPath);
		var tempPaths: Array<string> = Array<string>();
		tempPaths.push(paths[0])
		for (var index = 1; index < paths.length; index++) {
			var addPath = paths[index];
			var isAdd = true
			for (var k = 0; k < tempPaths.length; k++) {
				if (addPath == tempPaths[k] || addPath.indexOf(tempPaths[k]) > -1 || tempPaths[k].indexOf(addPath) > -1) {
					isAdd = false
					break;
				}
			}
			if (isAdd) {
				tempPaths.push(addPath)
			}
		}

		this.pathMaps.clear();
		for (var k = 0; k < tempPaths.length; k++) {
			this.readFileList(tempPaths[k])
		}
    }
    
    private readFileList(path: string) {
		if (path.indexOf(".svn") > -1) {
			return
		}
		path = path.replace(/\\/g, "/");
		if (path.charAt(path.length - 1) != "/") {
			path += "/"
		}
		var files = fs.readdirSync(path);
		for (var index = 0; index < files.length; index++) {

			var filePath = path + files[index];

			var stat = fs.statSync(filePath);
			if (stat.isDirectory()) {
				//递归读取文件
				this.readFileList(filePath)
			} else {
				if (filePath.indexOf(this._fileSuffix) > -1) {


					var nindex: number = filePath.lastIndexOf("/");
					var fileName: string = filePath.substring(nindex + 1)
					var filePaths: Array<string> = null
					if (this.pathMaps.has(fileName)) {
						filePaths = this.pathMaps.get(fileName)
					} else {
						filePaths = new Array<string>();
						this.pathMaps.set(fileName, filePaths);

					}
					filePaths.push(filePath)
				}
			}
		}
	}

} 



DebugSession.run(LuaDebugAdapter);