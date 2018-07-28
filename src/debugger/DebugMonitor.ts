import {

	DebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint, Variable
} from 'vscode-debugadapter';

import { LuaDebugServer,LuaDebuggerProtocal } from './LuaDebugServer';
import { LuaDebugAdapter } from './DebugAdapter';

/**
 * 这里直接使用luaIDE ScopesManager
 */

//表示一個变量
export class LuaDebugVarInfo {

	public name: string;
	public vars: any;
	public frameId: number;
	public parent: LuaDebugVarInfo;
	public isRoot: boolean;
	public variablesReference: number;
	public variables;
	public varInfos_: Array<LuaDebugVarInfo>;


	/**
	 * 1. local
	 * 2.	up
	 * 3.global
	 */
	public type: number;
	constructor(frameId: number, name: string, type: number, parent: LuaDebugVarInfo) {
		this.frameId = frameId;
		this.name = name;
		this.type = type;
		this.parent = parent;
		this.isRoot = parent == null ? true : false;
	}

	public getVarInfoByName(name: string): any {
		if (this.vars == null) {
			return -1
		} else {
			for (var i = 0; i < this.vars.length; i++) {
				var varName = this.vars[i].name;
				if (name == varName) {
					return this.vars[i];
				}

			}
		}
		return 0
	}
	public getLuaDebugVarInfo(name: string): any {
		if (this.varInfos_ == null) return -1
		for (var i = 0; i < this.varInfos_.length; i++) {
			var luaDebugVarInfo: LuaDebugVarInfo = this.varInfos_[i];
			if (luaDebugVarInfo.name == name) {
				return luaDebugVarInfo;
			}
		}
		return 0
	}
	/**
	 * 添加属于自己的 LuaDebugVarInfo
	 */
	public addLuaDebugVarInfo(luaDebugVarInfo: LuaDebugVarInfo) {
		if (this.varInfos_ == null) {
			this.varInfos_ = new Array<LuaDebugVarInfo>();
		}
		this.varInfos_.push(luaDebugVarInfo);
	}
	public pushVars(vars) {
		if (this.vars == null) {
			this.vars = [];
		}
		for (var i = 0; i < vars.length; i++) {
			var element = vars[i];
			this.vars.push(element);
		}


	}

	public getVarKeys() {
		var keys: Array<string> = new Array<string>();
		var parent: LuaDebugVarInfo = this;
		while (true) {
			if (parent.parent == null) {
				break;
			}

			keys.push(parent.name)
			parent = parent.parent;
		}
		keys = keys.reverse()
		return keys;
	}

}

//-----------------------------------------------------------------------------------------------------
//-----------------------------------------------------------------------------------------------------

/**
 * DebugMonitor
 */
export class DebugMonitor
{

	stackInfos =[];
	_luaDebugServer:LuaDebugServer;
	_da : LuaDebugAdapter;	//用于调试信息输出

	golbalLuaDebugVarInfo_: LuaDebugVarInfo
	localVarsLuaDebugVarInfos: Map<number, LuaDebugVarInfo>;
	upVarsLuaDebugVarInfos: Map<number, LuaDebugVarInfo>;

	variablesReferenceIndex = 0;
	variableHandles_: Array<LuaDebugVarInfo>;

	//next Request callback
	reqStepCallFunction: Function;
	reqVarsCallFunMap: Map<number, Array<Function>>;


	constructor(_luaDebugServer: LuaDebugServer, da: LuaDebugAdapter) {
		this._luaDebugServer = _luaDebugServer;
		this.variableHandles_ = new Array<LuaDebugVarInfo>();
		this.reqVarsCallFunMap = new Map<number, Array<Function>>();
		//this.luaDebugVarInfos = new Array<LuaDebugVarInfo>();
		this.localVarsLuaDebugVarInfos = new Map<number, LuaDebugVarInfo>();
		this.upVarsLuaDebugVarInfos = new Map<number, LuaDebugVarInfo>();
		this._da = da;
		this.setupProcessHanlders();

	}


	//設置和獲取堆棧信息
    public setStackInfos(stackInfos: Array<any>) {
        this.stackInfos = stackInfos;
    }
    
    public getStackInfos(): Array<any> {
        return this.stackInfos
	}
	

