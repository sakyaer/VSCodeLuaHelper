

export class TestClassA
{
    val1:number;

    static instance:TestClassA;
    static getSingleton()
    {
        if(!TestClassA.instance) {
            TestClassA.instance = new TestClassA();
        }

        return TestClassA.instance;
    }   

}