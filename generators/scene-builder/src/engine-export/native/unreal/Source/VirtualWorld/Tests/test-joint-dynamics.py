"""Compile and replay EVERY shared JSON checkpoint against the portable native solver."""
import json, pathlib, subprocess, tempfile
root = pathlib.Path(__file__).resolve().parent
fixture = json.loads((root / "joint-dynamics-scenarios.json").read_text())
code = ['#include "VirtualWorldJointDynamics.h"', '#include <iostream>', '#include <stdexcept>', 'int main(){ int checks=0;', 'auto near=[](double a,double b){if(std::abs(a-b)>1e-6) throw std::runtime_error("numeric mismatch");};']
config = fixture['config']
for scenario in fixture['scenarios']:
    code += ['{ VWJoint::Config c;']
    for key, value in config.items():
        if isinstance(value, (float,int)): code += [f'c.{key}={value!r};']
    code += ['VWJoint::Dynamics d(c);']
    for action in scenario['actions']:
        method,args=action['method'], action['args']
        if method=='tick':
            opt=args[1] if len(args)>1 else {}
            call=f'd.tick({args[0]!r},{str(opt.get("paused",False)).lower()},{opt.get("timeScale",1)!r})'
        else: call=f'd.{method}('+','.join(json.dumps(a) for a in args)+')'
        if 'accepted' in action: code += [f'if({call}!={str(action["accepted"]).lower()}) throw std::runtime_error("interlock mismatch");']
        else: code += [call+';']
        code += ['{const auto s=d.snapshot();']
        for key,value in action['expected'].items():
            if isinstance(value,bool): code += [f'if(s.{key}!={str(value).lower()}) throw std::runtime_error("{key}");']
            elif isinstance(value,str): code += [f'if(std::string(s.{key})!={json.dumps(value)}) throw std::runtime_error("{key}");']
            else: code += [f'near(s.{key},{value!r});']
        code += ['++checks;}']
    code += ['}']
code += ['for(double direction:{-1.,1.}) for(bool poweroff:{false,true}) { VWJoint::Config c; c.viscousDrag=0; VWJoint::Dynamics d(c);d.setRpm(direction*1e-12);d.start();d.tick(.1);if(poweroff)d.setPowered(false);else d.stop();d.tick(.1);if(d.snapshot().omega!=0)throw std::runtime_error("tiny speed reversed");}']
code += ['auto r=VWJoint::rollingState(2.3,-.8,.02,.003); near(r.cageAngle*.02-r.worldBallAngle*.003,2.3*.017); near(r.cageAngle*.02+r.worldBallAngle*.003,-.8*.023);', 'std::cout<<checks<<" JSON checkpoints passed; rolling contact residuals passed\\n"; }']
with tempfile.TemporaryDirectory() as tmp:
    source=pathlib.Path(tmp)/'joint.cpp'; source.write_text('\n'.join(code))
    binary=pathlib.Path(tmp)/'joint'
    subprocess.run(['clang++','-std=c++17','-Wall','-Wextra','-Werror','-I'+str(root.parent/'Public'),str(source),'-o',str(binary)],check=True)
    subprocess.run([str(binary)],check=True)