	/**
	 * 获取指定栈帧ID Scope信息
	 * @param frameId
	 */
	public createScopes(frameId: number): Array<Scope> {
		const scopes = [];
		//var stackInfo = this.stackInfos[frameId];
		//先检查local
		var localLuaDebugInfo = this.getLocalLuaDebugInfo(frameId);
		scopes.push({
			name: localLuaDebugInfo.name,
			variablesReference: localLuaDebugInfo.variablesReference,
			expensive: false
		});
		var upLuaDebugInfo = this.getUplLuaDebugInfo(frameId);
		scopes.push({
			name: upLuaDebugInfo.name,
			variablesReference: upLuaDebugInfo.variablesReference,
			expensive: false
		});
		var golbalLuaDebugVarInfo = this.getGolbalLuaDebugVarInfo();
		scopes.push({
			name: this.golbalLuaDebugVarInfo_.name,
			variablesReference: this.golbalLuaDebugVarInfo_.variablesReference,
			expensive: false
		});
		return scopes;
	}




	public clear() {

		this.variableHandles_ = new Array<LuaDebugVarInfo>();
		this.reqVarsCallFunMap.forEach((v, k) => {
			if (v != null && v.length > 0) {
				v.forEach(fun => {
					fun(null)
				})
			}
		})

		this.reqVarsCallFunMap.clear();
		// this.luaDebugVarInfos = new Array<LuaDebugVarInfo>();
		this.localVarsLuaDebugVarInfos.clear();
		this.upVarsLuaDebugVarInfos.clear();
		this.golbalLuaDebugVarInfo_ = null;
	}

	/**
	 * 获取当前堆栈帧的变量信息，以下分了local up global 三种类型
	 * @param frameId 
	 */
	public getLocalLuaDebugInfo(frameId: number) {
		var luaDebugInfo: LuaDebugVarInfo = this.localVarsLuaDebugVarInfos.get(frameId)
		if (luaDebugInfo == null) {
			luaDebugInfo = new LuaDebugVarInfo(frameId, "Local", 1, null);
			this.getNewVariablesReference(luaDebugInfo)
			this.localVarsLuaDebugVarInfos.set(frameId, luaDebugInfo);
		}
		return luaDebugInfo
	}

	public getUplLuaDebugInfo(frameId: number) {
		var luaDebugInfo: LuaDebugVarInfo = this.upVarsLuaDebugVarInfos.get(frameId)
		if (luaDebugInfo == null) {
			luaDebugInfo = new LuaDebugVarInfo(frameId, "Ups", 2, null);
			this.getNewVariablesReference(luaDebugInfo)
			this.upVarsLuaDebugVarInfos.set(frameId, luaDebugInfo);
		}
		return luaDebugInfo
	}

	public getGolbalLuaDebugVarInfo() {
		if (this.golbalLuaDebugVarInfo_ == null) {
			this.golbalLuaDebugVarInfo_ = new LuaDebugVarInfo(0, "Global", 3, null)
			this.getNewVariablesReference(this.golbalLuaDebugVarInfo_)

		}
		return this.golbalLuaDebugVarInfo_;
	}


	/**
	 * 将此DebugVar按顺序放入变量栈variableHandles_中，并记录其序号在luaDebugVarInfo.variablesReference
	 * @param luaDebugVarInfo 
	 */
	public getNewVariablesReference(luaDebugVarInfo: LuaDebugVarInfo) {
		this.variablesReferenceIndex++;
		this.variableHandles_.push(luaDebugVarInfo)
		luaDebugVarInfo.variablesReference = this.variablesReferenceIndex;
		if (this.variablesReferenceIndex > 9001199254740992) {
			this.variablesReferenceIndex = 0;
		}
	}



	protected setupProcessHanlders() {
		this._luaDebugServer.on('C2S_ReqVar', result => {
			this.resVarsInfos(result.data)
		})

		//
		this._luaDebugServer.on('C2S_NextResponse', result => {
		
			this.setStackInfos( result.data.stack);
			this.stepRes(LuaDebuggerProtocal.C2S_NextResponse);
		})
		//下一步结束
		this._luaDebugServer.on('S2C_NextResponseOver', result => {
			// this.stackInfos = null
			// this.stepOverReq();
		})
		/**
		 * 单步跳出
		 */
		this._luaDebugServer.on('C2S_StepInResponse', result => {
		
			this.setStackInfos(result.data.stack);
			this.stepRes(LuaDebuggerProtocal.C2S_StepInResponse);
		})
		this._luaDebugServer.on('C2S_StepOutResponse', result => {
		
			this.setStackInfos(result.data.stack);
			this.stepRes(LuaDebuggerProtocal.C2S_StepOutResponse);
		})


	}




