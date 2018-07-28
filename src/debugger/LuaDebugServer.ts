
import { EventEmitter } from 'events';
import * as net from 'net';
import {LuaDebugAdapter} from './DebugAdapter'
import {
    DebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
    Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';

/**
 * LuaDebugger是lua实现的一个 client脚本运行在调试目标程序上，其调用lua debug库,对目标运行过程进行调试
 * 通过lua socket与 LuaDebugServer进行通信，LuaDebugServer即是DebugAdapter与LuaDebugger的通信代理，
 * DebugAdapter通过DAP与vscode编辑器进行通信，
 * 完整调试过程是 DebugAdapter 收到vscode客户端调试指令（DAP协议），然后传递给LuaDebugServer再传递到LuaDebugger，由LuaDebugger执行具体调试处理
 * 调试反馈由LuaDebugger传递给LuaDebugServer再经DebugAdapter传递给vscode客户端表现
 * 
 * 
 * 
 *                        socket                                             socket
 *luaDebugger  client <------------>     luaDebuggerServer|DA|DapServer <-------------> Client(vscode editor)
 */

/**
 * LuaDebugServer  <----> LuaDebugger 之间的通信协议
*/
export class LuaDebuggerProtocal {
    public static S2C_SetBreakPoints = 1

    /**断点设置成功 */
    public static C2S_SetBreakPoints = 2
    public static S2C_RUN = 3
    /**命中断点 */
    public static C2S_HITBreakPoint = 4

    public static S2C_ReqVar = 5
    public static C2S_ReqVar = 6
    //单步跳过
    public static S2C_NextRequest = 7
    //单步跳过反馈
    public static C2S_NextResponse = 8
    //没有单步跳过了 直接跳过
    public static S2C_NextResponseOver = 9
    //单步跳入
    public static S2C_StepInRequest = 10
    //单步跳入返回
    public static C2S_StepInResponse = 11

    //单步跳出
    public static S2C_StepOutRequest = 12
    //单步跳出返回
    public static C2S_StepOutResponse = 13

    //lua打印
    public static C2S_LuaPrint = 14


    //执行lua字符串
    public static S2C_LoadLuaScript = 16
    //执行lua字符串
    public static C2S_LoadLuaScript = 18
    //设置socket的名字
    public static C2S_SetSocketName = 17
    
    public static C2S_DebugXpCall = 20

}

/**
 * LuaDebugServer连接状态
 */
export enum EConnState
{
    Normal,
    Connected,
    Closed
}


/**
 * LuaDebugServer
 */
export class LuaDebugServer extends EventEmitter
{
    _recvDatas:string ;
    _netServer:net.Server = null;
    _connectState:EConnState;
    _da:LuaDebugAdapter;
    _port: number;
    _mainSocket:net.Socket;
    _breakPointSocket: net.Socket;

    get mainSocket(){
        return this._mainSocket;
    }

    get connState(){
        return this._connectState;
    }

    get breakPointSocket(){
        return this._breakPointSocket;
    }

    public constructor(da: LuaDebugAdapter, args: any) {
        super();

        
        this._port = args.port;
        this._da = da;

        this._da.dalog("LuaDebugServer Construction......");
        this._createServer();
    }

    public close() {
        this._netServer.close();
        this._netServer = null;
    }

    public sendMsg(event: number, data?: any, socket?: net.Socket) {

        var sendMsg = {
            event: event,
            data: data
        }


        try {
            var msg = JSON.stringify(sendMsg)
            var currentSocket: net.Socket = socket;
            if (currentSocket == null) {
                currentSocket = this._mainSocket;

            }

            this._da.dalog(">>>>toLuaDB:" + msg );
            currentSocket.write(msg + "\n");

        } catch (erro) {
            this._da.dalog("发送消息到客户端错误:" + erro );
        }
    }


    _createServer()
    {
        try{
            this._da.dalog("LuaDebugServer Create.....");
            let lds = this;
            //this._netServer = net.createServer((socket, self:LuaDebugServer = this )=>this._connectionListenner).listen(this._port);//, self:LuaDebugServer = this
            this._netServer = net.createServer((socket, self:LuaDebugServer = this )=>{
                
                self._da.dalog("accept connection ............");

                self._connectState = EConnState.Connected;
                socket.setEncoding("utf8");
        
                socket.on("data",(data:string)=>{
        
                    if(!data)
                    {
                        self._da.dalog("errordata:\n");
                    }
        
                    self._da.dalog("<<<<fromLuaDB");
                    //self._da.dalog("data:" + data );
        
                    var jsonStr:string = self._recvDatas;
                    if(jsonStr) {
                       data = jsonStr + data
                    }
                    //消息分解
                    var datas: string[] = data.split("__debugger_k0204__")
                    //用来存放原始json消息数据
                    var rawDatas :any[] = [];
                    //存放json转对象后数据
                    var jsonDatas:Array<any> = new Array<any>();
                     for (var index = 0; index < datas.length; index++) {
                            var element = datas[index];
                        // luaDebug.dalog("element:" + element );
                        if (element == "") {
                            // luaDebug.dalog("结束" );
                            continue;
                        }
                        if (element == null) {
                            // luaDebug.dalog("element== null:" );
                            continue;
                        }
        
        
                        try {
                            var jdata = JSON.parse(element)
                            jsonDatas.push(jdata)
                            rawDatas.push(element);
                        } catch (error) {
                            jsonDatas = null
                            self._recvDatas = data;
                            return;
                        }
        
                     }
        
                     self._recvDatas = "";
        
                     for (var index = 0; index < jsonDatas.length; index++) {
        
                        var jdata = jsonDatas[index]
                        var event: number = jdata.event;
        
        
                        if (event == LuaDebuggerProtocal.C2S_SetBreakPoints) {
                            var x = 1;
                            //断点设置成
                        } else if (event == LuaDebuggerProtocal.C2S_HITBreakPoint) {
        
                            self._da.dalog("C2S_HITBreakPoint!!");
                            self._da.isHitBreak = true
                            self.emit("C2S_HITBreakPoint", jdata)
                        } else if (event == LuaDebuggerProtocal.C2S_ReqVar) {
                            self._da.dalog("C2S_ReqVar:" + rawDatas[index]);
                            self.emit("C2S_ReqVar", jdata)
                        } else if (event == LuaDebuggerProtocal.C2S_NextResponse) {
                            self._da.dalog("C2S_NextResponse");
                             self.emit("C2S_NextResponse", jdata);
                            // if(self.checkStackTopFileIsExist(jdata.data.stack[0])){
                            //     self.emit("C2S_NextResponse", jdata);
                            // }else
                            // {
                            //      self.sendMsg(LuaDebuggerProtocal.S2C_NextRequest,-1)
                            // }
                        }
                        else if (event == LuaDebuggerProtocal.S2C_NextResponseOver) {
        
                            self.emit("S2C_NextResponseOver", jdata);
                        } else if (event == LuaDebuggerProtocal.C2S_StepInResponse) {
                            //  if(self.checkStackTopFileIsExist(jdata.data.stack[0])){
                            //      self.emit("C2S_StepInResponse", jdata);
                            // }else
                            // {
                            //     self.sendMsg(LuaDebuggerProtocal.S2C_StepInRequest,-1)
                            // }
                            self.emit("C2S_StepInResponse", jdata);
                           
                        } else if (event == LuaDebuggerProtocal.C2S_StepOutResponse) {
                            self.emit("C2S_StepOutResponse", jdata);
        
                        } else if (event == LuaDebuggerProtocal.C2S_LuaPrint) {
                            self.emit("C2S_LuaPrint", jdata);
                        } else if (event == LuaDebuggerProtocal.C2S_LoadLuaScript) {
                            // if (self.loadLuaCallBack) {
                            //     self.loadLuaCallBack(
                            //         {
        
                            //             result: jdata.data.msg,
                            //             variablesReference: 0
        
                            //         }
                            //     );
                            //     self.loadLuaCallBack = null
        
                            // }
                        }
                        else if(event == LuaDebuggerProtocal.C2S_DebugXpCall) 
                        {
                            self._da.isHitBreak = true
                            self.emit("C2S_HITBreakPoint", jdata)
                        }
        
                        else if (event == LuaDebuggerProtocal.C2S_SetSocketName) {
                            if (jdata.data.name == "mainSocket") {
                                self._da.dalog("client connection!\n");
                                self._mainSocket = socket;
                               
                                //发送断点信息
                                self._sendAllBreakPoint();
                                //发送运行程序的指令 发送run 信息时附带运行时信息 
                                self._da.isHitBreak = false
                                self.sendMsg(LuaDebuggerProtocal.S2C_RUN,
                                    {
                                        runTimeType: self._da.runtimeType,
                                        isProntToConsole:1
                                       
                                    })
                            } else if (jdata.data.name == "breakPointSocket") {
                                self._breakPointSocket = socket;
        
                            }
                        }
                    }
        
                });
        
        
                //数据错误事件
                socket.on('error', (exception)=> {
                    self._da.dalog('socket error:' + exception );
        
                    socket.end();
                });
        

                //客户端关闭事件
                socket.on('close', (data)=> {
                    self._da.dalog('debugerclient close: ');
                });


            }).listen(this._port);


            //服务器监听事件
            this._netServer.on('listening', ( self:LuaDebugServer = this )=>{
                
                self._da.dalog("监听调试端口:" + self._netServer.address().port );
                self.emit("ListenerReady");
            });
    
            //服务器错误事件
            this._netServer.on("error", (exception,self:LuaDebugServer = this ) => {
                self._da.dalog("socket 调试服务器错误:" + exception );
    
            });
    
        }catch( e )
        {
            this._da.dalog('CreateServer Excp: ' + e );
        }

    }


    public _sendAllBreakPoint() {
        var infos = this._da.gpChecker.getAllClientBreakPointInfo()
        this.sendMsg(LuaDebuggerProtocal.S2C_SetBreakPoints, infos, this._mainSocket)
    }

}

