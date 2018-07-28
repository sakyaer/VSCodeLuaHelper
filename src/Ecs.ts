


export interface Component
{
    mid      : number;
    mname    : string;
    mtype    : number;
}


export interface Entity
{
    listComponents : Array<Component>;

}

export interface System
{
    DoSth(_listComps : Array<Component> ) : void ;
}



export enum EComType
{
    Invalid = 0,
    ComWSFileInfoList = 1,

}