	/**
	 * 调试返回
	 */
	public stepRes(event: number) {

		this.clear();
		if (this.reqStepCallFunction) {
			this.reqStepCallFunction(true, false);
		}

		this.reqStepCallFunction = null;
		// this.luaDebug.sendEvent(new OutputEvent("11111111111111111122\n"))
	}


	/**
	 * 下一步请求
	 */
	public stepReq(callFun: Function, event: number) {

		// this.luaDebug.sendEvent(new OutputEvent("stepReq->单步跳过请求11111111111\n"))
		// if (this.reqStepCallFunction) {
		// 	this.luaDebug.sendEvent(new OutputEvent("stepReq->单步跳过请求11111111111 return\n"))
		// 	return
		// }
		// this.luaDebug.sendEvent(new OutputEvent("stepReq->单步跳过请求22222\n"))
		// if (event == LuaDebuggerEvent.S2C_NextRequest) {

		// 	this.luaDebug.sendEvent(new OutputEvent("单步跳过请求11111111111\n"))
		// } else if (event == LuaDebuggerEvent.S2C_StepInRequest) {

		// 	this.luaDebug.sendEvent(new OutputEvent("单步跳入请求\n"))
		// } else if (event == LuaDebuggerEvent.S2C_StepOutRequest) {

		// 	this.luaDebug.sendEvent(new OutputEvent("单步跳出请求\n"))
		// }


		this.reqStepCallFunction = callFun;
		this._luaDebugServer.sendMsg(event);

	}




	public resVarsInfos(data) {
		var vars = data.vars;
		var isComplete = data.isComplete;
		var variablesReference = data.variablesReference;
		var debugSpeedIndex = data.debugSpeedIndex;



		var luaDebugInfo: LuaDebugVarInfo = this.getDebugVarsInfoByVariablesReference(variablesReference)
		if (luaDebugInfo == null) {
			return
		}
		if (luaDebugInfo.pushVars == null) {
			var x = 1;
		}
		luaDebugInfo.pushVars(vars)
		if (isComplete == 0) {
			return
		}
		const variables = [];
		if (luaDebugInfo.vars.length == 0) {
			variables.push({
				name: "{}",
				type: "table",
				value: "",
				variablesReference: newvariablesReference
			})
		}
		for (var i = 0; i < luaDebugInfo.vars.length; i++) {
			var varInfo = luaDebugInfo.vars[i];
			var newvariablesReference = 0;
			var valueStr = varInfo.valueStr

			valueStr = new Buffer(valueStr,'base64').toString('utf8');
			varInfo.valueStr = valueStr
			if (varInfo.name == "object") {
				var x = 1;
			}
			if (varInfo.valueType == "table" || varInfo.valueType == "userdata") {
				var newVarInfo: LuaDebugVarInfo = new LuaDebugVarInfo(luaDebugInfo.frameId, varInfo.name, luaDebugInfo.type, luaDebugInfo);
				this.getNewVariablesReference(newVarInfo);
				newvariablesReference = newVarInfo.variablesReference
				luaDebugInfo.addLuaDebugVarInfo(newVarInfo);
			}

			if (varInfo.valueType == "string") {
				valueStr = '"' + valueStr + '"'
			}
			var name = varInfo.name;
			if (name == null) {
				continue;
			}
			if (!isNaN(parseInt(name))) {
				var nameType = typeof name
				if (nameType == "string") {
					name = '"' + name + '"'
				}
			}

			var valueType: string = varInfo.valueType;
			name = String(name)
			variables.push({
				name: name,
				type: varInfo.valueType,
				value: valueStr,
				variablesReference: newvariablesReference
			});
		}
		luaDebugInfo.variables = variables

		var callFunctionArr: Array<Function> = this.reqVarsCallFunMap.get(variablesReference);
		if (callFunctionArr) {
			for (var i = 0; i < callFunctionArr.length; i++) {
				var callFunction = callFunctionArr[i];
				callFunction(luaDebugInfo)
			}
			this.reqVarsCallFunMap.delete(variablesReference)
		}
	}


	public getDebugVarsInfoByVariablesReference(variablesReferenceIndex) {
		for (var i = 0; i < this.variableHandles_.length; i++) {
			var element = this.variableHandles_[i];
			if (element.variablesReference == variablesReferenceIndex) {
				return element;
			}
		}
		return null
	}


