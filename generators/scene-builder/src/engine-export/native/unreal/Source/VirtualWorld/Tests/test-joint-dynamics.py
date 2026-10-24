"""Compile and replay EVERY shared JSON checkpoint against the portable native solver."""
import json, pathlib, re, subprocess, tempfile
root = pathlib.Path(__file__).resolve().parent
fixture = json.loads((root / "joint-dynamics-scenarios.json").read_text())
code = ['#include "VirtualWorldJointDynamics.h"', '#include "VirtualWorldJointTransmission.h"', '#include <iostream>', '#include <stdexcept>', 'int main(){ int checks=0;', 'auto near=[](double a,double b){if(std::abs(a-b)>1e-6) throw std::runtime_error("numeric mismatch");};']
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
code += ['{VWJoint::ClockGate clock;clock.suspend();if(clock.advance(false,true))throw std::runtime_error("suspended");clock.resume();if(clock.advance(false,true))throw std::runtime_error("resume catchup");if(!clock.advance(false,true))throw std::runtime_error("resume next frame");clock.suspend();clock.resume();if(clock.advance(true,true)||clock.advance(true,true))throw std::runtime_error("pause lost");if(!clock.advance(false,true))throw std::runtime_error("pause remains stuck");if(clock.advance(false,false)||clock.advance(false,true)||!clock.advance(false,true))throw std::runtime_error("focus transition");}']
# Compile the actual CAD installation action body with the portable core. This
# exercises the adapter policy without substituting a hand-written test policy;
# full Command dispatch/HUD behavior is covered by the native automation test.
story = (root.parent / "Private/VirtualWorldStory.cpp").read_text()
install_body = re.search(r'else if\(Action==TEXT\("brake-install"\)\)\{([^}]+)\}', story).group(1)
sync_running = re.search(r'bRunning=JointDynamics->snapshot\(\).running;', story).group(0)
code += ['{ VWJoint::Dynamics native; auto* JointDynamics=&native; bool bBrakeInstalled=true,bBrakePowered=true,bRunning=false;',
         'const auto toggle=[&](){'+install_body+sync_running+'};',
         'const auto check=[](bool ok,const char* message){if(!ok)throw std::runtime_error(message);};',
         'JointDynamics->start();JointDynamics->tick(.1);JointDynamics->setPowered(false);bBrakePowered=false;JointDynamics->tick(1);',
         'check(std::string(JointDynamics->snapshot().brakePhase)=="holding","holding setup");toggle();',
         'check(!bBrakeInstalled&&bBrakePowered&&!bRunning,"native removal must reset power and clear running intent");',
         'check(!JointDynamics->snapshot().installed&&JointDynamics->snapshot().powered,"native solver/cache installation agreement");',
         'check(JointDynamics->start(),"explicit Run after uninstallation must be accepted");JointDynamics->tick(.1);',
         'const auto before=JointDynamics->snapshot();toggle();',
         'check(bBrakeInstalled&&bBrakePowered&&!bRunning,"installation must not auto-start");near(JointDynamics->snapshot().omega,before.omega);',
         'JointDynamics->tick(.001);check(JointDynamics->snapshot().omega>0&&JointDynamics->snapshot().omega<before.omega,"installation uses bounded ordinary stop");JointDynamics->tick(1);',
         'JointDynamics->start();JointDynamics->tick(.1);const auto moving=JointDynamics->snapshot();toggle();',
         'check(!bRunning,"running removal must clear intent");near(JointDynamics->snapshot().omega,moving.omega);',
         'JointDynamics->tick(.001);check(JointDynamics->snapshot().omega>0&&JointDynamics->snapshot().omega<moving.omega,"removal uses bounded ordinary stop");JointDynamics->tick(1);',
         'toggle();JointDynamics->setPowered(false);bBrakePowered=false;JointDynamics->tick(1);JointDynamics->setPowered(true);bBrakePowered=true;JointDynamics->tick(.03);',
         'check(JointDynamics->snapshot().closure>0&&JointDynamics->snapshot().closure<1,"release setup");toggle();check(!bRunning&&bBrakePowered&&!bBrakeInstalled,"release removal must not auto-start");check(JointDynamics->start(),"release removal allows explicit Run");',
         'std::cout<<"native installation action policy passed\\n"; }']
code += [r"""for(bool flexFixed:{false,true}) {
    const auto f=VWJoint::statedTransmission(101,flexFixed);
    near(f.output,flexFixed?1./101:-1./101);
    near(flexFixed?f.flex:f.circular,0);
    for(double turns:{-101.,0.,101.}) near(f.output*turns,turns/101*(flexFixed?1:-1));
    const auto p=VWJoint::toothTransmission(200,202,flexFixed);
    for(double wave:{-1000.,-.3,0.,.3,1000.})
      near(200*(p.flex*wave-wave),202*(p.circular*wave-wave));
    if(flexFixed)near(p.circular,2./202);else near(p.flex,-2./200);
  }
  bool rejected=false;try{VWJoint::statedTransmission(0,true);}catch(const std::invalid_argument&){rejected=true;}
  if(!rejected)throw std::runtime_error("zero ratio accepted");
  const auto legacy=VWJoint::toothTransmission(200,202,false);near(legacy.output,-.01);
  std::cout<<"101 input turns / signed output, both topology constraints passed\n";
"""]
# Compile the actual native section command branch, so camera and principle
# visibility restoration are verified without copying its policy into the test.
section_start = story.index('else if(Action==TEXT("section"))')
section_open = story.index('{', section_start)
section_end, section_depth = section_open + 1, 1
while section_depth:
    section_depth += (story[section_end] == '{') - (story[section_end] == '}')
    section_end += 1
section_body = story[section_open + 1:section_end - 1]
code += [r"""{ struct NativeSectionHarness {
  bool bSection=false,bPrinciple=true,bSectionCameraSaved=false,bSectionSavedPrinciple=false;
  double SectionSavedTarget=0,SectionSavedOffset=0,SectionSavedUp=0;
  double CameraTarget=12,CameraOffset=10,CameraUp=3;
  void ApplyMechanism(){} void ApplyVisibility(){} void UpdateCamera(){}
  void SelectCadSectionCamera(){CameraTarget=2;CameraOffset=3;CameraUp=4;}
  void section(){""" + section_body + r"""}
};
for(bool principle:{false,true}) {
  NativeSectionHarness view;view.bPrinciple=principle;
  view.section();if(view.bPrinciple||!view.bSection||view.CameraOffset!=3)throw std::runtime_error("section entry must show CAD");
  view.section();if(view.bSection||view.bPrinciple!=principle||view.CameraTarget!=12||view.CameraOffset!=10||view.CameraUp!=3)throw std::runtime_error("section camera and principle visibility must restore together");
}
std::cout<<"native section paired camera/visibility restoration passed\n";
}"""]
code += ['auto r=VWJoint::rollingState(2.3,-.8,.02,.003); near(r.cageAngle*.02-r.worldBallAngle*.003,2.3*.017); near(r.cageAngle*.02+r.worldBallAngle*.003,-.8*.023);', 'std::cout<<checks<<" JSON checkpoints passed; rolling contact residuals passed\\n"; }']
with tempfile.TemporaryDirectory() as tmp:
    source=pathlib.Path(tmp)/'joint.cpp'; source.write_text('\n'.join(code))
    binary=pathlib.Path(tmp)/'joint'
    subprocess.run(['clang++','-std=c++17','-Wall','-Wextra','-Werror','-I'+str(root.parent/'Public'),str(source),'-o',str(binary)],check=True)
    subprocess.run([str(binary)],check=True)