	/**
	 * 评估查看某变量值
	 */
	public evaluateRequest(frameId: number, expression: string, varType: number, callFunction: Function, context: string) {



		var expressionStrs = []
		//先分解
		if (expression.indexOf('.') > -1) {
			expressionStrs = expression.split('.')
		} else {
			expressionStrs.push(expression);
		}
		//现在本地找如果本地没用再去 客户端找

		var localDebugVarInfo: LuaDebugVarInfo = null;
		if (varType == 1) {
			localDebugVarInfo = this.getLocalLuaDebugInfo(frameId);
		} else if (varType == 2) {
			localDebugVarInfo = this.getUplLuaDebugInfo(frameId);
		} else if (varType == 3) {
			localDebugVarInfo = this.getGolbalLuaDebugVarInfo();
		}


		for (var i = 0; i < expressionStrs.length; i++) {
			var key = expressionStrs[i];
			var varInfo = localDebugVarInfo.getVarInfoByName(key)
			//表示还没有从客户端获取数据 需要获取
			if (varInfo == -1) {
				var scopesManager: DebugMonitor = this;
				//进行数据请求
				var luaDebugInfo: LuaDebugVarInfo = this.getDebugVarsInfoByVariablesReference(localDebugVarInfo.variablesReference)
				if (luaDebugInfo) {
					this.getVarsInfos(localDebugVarInfo.variablesReference, function () {
						scopesManager.evaluateRequest(frameId, expression, varType, callFunction, context)
					})
				} else {
					callFunction(null)
				}


				return
			}
			else if (varInfo == 0) //有数据但是没找到直接忽略
			{
				callFunction(null)
				return
			} else {
				var variablesReference = 0;
				//找到数据

				if (varInfo.valueType == "table" || varInfo.valueType == "userdata") {
					//找对应的 LuaDebugVarInfo
					var ldvInfo = localDebugVarInfo.getLuaDebugVarInfo(varInfo.name);
					localDebugVarInfo = ldvInfo;
					if (ldvInfo == -1) {

						var scopesManager: DebugMonitor = this;
						//进行数据请求
						var luaDebugInfo: LuaDebugVarInfo = this.getDebugVarsInfoByVariablesReference(localDebugVarInfo.variablesReference)
						if (luaDebugInfo) {
							this.getVarsInfos(localDebugVarInfo.variablesReference, function () {
								scopesManager.evaluateRequest(frameId, expression, varType, callFunction, context)
							})
						} else {
							callFunction(null)
						}
						return
						//数组为空
					} else if (ldvInfo == 0) {
						//没有找到
						callFunction(null)
						return
					} else if (localDebugVarInfo != null) {
						if (i == expressionStrs.length - 1) {
							var result: string = expression;
							callFunction({
								result: result,
								variablesReference: localDebugVarInfo.variablesReference
							})
							return
						}
					} else {
						callFunction(null)
						return
					}
				} else {
					if (i == expressionStrs.length - 1) {
						var result: string = expression

						if (varInfo.valueType == "string") {
							result = '"' + varInfo.valueStr + '"';
						} else {
							result = varInfo.valueStr;
						}
						callFunction({
							result: result,
							variablesReference: 0
						})
						return
					}
				}

			}
		}

	}


	public getVarsInfos(variablesReference: number, callBack: Function): any {

		var luaDebugInfo: LuaDebugVarInfo = this.getDebugVarsInfoByVariablesReference(variablesReference)

		if (!this._luaDebugServer.mainSocket) {
			callBack(null)
			return

		}
		if (luaDebugInfo != null && luaDebugInfo.variables != null) {
			callBack(luaDebugInfo.variables)
			return;
		}

		var callFunArr: Array<Function> = this.reqVarsCallFunMap.get(variablesReference)
		if (callFunArr == null) {

			callFunArr = new Array<Function>();
			callFunArr.push(function (luaDebugInfo: LuaDebugVarInfo) {
				if (luaDebugInfo == null) {
					callBack(null);
				} else {
					callBack(luaDebugInfo.variables);
				}

			})

			this.reqVarsCallFunMap.set(variablesReference, callFunArr);
		} else {
			callFunArr.push(function (luaDebugInfo: LuaDebugVarInfo) {
				if (luaDebugInfo == null) {
					callBack(null);
				} else {
					callBack(luaDebugInfo.variables);
				}

			})
			return
		}

		//找到 luaDebugInfo
		var sendData = {
			variablesReference: variablesReference,
			frameId: luaDebugInfo.frameId,
			keys: luaDebugInfo.getVarKeys(),
			type: luaDebugInfo.type
		}

		this._luaDebugServer.sendMsg(LuaDebuggerProtocal.S2C_ReqVar, sendData)

	}






    
}




