#if WITH_DEV_AUTOMATION_TESTS
#include "VirtualWorldRuntime.h"
#include "VirtualWorldCadWindow.h"
#include "VirtualWorldModel.h"
#include "Components/PrimitiveComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Components/StaticMeshComponent.h"
#include "ProceduralMeshComponent.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "Engine/StaticMesh.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/PlayerController.h"
#include "EngineUtils.h"
#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/CoreDelegates.h"
#include "Misc/ScopeExit.h"
#include "HAL/FileManager.h"
#include "UnrealClient.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCadJointFixtureTest,"VirtualWorld.CadJoint.SharedJSONCheckpoints",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldCadJointFixtureTest::RunTest(const FString& Parameters)
{
    FString Text;VW::Json Fixture;
    if(!TestTrue(TEXT("Shared fixture loads"),FFileHelper::LoadFileToString(Text,*(FPaths::ProjectDir()/TEXT("Source/VirtualWorld/Tests/joint-dynamics-scenarios.json")))&&VW::Parse(Text,Fixture)))return false;
    const auto Cfg=VW::Object(Fixture,TEXT("config"));VWJoint::Config C;
#define READ(Name) C.Name=VW::Number(Cfg,TEXT(#Name));
    READ(inertia);READ(driveTorque);READ(brakeTorque);READ(holdTorque);READ(viscousDrag);READ(engageDelay);READ(engageRamp);READ(releaseDelay);READ(releaseRamp);READ(armatureTravel);
#undef READ
    int32 Count=0;
    for(const auto& Value:VW::Array(Fixture,TEXT("scenarios")))
    {
        const auto Scenario=Value->AsObject();VWJoint::Dynamics D(C);
        for(const auto& ActionValue:VW::Array(Scenario,TEXT("actions")))
        {
            const auto A=ActionValue->AsObject(),Expected=VW::Object(A,TEXT("expected"));const FString Method=VW::String(A,TEXT("method"));const auto Args=VW::Array(A,TEXT("args"));
            if(Method==TEXT("setRpm"))D.setRpm(Args[0]->AsNumber());else if(Method==TEXT("start"))TestEqual(TEXT("Release interlock"),D.start(),VW::Bool(A,TEXT("accepted")));
            else if(Method==TEXT("stop"))D.stop();else if(Method==TEXT("setPowered"))D.setPowered(Args[0]->AsBool());else if(Method==TEXT("setInstalled"))D.setInstalled(Args[0]->AsBool());else if(Method==TEXT("reset"))D.reset();
            else if(Method==TEXT("tick")){const VW::Json Options=Args.Num()>1?Args[1]->AsObject():nullptr;D.tick(Args[0]->AsNumber(),VW::Bool(Options,TEXT("paused")),VW::Number(Options,TEXT("timeScale"),1));}
            else AddError(TEXT("Unknown fixture action: ")+Method);
            const auto S=D.snapshot();const FString Prefix=VW::String(Scenario,TEXT("name"))+TEXT("/")+FString::FromInt(Count);
#define CHECK(Name) TestTrue(Prefix+TEXT("/" #Name),FMath::Abs(S.Name-VW::Number(Expected,TEXT(#Name)))<=1e-6);
            CHECK(angle);CHECK(omega);CHECK(time);CHECK(dissipatedEnergy);CHECK(kineticEnergy);CHECK(closure);CHECK(targetRpm);
#undef CHECK
            TestEqual(Prefix+TEXT("/phase"),FString(UTF8_TO_TCHAR(S.brakePhase)),VW::String(Expected,TEXT("brakePhase")));
            TestEqual(Prefix+TEXT("/powered"),S.powered,VW::Bool(Expected,TEXT("powered")));TestEqual(Prefix+TEXT("/installed"),S.installed,VW::Bool(Expected,TEXT("installed")));TestEqual(Prefix+TEXT("/running"),S.running,VW::Bool(Expected,TEXT("running")));++Count;
        }
    }
    TestEqual(TEXT("Every shared checkpoint was replayed"),Count,43);
    for(double Direction:{-1.,1.})for(bool PowerOff:{false,true}){auto Tiny=C;Tiny.viscousDrag=0;VWJoint::Dynamics D(Tiny);D.setRpm(Direction*1e-12);D.start();D.tick(.1);if(PowerOff)D.setPowered(false);else D.stop();D.tick(.1);TestEqual(TEXT("Nonzero tiny speed stops without reversing"),D.snapshot().omega,0.);}
    for(int32 Fps:{5,10,20,60}){VWJoint::Dynamics D(C);D.setRpm(30);D.start();for(int I=0;I<Fps;++I)D.tick(1./Fps);D.setPowered(false);for(int I=0;I<Fps;++I)D.tick(1./Fps);VWJoint::Dynamics Whole(C);Whole.setRpm(30);Whole.start();Whole.tick(1);Whole.setPowered(false);Whole.tick(1);TestTrue(TEXT("FPS angle independence"),FMath::Abs(D.snapshot().angle-Whole.snapshot().angle)<1e-6);TestTrue(TEXT("FPS energy independence"),FMath::Abs(D.snapshot().dissipatedEnergy-Whole.snapshot().dissipatedEnergy)<1e-6);}
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCadJointPivotTest,"VirtualWorld.CadJoint.NonOriginPivotPreservesGeometry",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldCadJointPivotTest::RunTest(const FString& Parameters)
{
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);if(!TestNotNull(TEXT("Transform test world"),World))return false;
    auto* R=World->SpawnActor<AVirtualWorldRuntime>();R->JointDynamics=MakeUnique<VWJoint::Dynamics>();R->JointDynamics->start();
    auto* Root=NewObject<USceneComponent>(R);R->AddInstanceComponent(Root);Root->SetupAttachment(R->GetRootComponent());Root->RegisterComponent();Root->SetRelativeTransform(VW::Transform(FVector(.2,.4,-.1),VW::EulerXYZ(FVector(-PI/2,.2,.3)),FVector::OneVector));R->CadModelRoot=Root;
    auto* Mesh=NewObject<UStaticMeshComponent>(R);R->AddInstanceComponent(Mesh);Mesh->SetupAttachment(Root);Mesh->RegisterComponent();
    FVirtualWorldCadBinding Binding;Binding.Component=Mesh;VW::Parse(TEXT(R"({"role":"input","axis":[0,0,1],"pivot":[0.012,-0.007,0.025]})"),Binding.Data);
    Binding.Original=VW::Transform(FVector(.006,-.003,.002),VW::EulerXYZ(FVector(.1,.2,.3)),FVector(1.3,.8,1.1));Mesh->SetRelativeTransform(Binding.Original);R->CadBindings.Add(Binding);
    const FVector Point(.019,.013,.03),Pivot(.012,-.007,.025),Local=Binding.Original.InverseTransformPosition(VW::Position(Point));
    for(double Dt:{0.,.01,.12,.5})
    {
        R->JointDynamics->tick(Dt);R->ApplyCadJoint();const double Angle=R->JointDynamics->snapshot().angle;
        const FVector Expected=Root->GetComponentTransform().TransformPosition(VW::Position(Pivot+FQuat(FVector(0,0,1),Angle).RotateVector(Point-Pivot)));
        TestTrue(TEXT("Actual component rotates baked vertices about fitted CAD pivot with basis exactly once"),Mesh->GetComponentTransform().TransformPosition(Local).Equals(Expected,1e-6));
        TestTrue(TEXT("CAD scale is unchanged"),Mesh->GetRelativeScale3D().Equals(Binding.Original.GetScale3D(),1e-8));
    }
    World->DestroyWorld(false);return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCadJointTransmissionTest,"VirtualWorld.CadJoint.Stated101ActualOutput",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldCadJointTransmissionTest::RunTest(const FString& Parameters)
{
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);if(!TestNotNull(TEXT("Transmission test world"),World))return false;
    auto* R=World->SpawnActor<AVirtualWorldRuntime>();R->JointDynamics=MakeUnique<VWJoint::Dynamics>();R->CadModelRoot=R->GetRootComponent();
    const FVector Axis(0,0,1),Point(.02,.01,.03);VW::Parse(TEXT("{}"),R->Metadata);
    for(const TCHAR* Role:{TEXT("input"),TEXT("output"),TEXT("flexspline"),TEXT("circular-spline"),TEXT("fixed")})
    {
        auto* Mesh=NewObject<UStaticMeshComponent>(R);R->AddInstanceComponent(Mesh);Mesh->SetupAttachment(R->CadModelRoot);Mesh->RegisterComponent();
        FVirtualWorldCadBinding B;B.Component=Mesh;VW::Parse(FString::Printf(TEXT("{\"role\":\"%s\",\"axis\":[0,0,1],\"pivot\":[0,0,0]}"),Role),B.Data);B.Original=FTransform::Identity;R->CadBindings.Add(B);
    }
    for(bool FlexFixed:{false,true})
    {
        VW::Parse(FString::Printf(TEXT("{\"kind\":\"cad-joint\",\"gear\":{\"status\":\"user-specified\",\"reductionRatio\":101,\"fixedMember\":\"%s\",\"evidence\":\"User specified 101\"}}"),FlexFixed?TEXT("flexspline"):TEXT("circular-spline")),R->Mechanism);
        const auto Factors=R->CadTransmission();TestTrue(TEXT("Stated ratio resolves"),Factors.resolved);
        R->JointDynamics->setRpm(6);R->JointDynamics->start();R->JointDynamics->tick(.1);R->JointDynamics->reset();
        const FString Status=FString::Join(R->StatusLines(),TEXT("\n"));TestTrue(TEXT("HUD reports resolved 101 and source"),Status.Contains(TEXT("101:1"))&&Status.Contains(TEXT("user-provided"))&&!Status.Contains(TEXT("User specified 101"))&&!Status.Contains(TEXT("ratio unresolved")));
        R->Mechanism->SetBoolField(TEXT("motionMarkers"),false);
        const auto Gear=VW::Object(R->Mechanism,TEXT("gear"));Gear->SetStringField(TEXT("fixedMemberProvenance"),TEXT("user-specified"));
        const FString CleanStatus=FString::Join(R->StatusLines(),TEXT("\n"));
        TestFalse(TEXT("Disabled marker UI does not advertise floating balls"),CleanStatus.Contains(TEXT("Orange input"))||CleanStatus.Contains(TEXT("M markers")));
        TestFalse(TEXT("User specified fixed member is not labelled inferred"),CleanStatus.Contains(TEXT("inferred")));
        for(const auto& Action:R->Actions())TestTrue(TEXT("Disabled markers have no action button"),Action.Id!=TEXT("markers"));

        for(double Turns:{-101.,-25.25,0.,25.25,101.})
        {
            R->KinematicOffset=Turns*2*PI;R->ApplyCadJoint();
            for(const auto& B:R->CadBindings)
            {
                const FString Role=VW::String(B.Data,TEXT("role"));const double Factor=Role==TEXT("input")?1:Role==TEXT("output")?Factors.output:Role==TEXT("flexspline")?Factors.flex:Role==TEXT("circular-spline")?Factors.circular:0;
                const FVector Expected=VW::Position(FQuat(Axis,Turns*2*PI*Factor).RotateVector(Point));
                TestTrue(TEXT("Actual bound part follows signed 101 topology"),B.Component->GetComponentTransform().TransformPosition(VW::Position(Point)).Equals(Expected,1e-6));
            }
        }
    }
    VW::Parse(TEXT(R"({"gear":{"status":"evidenced","fixedRing":true,"flexTeeth":200,"ringTeeth":202}})"),R->Mechanism);
    TestTrue(TEXT("Legacy evidenced output remains -1/100"),FMath::Abs(R->CadTransmission().output+.01)<1e-12);
    VW::Parse(TEXT(R"({"gear":{"status":"user-specified","reductionRatio":101,"fixedMember":"flexspline","evidence":"User topology"},"driveChain":{"rotor":1,"shaft":2,"waveGenerator":3,"flexspline":4,"circularSpline":5,"output":6}})"),R->Mechanism);
    TArray<TSharedPtr<FJsonValue>> ChainBindings;
    const TCHAR* ChainRoles[]={TEXT("input"),TEXT("input"),TEXT("input"),TEXT("flexspline"),TEXT("circular-spline"),TEXT("output")};
    for(int I=0;I<6;++I){VW::Json B;VW::Parse(FString::Printf(TEXT("{\"gltfNodeIndex\":%d,\"role\":\"%s\",\"axis\":[0,0,1],\"pivot\":[0,0,%.6f]}"),I+1,ChainRoles[I],I*.01),B);ChainBindings.Add(MakeShared<FJsonValueObject>(B));}
    R->Mechanism->SetArrayField(TEXT("bindings"),ChainBindings);FString Reason;
    TestTrue(TEXT("Complete directed coaxial chain accepts axial pivot displacement"),R->CheckCadDriveChain(Reason));
    auto Chain=VW::Object(R->Mechanism,TEXT("driveChain"));Chain->SetNumberField(TEXT("shaft"),1);
    TestFalse(TEXT("Duplicate chain identity rejected"),R->CheckCadDriveChain(Reason));Chain->SetNumberField(TEXT("shaft"),2);
    auto Wave=ChainBindings[2]->AsObject();Wave->SetStringField(TEXT("role"),TEXT("fixed"));
    TestFalse(TEXT("Stationary wave generator rejected"),R->CheckCadDriveChain(Reason));Wave->SetStringField(TEXT("role"),TEXT("input"));
    Wave->SetArrayField(TEXT("axis"),{MakeShared<FJsonValueNumber>(0),MakeShared<FJsonValueNumber>(0),MakeShared<FJsonValueNumber>(-1)});
    TestFalse(TEXT("Reversed input axis rejected"),R->CheckCadDriveChain(Reason));
    Wave->SetArrayField(TEXT("axis"),{MakeShared<FJsonValueNumber>(0),MakeShared<FJsonValueNumber>(0),MakeShared<FJsonValueNumber>(1)});
    Wave->SetArrayField(TEXT("pivot"),{MakeShared<FJsonValueNumber>(.001),MakeShared<FJsonValueNumber>(0),MakeShared<FJsonValueNumber>(.02)});
    TestFalse(TEXT("Offset input shaft rejected"),R->CheckCadDriveChain(Reason));
    World->DestroyWorld(false);return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCadJointSectionTest,"VirtualWorld.CadJoint.FixedModelSectionRestoresOriginal",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldCadJointSectionTest::RunTest(const FString& Parameters)
{
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);if(!TestNotNull(TEXT("Section test world"),World))return false;
    auto* R=World->SpawnActor<AVirtualWorldRuntime>();VW::Parse(TEXT(R"({"kind":"cad-joint","gear":{"status":"user-specified","reductionRatio":101,"fixedMember":"flexspline","evidence":"User ratio"}})"),R->Mechanism);VW::Parse(TEXT("{}"),R->Metadata);
    R->JointDynamics=MakeUnique<VWJoint::Dynamics>();R->CadModelRoot=R->GetRootComponent();
    R->CadModelRoot->SetWorldTransform(FTransform(FRotator(10,20,30),FVector(20,30,40),FVector(1.2,.8,1.1)));
    UStaticMesh* Cube=LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Cube.Cube"));
    if(!TestNotNull(TEXT("Known editor cube fixture"),Cube)){World->DestroyWorld(false);return false;}
#if WITH_EDITOR
    // The editor fixture already retains its tested vertex/index arrays. Restore this
    // temporary policy flag; imported CAD instead reserves buffers before mesh creation.
    const bool bFixtureCPUAccess=Cube->bAllowCPUAccess;ON_SCOPE_EXIT{Cube->bAllowCPUAccess=bFixtureCPUAccess;};Cube->bAllowCPUAccess=true;
#endif
    auto* Original=NewObject<UStaticMeshComponent>(R);R->AddInstanceComponent(Original);Original->SetupAttachment(R->CadModelRoot);Original->SetStaticMesh(Cube);Original->RegisterComponent();Original->SetRelativeScale3D(FVector(.1));
    FVirtualWorldCadBinding B;B.Component=Original;B.Original=Original->GetRelativeTransform();VW::Parse(TEXT(R"({"role":"output","axis":[0,0,1],"pivot":[0,0,0],"inspectionCut":true})"),B.Data);R->CadBindings.Add(B);
    const UStaticMesh* SourceMesh=Original->GetStaticMesh();const FBoxSphereBounds SourceBounds=Original->Bounds;auto* Material=Original->GetMaterial(0);
    R->Camera=World->SpawnActor<ACameraActor>();const FVector CameraBefore=R->CameraOffset;R->bPrinciple=true;R->Command(TEXT("section"));TestFalse(TEXT("Section entry shows actual CAD without principle overlay"),R->bPrinciple);
    auto& Binding=R->CadBindings[0];if(!TestNotNull(TEXT("Section uses derived procedural geometry"),Binding.InspectionMesh)){World->DestroyWorld(false);return false;}
    auto* Derived=Binding.InspectionMesh;TestFalse(TEXT("Original hidden while display copy is cut"),Original->IsVisible());TestTrue(TEXT("Cut display visible"),Derived->IsVisible());
    const FVector ExpectedCamera=R->CadModelRoot->GetComponentTransform().TransformVectorNoScale(VW::Position(FVector(1,.2,.1))).GetSafeNormal();
    TestTrue(TEXT("Section entry selects near-longitudinal model camera"),R->CameraOffset.GetSafeNormal().Equals(ExpectedCamera,1e-7));
    TestTrue(TEXT("Section up follows model CAD Z"),R->CameraUp.Equals(R->CadModelRoot->GetComponentTransform().TransformVectorNoScale(VW::Position(FVector(0,0,1))).GetSafeNormal(),1e-7));
    TestTrue(TEXT("Cut changes actual display bounds"),Derived->Bounds.BoxExtent.Size()<SourceBounds.BoxExtent.Size());
    for(double Input:{0.,101.*VWJoint::Pi/3.,-101.*VWJoint::Pi/4.})
    {
        R->KinematicOffset=Input;R->ApplyCadJoint();int32 CapTriangles=0,Vertices=0;
        for(int32 S=0;S<Derived->GetNumSections();++S)if(const auto* Section=Derived->GetProcMeshSection(S))
        {
            if(S>=Original->GetStaticMesh()->GetNumSections(0))CapTriangles+=Section->ProcIndexBuffer.Num()/3;
            for(const auto& V:Section->ProcVertexBuffer)
            {
                const FVector Model=R->CadModelRoot->GetComponentTransform().InverseTransformPosition(Derived->GetComponentTransform().TransformPosition(V.Position));
                TestTrue(TEXT("Every cut vertex remains in CAD x<=0 during output motion"),VW::SourcePosition(Model).X<1e-6);++Vertices;
            }
        }
        TestTrue(TEXT("Sliced cube has visible geometry"),Vertices>0);TestTrue(TEXT("Cut face has cap triangles"),CapTriangles>0);
        const uint64 Revision=Binding.InspectionRevision;R->ApplyCadJoint();TestEqual(TEXT("Unchanged pose reuses cut geometry"),Binding.InspectionRevision,Revision);
    }
    R->Command(TEXT("section"));TestTrue(TEXT("Leaving section restores assembly camera"),R->CameraOffset.Equals(CameraBefore,1e-7));TestNull(TEXT("Leaving section releases derived component"),Binding.InspectionMesh);TestFalse(TEXT("Old derived component is unregistered"),Derived->IsRegistered());TestTrue(TEXT("Full original visible again"),Original->IsVisible());TestTrue(TEXT("Source mesh pointer unchanged"),SourceMesh==Original->GetStaticMesh());TestTrue(TEXT("Source material unchanged"),Material==Original->GetMaterial(0));
    R->Command(TEXT("reset"));TestTrue(TEXT("Full bounds restored at zero"),Original->Bounds.BoxExtent.Equals(SourceBounds.BoxExtent,1e-6));
    R->Mechanism->SetStringField(TEXT("inspectionCutaway"),TEXT("quarter-window"));R->Command(TEXT("section"));
    TestTrue(TEXT("Motor window camera looks diagonally into removed quarter"),R->CameraOffset.GetSafeNormal().Equals(R->CadModelRoot->GetComponentTransform().TransformVectorNoScale(VW::Position(FVector(1,1,.15))).GetSafeNormal(),1e-7));
    for(double Input:{0.,101.*VWJoint::Pi/3.})
    {
        R->KinematicOffset=Input;R->ApplyCadJoint();auto* Window=Binding.InspectionMesh;
        bool Q2=false,Q3=false,Q4=false;double Volume=0;
        if(TestNotNull(TEXT("Quarter window derived display"),Window))for(int32 S=0;S<Window->GetNumSections();++S)if(const auto* Part=Window->GetProcMeshSection(S))
        {
            const auto ModelPosition=[R,Window](const FVector& P){return R->CadModelRoot->GetComponentTransform().InverseTransformPosition(Window->GetComponentTransform().TransformPosition(P));};
            for(const auto& V:Part->ProcVertexBuffer){const FVector P=VW::SourcePosition(ModelPosition(V.Position));TestTrue(TEXT("Removed front quadrant stays empty"),P.X<=1e-6||P.Y<=1e-6);Q2|=P.X< -1e-6&&P.Y>1e-6;Q3|=P.X< -1e-6&&P.Y< -1e-6;Q4|=P.X>1e-6&&P.Y< -1e-6;}
            for(int32 I=0;I+2<Part->ProcIndexBuffer.Num();I+=3){const FVector A=ModelPosition(Part->ProcVertexBuffer[Part->ProcIndexBuffer[I]].Position),Bv=ModelPosition(Part->ProcVertexBuffer[Part->ProcIndexBuffer[I+1]].Position),C=ModelPosition(Part->ProcVertexBuffer[Part->ProcIndexBuffer[I+2]].Position);Volume+=FVector::DotProduct(A,FVector::CrossProduct(Bv,C))/6;}
        }
        TestTrue(TEXT("Local window retains geometry in all other three quadrants"),Q2&&Q3&&Q4);
        if(Input==0)TestTrue(TEXT("Capped local window retains three quarters of source cube volume"),FMath::IsNearlyEqual(FMath::Abs(Volume),750.,.1));
    }
    R->Command(TEXT("section"));TestNull(TEXT("Closing motor window disposes merged cut"),Binding.InspectionMesh);TestTrue(TEXT("Complete original remains unchanged"),Original->IsVisible()&&Original->GetStaticMesh()==SourceMesh);R->KinematicOffset=0;
    VW::Json Principle;VW::Parse(TEXT(R"({"flexTeeth":200,"ringTeeth":202,"radius":0.032,"amplitude":0.002,"toothHeight":0.0003,"clearance":0.0001,"position":[0.12,0.025,0]})"),Principle);R->Mechanism->SetObjectField(TEXT("principle"),Principle);R->BuildCadPrinciple();
    R->bPrinciple=false;R->Command(TEXT("principle"));const FVector PrincipleTarget=R->CameraTarget,PrincipleOffset=R->CameraOffset,PrincipleUp=R->CameraUp;
    TestTrue(TEXT("G opens visible face-on principle view"),R->bPrinciple&&R->PrincipleMesh->IsVisible()&&PrincipleOffset.GetSafeNormal().Equals(VW::Position(FVector(0,0,1)).GetSafeNormal(),1e-7));
    R->Command(TEXT("section"));TestFalse(TEXT("C temporarily hides previously focused principle"),R->bPrinciple||R->PrincipleMesh->IsVisible());R->Command(TEXT("section"));
    TestTrue(TEXT("G then C then C restores visible principle with its camera"),R->bPrinciple&&R->PrincipleMesh->IsVisible()&&R->CameraTarget.Equals(PrincipleTarget,1e-7)&&R->CameraOffset.Equals(PrincipleOffset,1e-7)&&R->CameraUp.Equals(PrincipleUp,1e-7));
    VW::Parse(TEXT(R"({"camera":{"position":[0.4,0.4,0.3],"target":[0,0,0]}})"),R->Scene);R->Command(TEXT("frame-assembly"));
    TestFalse(TEXT("H clears section, principle visibility, and the saved principle camera intent"),R->bSection||R->bPrinciple||R->bSectionCameraSaved||R->bSectionSavedPrinciple);

    World->DestroyWorld(false);return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCadJointSectionVisibilityTest,"VirtualWorld.CadJoint.SectionObeysModelAndAncestorVisibility",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldCadJointSectionVisibilityTest::RunTest(const FString& Parameters)
{
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);if(!TestNotNull(TEXT("Section visibility test world"),World))return false;
    auto* R=World->SpawnActor<AVirtualWorldRuntime>();auto* Model=World->SpawnActor<AVirtualWorldModel>();R->CadModelRoot=Model->GetRootComponent();
    VW::Parse(TEXT(R"({"kind":"cad-joint","modelNodeId":"cad"})"),R->Mechanism);VW::Parse(TEXT("{}"),R->Metadata);R->JointDynamics=MakeUnique<VWJoint::Dynamics>();R->bRollingMarkers=true;
    FVirtualWorldNode Parent;Parent.Id=TEXT("assembly");Parent.Wrapper=R->GetRootComponent();VW::Parse(TEXT(R"({"visible":true})"),Parent.Native);R->Nodes.Add(Parent.Id,Parent);
    FVirtualWorldNode Cad;Cad.Id=TEXT("cad");Cad.Parent=Parent.Id;Cad.Wrapper=Model->GetRootComponent();Cad.Model=Model;VW::Parse(TEXT(R"({"visible":true})"),Cad.Native);R->Nodes.Add(Cad.Id,Cad);
    UStaticMesh* Cube=LoadObject<UStaticMesh>(nullptr,TEXT("/Engine/BasicShapes/Cube.Cube"));
    if(!TestNotNull(TEXT("Known editor cube fixture"),Cube)){World->DestroyWorld(false);return false;}
#if WITH_EDITOR
    // The editor fixture already retains its tested vertex/index arrays. Restore this
    // temporary policy flag; imported CAD instead reserves buffers before mesh creation.
    const bool bFixtureCPUAccess=Cube->bAllowCPUAccess;ON_SCOPE_EXIT{Cube->bAllowCPUAccess=bFixtureCPUAccess;};Cube->bAllowCPUAccess=true;
#endif
    auto* Original=NewObject<UStaticMeshComponent>(Model);Model->AddInstanceComponent(Original);Original->SetupAttachment(R->CadModelRoot);Original->SetStaticMesh(Cube);Original->RegisterComponent();Original->SetRelativeScale3D(FVector(.1));
    auto* Marker=NewObject<UStaticMeshComponent>(R);R->AddInstanceComponent(Marker);Marker->SetupAttachment(Original);Marker->SetStaticMesh(Original->GetStaticMesh());Marker->RegisterComponent();R->SceneComponents.Add(Marker);
    FVirtualWorldCadBinding B;B.Component=Original;B.Marker=Marker;B.Original=Original->GetRelativeTransform();VW::Parse(TEXT(R"({"role":"fixed","axis":[0,0,1],"pivot":[0,0,0],"inspectionCut":true})"),B.Data);R->CadBindings.Add(B);
    // Hidden on section entry, hidden while open, and revealed again must share serialized visibility.
    for(const TCHAR* HiddenNode:{TEXT("cad"),TEXT("assembly")})
    {
        auto& Native=R->Nodes[FString(HiddenNode)].Native;Native->SetBoolField(TEXT("visible"),false);
        R->Command(TEXT("section"));auto* Cut=R->CadBindings[0].InspectionMesh;
        if(TestNotNull(TEXT("Hidden model still has a reversible derived section"),Cut))TestFalse(TEXT("Hidden model/ancestor suppresses derived section display"),Cut->IsVisible());
        TestFalse(TEXT("Hidden model/ancestor suppresses runtime-owned markers"),Marker->IsVisible());TestTrue(TEXT("Source actor follows serialized hidden state"),Model->IsHidden());
        Native->SetBoolField(TEXT("visible"),true);R->ApplyVisibility();
        if(Cut)TestTrue(TEXT("Unhiding model reveals section copy"),Cut->IsVisible());TestTrue(TEXT("Unhiding model reveals enabled markers"),Marker->IsVisible());TestFalse(TEXT("Unhidden source actor"),Model->IsHidden());
        Native->SetBoolField(TEXT("visible"),false);R->ApplyVisibility();
        if(Cut)TestFalse(TEXT("Hiding an already open section suppresses copy"),Cut->IsVisible());TestFalse(TEXT("Hiding an already open section suppresses marker"),Marker->IsVisible());
        R->Command(TEXT("section"));TestNull(TEXT("Section close releases copy under hidden ancestor"),R->CadBindings[0].InspectionMesh);TestFalse(TEXT("Closing section cannot reveal hidden markers"),Marker->IsVisible());
        Native->SetBoolField(TEXT("visible"),true);R->ApplyVisibility();TestTrue(TEXT("Full source geometry restored after unhide"),Original->IsVisible()&&!Model->IsHidden());
    }
    // Authored omitted internals must stay absent even when section/markers are toggled.
    R->CadBindings[0].Data->SetBoolField(TEXT("displayHidden"),true);
    for(bool Section:{false,true,false})
    {
        R->bSection=Section;R->ApplyMechanism();R->ApplyVisibility();
        TestFalse(TEXT("Omitted bearing internal stays hidden in assembly and section"),Original->IsVisible());
        TestFalse(TEXT("Omitted bearing internal has no visible motion marker"),Marker->IsVisible());
        TestNull(TEXT("Omitted bearing internal does not create a cut mesh"),R->CadBindings[0].InspectionMesh);
    }
    auto& Transparent=R->CadBindings[0];Transparent.Data->SetBoolField(TEXT("displayHidden"),false);Transparent.Data->SetBoolField(TEXT("inspectionCut"),false);Transparent.Data->SetNumberField(TEXT("inspectionOpacity"),.18);
    auto* SourceMaterial=Original->GetMaterial(0);UStaticMesh* SourceMesh=Original->GetStaticMesh();const bool SourceShadow=Original->CastShadow;
    R->bSection=true;R->ApplyVisibility();auto* Ghost=Cast<UMaterialInstanceDynamic>(Original->GetMaterial(0));
    if(TestNotNull(TEXT("Selected real mesh receives transient inspection material"),Ghost))
    {FLinearColor Color;Ghost->GetVectorParameterValue(FMaterialParameterInfo(TEXT("baseColorFactor")),Color);TestTrue(TEXT("Actual material is translucent with authored opacity"),Ghost->GetBlendMode()==BLEND_Translucent&&FMath::IsNearlyEqual(Color.A,.18f,1e-6f));}
    TestTrue(TEXT("Transparent inspection retains complete original mesh"),Original->GetStaticMesh()==SourceMesh&&Original->IsVisible());TestNull(TEXT("Transparency does not cut the circular spline"),Transparent.InspectionMesh);
    R->ApplyVisibility();TestTrue(TEXT("Material instance reused without per-frame allocation"),Original->GetMaterial(0)==Ghost);
    R->bSection=false;R->ApplyVisibility();TestTrue(TEXT("Leaving inspection restores source material and shadow"),Original->GetMaterial(0)==SourceMaterial&&Original->CastShadow==SourceShadow);
    R->bSection=true;R->ApplyVisibility();R->ReleaseCadSections();TestTrue(TEXT("Scene disposal restores retained source material"),Original->GetMaterial(0)==SourceMaterial);
    Transparent.Data->SetNumberField(TEXT("inspectionWindowRadius"),.02);R->bSection=true;R->ApplyVisibility();
    auto* Radial=Transparent.InspectionMesh;
    if(TestNotNull(TEXT("Central-only transparency has a cached display partition"),Radial))
    {
        double OpaqueArea=0,GhostArea=0;
        for(int S=0;S<Radial->GetNumSections();++S)if(const auto* Part=Radial->GetProcMeshSection(S))
        {
            const bool Translucent=Radial->GetMaterial(S)->GetBlendMode()==BLEND_Translucent;
            for(int I=0;I+2<Part->ProcIndexBuffer.Num();I+=3)
            {
                FVector P[3];for(int J=0;J<3;++J)P[J]=Radial->GetComponentTransform().TransformPosition(Part->ProcVertexBuffer[Part->ProcIndexBuffer[I+J]].Position);
                const double Area=FVector::CrossProduct(P[1]-P[0],P[2]-P[0]).Size()*.5;
                if(Translucent){GhostArea+=Area;for(const auto& V:P){const FVector CAD=VW::SourcePosition(R->CadModelRoot->GetComponentTransform().InverseTransformPosition(V));TestTrue(TEXT("Ghost vertices stay inside central window"),CAD.Size2D()<=.02/FMath::Cos(PI/64)+1e-5);}}
                else OpaqueArea+=Area;
            }
        }
        TestTrue(TEXT("Opaque rim and transparent center both retained"),OpaqueArea>500&&GhostArea>0);
        TestTrue(TEXT("Partition retains all original cube surface area without caps or overlap"),FMath::IsNearlyEqual(OpaqueArea+GhostArea,600.,.05));
        const auto Revision=Transparent.InspectionRevision;R->ApplyVisibility();TestTrue(TEXT("No partition rebuilding on unchanged inspection"),Transparent.InspectionMesh==Radial&&Transparent.InspectionRevision==Revision);
        Original->AddLocalRotation(FRotator(0,20,0));TestTrue(TEXT("Display partition follows actual moving part"),Radial->GetAttachParent()==Original);
    }
    R->bSection=false;R->ApplyVisibility();TestNull(TEXT("Central display disposed on full assembly"),Transparent.InspectionMesh);TestTrue(TEXT("Opaque source and material restored"),Original->IsVisible()&&Original->GetMaterial(0)==SourceMaterial&&Original->GetStaticMesh()==SourceMesh);
    World->DestroyWorld(false);return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCadJointInspectionTest,"VirtualWorld.CadJoint.InstallationControls",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldCadJointInspectionTest::RunTest(const FString& Parameters)
{
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);if(!TestNotNull(TEXT("Installation test world"),World))return false;
    auto* R=World->SpawnActor<AVirtualWorldRuntime>();VW::Parse(TEXT(R"({"kind":"cad-joint"})"),R->Mechanism);VW::Parse(TEXT("{}"),R->Metadata);
    R->JointDynamics=MakeUnique<VWJoint::Dynamics>();R->bHasBrake=true;R->bBrakeInstalled=R->bBrakePowered=true;R->bPaused=false;
    const auto RunEnabled=[R](){for(const auto& A:R->Actions())if(A.Id==TEXT("run"))return A.bEnabled;return false;};
    R->Command(TEXT("run"));R->JointDynamics->tick(.1);R->Command(TEXT("brake-power"));R->JointDynamics->tick(1);
    TestEqual(TEXT("Power-off setup reaches holding"),FString(UTF8_TO_TCHAR(R->JointDynamics->snapshot().brakePhase)),FString(TEXT("holding")));
    TestFalse(TEXT("Run disabled while installed and held"),RunEnabled());R->Command(TEXT("brake-install"));
    TestFalse(TEXT("Removal clears installed cache"),R->bBrakeInstalled);TestTrue(TEXT("Removal resets powered cache"),R->bBrakePowered);TestFalse(TEXT("Removal does not auto-start"),R->bRunning);
    TestTrue(TEXT("No-brake Run action is available after holding"),RunEnabled());R->Command(TEXT("run"));TestTrue(TEXT("Fresh no-brake Run starts solver"),R->JointDynamics->snapshot().running);R->JointDynamics->tick(.1);
    const double BeforeInstall=R->JointDynamics->snapshot().omega;R->Command(TEXT("brake-install"));TestFalse(TEXT("Reinstallation does not auto-start"),R->bRunning);TestEqual(TEXT("Reinstallation preserves instantaneous velocity"),R->JointDynamics->snapshot().omega,BeforeInstall);R->JointDynamics->tick(1);
    R->Command(TEXT("run"));R->JointDynamics->tick(.1);const double BeforeRemoval=R->JointDynamics->snapshot().omega;R->Command(TEXT("brake-install"));
    TestFalse(TEXT("Running removal clears drive intent"),R->bRunning);TestEqual(TEXT("Running removal preserves instantaneous velocity"),R->JointDynamics->snapshot().omega,BeforeRemoval);
    R->JointDynamics->tick(.001);TestTrue(TEXT("Running removal uses bounded ordinary deceleration"),R->JointDynamics->snapshot().omega>0&&R->JointDynamics->snapshot().omega<BeforeRemoval);R->JointDynamics->tick(1);TestEqual(TEXT("Ordinary removal stop completes"),R->JointDynamics->snapshot().omega,0.);
    R->Command(TEXT("brake-install"));R->Command(TEXT("brake-power"));R->JointDynamics->tick(1);R->Command(TEXT("brake-power"));R->JointDynamics->tick(.03);
    TestTrue(TEXT("Removal during release setup"),R->JointDynamics->snapshot().closure>0&&R->JointDynamics->snapshot().closure<1);R->Command(TEXT("brake-install"));
    TestFalse(TEXT("Release removal does not auto-start"),R->bRunning);TestTrue(TEXT("Release removal exposes Run"),RunEnabled());R->Command(TEXT("run"));TestTrue(TEXT("Release removal accepts fresh explicit start"),R->bRunning);
    R->Command(TEXT("slow-motion"));TestEqual(TEXT("Whole clock slow .1x"),R->JointTimeScale,.1);
    R->Command(TEXT("slow-motion"));TestEqual(TEXT("Whole clock slow .02x"),R->JointTimeScale,.02);
    R->Command(TEXT("slow-motion"));TestEqual(TEXT("Whole clock fast 10x"),R->JointTimeScale,10.);
    R->Command(TEXT("slow-motion"));TestEqual(TEXT("Whole clock fast 50x"),R->JointTimeScale,50.);
    R->Command(TEXT("speed-down"));R->Command(TEXT("reset"));
    TestEqual(TEXT("Native reset restores 6 RPM setpoint"),R->Rpm,6.f);TestEqual(TEXT("Native reset restores real-time clock"),R->JointTimeScale,1.);TestFalse(TEXT("Native reset clears running intent"),R->bRunning);
    TestTrue(TEXT("Solver and cached installation/power flags agree"),R->JointDynamics->snapshot().installed==R->bBrakeInstalled&&R->JointDynamics->snapshot().powered==R->bBrakePowered);
    R->Mechanism->SetNumberField(TEXT("defaultRpm"),1000);R->Command(TEXT("reset"));
    TestEqual(TEXT("Authored default restores1000 RPM after reset"),R->Rpm,1000.f);TestEqual(TEXT("Solver receives1000 RPM default"),R->JointDynamics->snapshot().targetRpm,1000.);
    R->Command(TEXT("run"));R->JointDynamics->tick(2);TestTrue(TEXT("Motor reaches1000 RPM on physical clock"),FMath::IsNearlyEqual(R->JointDynamics->snapshot().omega*30/VWJoint::Pi,1000.,1e-6));
    R->Command(TEXT("speed-up"));TestEqual(TEXT("Speed control does not clamp1000 RPM back to30"),R->Rpm,1001.f);
    R->Command(TEXT("reset"));TestEqual(TEXT("Reset retains user default and real-time clock"),R->Rpm,1000.f);TestEqual(TEXT("Reset keeps realtime clock"),R->JointTimeScale,1.);
    World->DestroyWorld(false);return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCadJointSuspensionTest,"VirtualWorld.CadJoint.SuspensionFreezesClock",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldCadJointSuspensionTest::RunTest(const FString& Parameters)
{
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);if(!TestNotNull(TEXT("Clock test world"),World))return false;
    auto* R=World->SpawnActor<AVirtualWorldRuntime>();VW::Parse(TEXT(R"({"kind":"cad-joint"})"),R->Mechanism);R->JointDynamics=MakeUnique<VWJoint::Dynamics>();R->JointDynamics->start();R->bRunning=true;R->JointClockFocusOverride=1;R->BindJointClockLifecycle();
    const auto Cycle=[this,R](FSimpleMulticastDelegate& Suspend,FSimpleMulticastDelegate& Resume)
    {
        const double Before=R->JointDynamics->snapshot().time;Suspend.Broadcast();
        R->Tick(.1f);TestEqual(TEXT("Suspended frames freeze physical clock"),R->JointDynamics->snapshot().time,Before);
        Resume.Broadcast();R->Tick(10.f);TestEqual(TEXT("First resume frame discards entire inactive elapsed time"),R->JointDynamics->snapshot().time,Before);
        R->Tick(.01f);TestTrue(TEXT("Next foreground frame advances normally"),FMath::Abs(R->JointDynamics->snapshot().time-Before-.01)<1e-8);
    };
    Cycle(FCoreDelegates::ApplicationWillDeactivateDelegate,FCoreDelegates::ApplicationHasReactivatedDelegate);
    Cycle(FCoreDelegates::ApplicationWillEnterBackgroundDelegate,FCoreDelegates::ApplicationHasEnteredForegroundDelegate);
    R->bPaused=true;const double Paused=R->JointDynamics->snapshot().time;FCoreDelegates::ApplicationWillDeactivateDelegate.Broadcast();FCoreDelegates::ApplicationHasReactivatedDelegate.Broadcast();R->Tick(10.f);R->Tick(.01f);TestEqual(TEXT("Application resume preserves explicit P pause"),R->JointDynamics->snapshot().time,Paused);
    R->UnbindJointClockLifecycle();TestFalse(TEXT("Deactivation delegate removed"),R->JointDeactivateHandle.IsValid());TestFalse(TEXT("Reactivation delegate removed"),R->JointReactivateHandle.IsValid());
    World->DestroyWorld(false);return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCadJointComponentTest,"VirtualWorld.CadJoint.ActualComponentsAndBrakeStages",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldCadJointComponentTest::RunTest(const FString& Parameters)
{
    AVirtualWorldRuntime* R=nullptr;
    for(const FWorldContext& Context:GEngine->GetWorldContexts())if(Context.World()&&Context.World()->IsGameWorld())for(TActorIterator<AVirtualWorldRuntime> It(Context.World());It;++It)if(It->JointDynamics)R=*It;
    if(!TestNotNull(TEXT("Active real CAD scene required for rendered component evidence"),R))return false;
    TestTrue(TEXT("Fresh scene load uses its authored motor default"),FMath::IsNearlyEqual(double(R->Rpm),VW::Number(R->Mechanism,TEXT("defaultRpm"),6),1e-6));
    if(const auto Chain=VW::Object(R->Mechanism,TEXT("driveChain")))
    {
        FString Reason;TestTrue(TEXT("Actual final GLB drive chain validates"),R->CheckCadDriveChain(Reason));
        for(const TCHAR* Stage:{TEXT("rotor"),TEXT("shaft"),TEXT("waveGenerator"),TEXT("flexspline"),TEXT("circularSpline"),TEXT("output")})
        {int Matches=0;for(const auto& B:R->CadBindings)if(VW::Number(B.Data,TEXT("gltfNodeIndex"),-1)==VW::Number(Chain,Stage)){++Matches;TestNotNull(TEXT("Each real drive stage has an imported component"),Cast<UStaticMeshComponent>(B.Component));}TestTrue(TEXT("Every declared actual drive stage resolves"),Matches>0);}
    }
    const TSharedPtr<VWJoint::Dynamics> Saved=MakeShared<VWJoint::Dynamics>(*R->JointDynamics);const FVector SavedTarget=R->CameraTarget,SavedOffset=R->CameraOffset,SavedUp=R->CameraUp;const float SavedRpm=R->Rpm;
    const bool Paused=R->bPaused,Markers=R->bRollingMarkers,Section=R->bSection,Principle=R->bPrinciple;const double Offset=R->KinematicOffset;
    R->bPaused=true;R->bRollingMarkers=true;R->bSection=true;R->bPrinciple=false;R->KinematicOffset=0;R->JointDynamics->reset();R->JointDynamics->setRpm(30);R->Rpm=30;R->JointDynamics->start();
    const FString Directory=FPaths::ProjectSavedDir()/TEXT("Automation/CadJointMotion");IFileManager::Get().MakeDirectory(*Directory,true);
    AddCommand(new FDelayedFunctionLatentCommand([this,R](){
        for(const auto& Entry:R->CadBindings)if(VW::Bool(Entry.Data,TEXT("inspectionCut")))if(const auto* Static=Cast<UStaticMeshComponent>(Entry.Component))if(UStaticMesh* Mesh=Static->GetStaticMesh())TestTrue(TEXT("Actual imported cut geometry reserves CPU buffers before creation"),Mesh->bAllowCPUAccess);
        if(!VW::Bool(R->Mechanism,TEXT("motionMarkers"),true))
        {
            for(const auto& Entry:R->CadBindings)TestNull(TEXT("Marker-free real CAD creates no floating sphere components"),Entry.Marker);
            R->Command(TEXT("markers"));R->Command(TEXT("markers"));
            for(const auto& Action:R->Actions())TestTrue(TEXT("Marker-free real CAD has no marker button"),Action.Id!=TEXT("markers"));
        }
        R->ApplyMechanism();R->ApplyVisibility();R->SelectCadSectionCamera();R->UpdateCamera();},.1f));
    AddCommand(new FDelayedFunctionLatentCommand([this,R](){
        auto* PC=R->GetWorld()->GetFirstPlayerController();int32 Width=0,Height=0;if(PC)PC->GetViewportSize(Width,Height);TestTrue(TEXT("Renderable viewport exists"),PC&&Width>0&&Height>0);
        const auto ProjectBounds=[this,PC,Width,Height](const FBox& Bounds){for(int I=0;I<8;++I){const FVector Point((I&1)?Bounds.Max.X:Bounds.Min.X,(I&2)?Bounds.Max.Y:Bounds.Min.Y,(I&4)?Bounds.Max.Z:Bounds.Min.Z);FVector2D Pixel;TestTrue(TEXT("Actual and principle bounds fit usable viewport outside HUD"),PC&&PC->ProjectWorldLocationToScreen(Point,Pixel)&&Pixel.X>FMath::Min(450.,Width*.48)&&Pixel.X<Width&&Pixel.Y>0&&Pixel.Y<Height);}};
        for(const auto& Entry:R->CadBindings)ProjectBounds(Entry.Component->Bounds.GetBox());if(R->bPrinciple&&R->PrincipleMesh)ProjectBounds(R->PrincipleMesh->Bounds.GetBox());
    },.1f));
    AddCommand(new FDelayedFunctionLatentCommand([this,R]()
    {
        const auto Factors=R->CadTransmission();TestTrue(TEXT("Actual CAD profile resolves stated transmission"),Factors.resolved);int32 Outputs=0;
        for(double Turns:{-101.,-25.25,0.,25.25,101.})
        {
            R->KinematicOffset=Turns*2*PI;R->ApplyMechanism();
            for(const auto& Entry:R->CadBindings)
            {
                const FString Role=VW::String(Entry.Data,TEXT("role"));
                if(Role!=TEXT("output")&&Role!=TEXT("input")&&Role!=TEXT("flexspline")&&Role!=TEXT("circular-spline")&&Role!=TEXT("fixed")&&Role!=TEXT("unknown"))continue;
                const double Factor=Role==TEXT("output")?Factors.output:Role==TEXT("input")?1:Role==TEXT("flexspline")?Factors.flex:Role==TEXT("circular-spline")?Factors.circular:0;
                const FVector Pivot=VW::Vector(Entry.Data,TEXT("pivot"));const FQuat Rotation(VW::Vector(Entry.Data,TEXT("axis"),FVector(0,0,1)),Turns*2*PI*Factor);
                const FTransform Expected=Entry.Original*VW::Transform(Pivot-Rotation.RotateVector(Pivot),Rotation,FVector::OneVector);
                const auto Actual=Entry.Component->GetComponentTransform().GetRelativeTransform(R->CadModelRoot->GetComponentTransform());
                TestTrue(TEXT("Real CAD part obeys +/-101 turns and signed quarter-output turns"),Actual.Equals(Expected,1e-6));
                if(Role==TEXT("output")||(Role==TEXT("flexspline")&&Factors.flex!=0)||(Role==TEXT("circular-spline")&&Factors.circular!=0))++Outputs;
            }
        }
        TestTrue(TEXT("Actual output hardware is bound"),Outputs>0);R->KinematicOffset=0;R->ApplyMechanism();
    },.1f));
    const auto Stage=[this,R,Directory](FString Name,double Dt,int Power)
    {
        AddCommand(new FDelayedFunctionLatentCommand([this,R,Directory,Name,Dt,Power]()
        {
            if(Power>=0)R->JointDynamics->setPowered(Power==1);R->JointDynamics->tick(Dt);R->ApplyMechanism();R->ApplyVisibility();
            const auto State=R->JointDynamics->snapshot();const VW::Json Report=MakeShared<FJsonObject>();Report->SetStringField(TEXT("stage"),Name);Report->SetStringField(TEXT("brakePhase"),UTF8_TO_TCHAR(State.brakePhase));Report->SetNumberField(TEXT("angle"),State.angle);Report->SetNumberField(TEXT("omega"),State.omega);Report->SetNumberField(TEXT("time"),State.time);Report->SetNumberField(TEXT("closure"),State.closure);Report->SetNumberField(TEXT("energy"),State.dissipatedEnergy);Report->SetNumberField(TEXT("principleSampledGap"),R->PrincipleMinGap);
            TArray<TSharedPtr<FJsonValue>> Readbacks;int32 Balls=0,Outputs=0;const auto Factors=R->CadTransmission();
            for(const auto& Entry:R->CadBindings)
            {
                const auto B=Entry.Data;const FString Role=VW::String(B,TEXT("role"));const auto Actual=Entry.Component->GetComponentTransform().GetRelativeTransform(R->CadModelRoot->GetComponentTransform());
                TestTrue(Name+TEXT(" original scale"),Actual.GetScale3D().Equals(Entry.Original.GetScale3D(),1e-8));
                const bool Omitted=VW::Bool(B,TEXT("displayHidden"));
                TestEqual(Name+TEXT(" section affects only documented components"),Entry.Component->IsVisible(),Entry.bOriginalVisible&&!Omitted&&!VW::Bool(B,TEXT("inspectionHidden"))&&!Entry.bInspectionBuilt);
                if(Omitted){TestNull(Name+TEXT(" omitted internals have no cut mesh"),Entry.InspectionMesh);TestNull(Name+TEXT(" omitted internals have no motion marker"),Entry.Marker);}
                if(VW::Bool(B,TEXT("inspectionCut"))&&!VW::Bool(B,TEXT("inspectionHidden"))&&!Omitted)TestNotNull(Name+TEXT(" selected occluder is actually cut"),Entry.InspectionMesh);
                double Opacity=0;if(B->TryGetNumberField(TEXT("inspectionOpacity"),Opacity)&&!Omitted&&!VW::Bool(B,TEXT("inspectionHidden")))
                {
                    if(B->HasField(TEXT("inspectionWindowRadius")))
                    {
                        if(TestNotNull(Name+TEXT(" real central-only inspection copy"),Entry.InspectionMesh))
                        {
                            bool Opaque=false,Center=false;for(int S=0;S<Entry.InspectionMesh->GetNumSections();++S)if(auto* Material=Entry.InspectionMesh->GetMaterial(S))
                            {
                                if(Material->GetBlendMode()==BLEND_Translucent){Center=true;FLinearColor Color;Material->GetVectorParameterValue(FMaterialParameterInfo(TEXT("baseColorFactor")),Color);TestTrue(Name+TEXT(" central region keeps authored opacity"),FMath::IsNearlyEqual(double(Color.A),Opacity,1e-6));}
                                else Opaque=true;
                            }
                            TestTrue(Name+TEXT(" real cover retains opaque rim and translucent center"),Opaque&&Center);TestTrue(Name+TEXT(" real cover display follows source motion"),Entry.InspectionMesh->GetAttachParent()==Entry.Component);
                        }
                    }
                    else {auto* Ghost=Cast<UMaterialInstanceDynamic>(Entry.Component->GetMaterial(0));if(TestNotNull(Name+TEXT(" real reducer transparency"),Ghost)){FLinearColor Color;Ghost->GetVectorParameterValue(FMaterialParameterInfo(TEXT("baseColorFactor")),Color);TestTrue(Name+TEXT(" real reducer has translucent blend and authored opacity"),Ghost->GetBlendMode()==BLEND_Translucent&&FMath::IsNearlyEqual(double(Color.A),Opacity,1e-6));}TestNull(Name+TEXT(" real transparent body remains complete"),Entry.InspectionMesh);}
                }
                const double Factor=Role==TEXT("output")?Factors.output:Role==TEXT("flexspline")?Factors.flex:Role==TEXT("circular-spline")?Factors.circular:Role==TEXT("input")?1:0;
                if(Factor!=0)
                {
                    const FVector Pivot=VW::Vector(B,TEXT("pivot"));const FQuat Rotation(VW::Vector(B,TEXT("axis")),(State.angle+R->KinematicOffset)*Factor);
                    const FTransform Expected=Entry.Original*VW::Transform(Pivot-Rotation.RotateVector(Pivot),Rotation,FVector::OneVector);
                    TestTrue(Name+TEXT(" actual transmission part transform"),Actual.Equals(Expected,1e-6));
                    if(Role!=TEXT("input"))
                    {
                        ++Outputs;const VW::Json Output=MakeShared<FJsonObject>();Output->SetStringField(TEXT("role"),Role);Output->SetNumberField(TEXT("nodeIndex"),VW::Number(B,TEXT("gltfNodeIndex")));Output->SetNumberField(TEXT("angle"),(State.angle+R->KinematicOffset)*Factor);Output->SetNumberField(TEXT("omega"),State.omega*Factor);Readbacks.Add(MakeShared<FJsonValueObject>(Output));if(VW::Bool(R->Mechanism,TEXT("motionMarkers"),true))TestNotNull(TEXT("Actual output has visible radial marker"),Entry.Marker);
                    }
                }
                if(Role==TEXT("fixed")||Role==TEXT("unknown"))TestTrue(Name+TEXT(" static original"),Actual.Equals(Entry.Original,1e-6));
                if(Role!=TEXT("ball"))continue;++Balls;
                VW::Json Bearing;for(const auto& V:VW::Array(R->Mechanism,TEXT("bearings")))if(VW::String(V->AsObject(),TEXT("id"))==VW::String(B,TEXT("bearingId")))Bearing=V->AsObject();
                const auto Rolling=VWJoint::rollingState(State.angle*VW::Number(Bearing,TEXT("innerSpeedFactor")),State.angle*VW::Number(Bearing,TEXT("outerSpeedFactor")),VW::Number(Bearing,TEXT("pitchRadius")),VW::Number(Bearing,TEXT("ballRadius")));
                const FVector Center=VW::Vector(B,TEXT("center")),Pivot=VW::Vector(B,TEXT("pivot")),Axis=VW::Vector(B,TEXT("axis"));const FVector ExpectedCenter=Pivot+FQuat(Axis,Rolling.cageAngle).RotateVector(Center-Pivot);
                const FVector LocalCenter=Entry.Original.InverseTransformPosition(VW::Position(Center));const FVector ActualCenter=Actual.TransformPosition(LocalCenter);
                const double Error=FVector::Distance(ActualCenter,VW::Position(ExpectedCenter));TestTrue(Name+TEXT(" actual ball orbit center"),Error<1e-6);
                const FQuat ExpectedRotation=VW::Transform(FVector::ZeroVector,FQuat(Axis,Rolling.worldBallAngle),FVector::OneVector).GetRotation()*Entry.Original.GetRotation();TestTrue(Name+TEXT(" actual ball world spin"),Actual.GetRotation().Equals(ExpectedRotation,1e-7));
                if(TestNotNull(TEXT("Optional marker child"),Entry.Marker))
                {
                    const FVector Surface=VW::SourcePosition(Entry.Original.TransformPosition(Entry.Marker->GetRelativeLocation()));const FVector ExpectedMarker=ExpectedCenter+FQuat(Axis,Rolling.worldBallAngle).RotateVector(Surface-Center);
                    const FVector ActualMarker=R->CadModelRoot->GetComponentTransform().InverseTransformPosition(Entry.Marker->GetComponentLocation());TestTrue(Name+TEXT(" visible marker tracks surface spin"),ActualMarker.Equals(VW::Position(ExpectedMarker),1e-6));
                }
                const VW::Json Record=MakeShared<FJsonObject>();Record->SetNumberField(TEXT("nodeIndex"),VW::Number(B,TEXT("gltfNodeIndex")));Record->SetNumberField(TEXT("centerResidualCm"),Error);Record->SetNumberField(TEXT("worldBallAngle"),Rolling.worldBallAngle);Record->SetNumberField(TEXT("cageAngle"),Rolling.cageAngle);const FVector P=Actual.GetTranslation();Record->SetArrayField(TEXT("translationCm"),{MakeShared<FJsonValueNumber>(P.X),MakeShared<FJsonValueNumber>(P.Y),MakeShared<FJsonValueNumber>(P.Z)});Readbacks.Add(MakeShared<FJsonValueObject>(Record));
            }
            int32 ExpectedBalls=0;for(const auto& Entry:R->CadBindings)if(VW::String(Entry.Data,TEXT("role"))==TEXT("ball"))++ExpectedBalls;
            TestEqual(TEXT("Every configured rolling ball was read; exterior-only profile has none"),Balls,ExpectedBalls);TestTrue(TEXT("Actual imported output components were read"),Factors.resolved&&Outputs>0);TestTrue(TEXT("Principle sampled gap finite and nonnegative"),FMath::IsFinite(R->PrincipleMinGap)&&R->PrincipleMinGap>=-1e-10);
            // Geometry readback explicitly opens/synchronizes the optional layer; hidden layers do no frame work.
            const bool PrincipleWasVisible=R->bPrinciple;R->bPrinciple=true;R->UpdateCadPrinciple();R->bPrinciple=PrincipleWasVisible;
            if(TestNotNull(TEXT("Actual principle procedural component"),R->PrincipleMesh))
            {
                const auto* Flex=R->PrincipleMesh->GetProcMeshSection(0);const auto* Ring=R->PrincipleMesh->GetProcMeshSection(1);
                const auto* Cam=R->PrincipleMesh->GetProcMeshSection(2);
                TestTrue(TEXT("Illustrative wave generator has a hollow actual procedural cam"),Cam&&Cam->ProcVertexBuffer.Num()==1536*4);
                if(Cam){const auto P=VW::Object(R->Mechanism,TEXT("principle"));const double Radius=VW::Number(P,TEXT("radius")),Amplitude=VW::Number(P,TEXT("amplitude")),Height=VW::Number(P,TEXT("toothHeight")),Clearance=VW::Number(P,TEXT("clearance"));
                for(int I=0;I<1536;++I){const double U=2*VWJoint::Pi*I/1536,Phi=U+R->InputAngle,Edge=Radius+Amplitude*FMath::Cos(2*U)-FMath::Max(.0004,Height*3)-Height-Clearance;
                const FVector Expected=VW::Position(FVector(Edge*FMath::Cos(Phi),Edge*FMath::Sin(Phi),-.0006));TestTrue(TEXT("Cam surface is synchronous with actual signed input and clears flex"),Cam->ProcVertexBuffer[I*4+1].Position.Equals(Expected,1e-7));
                TestTrue(TEXT("Analytic cam normal remains finite and normalized"),!Cam->ProcVertexBuffer[I*4+1].Normal.ContainsNaN()&&Cam->ProcVertexBuffer[I*4+1].Normal.IsUnit(1e-6));
                TestTrue(TEXT("Cam leaves an open central bore"),FMath::IsNearlyEqual(VW::SourcePosition(Cam->ProcVertexBuffer[I*4].Position).Size2D(),Radius*.25,1e-8));}}
                for(const auto* Strip:{Flex,Ring,Cam})if(Strip)for(int Sample:{0,384,768,1152,1535})for(int Face=0;Face<4;++Face)for(int Triangle=0;Triangle<2;++Triangle)
                {
                    const int Index=Sample*24+Face*6+Triangle*3;
                    const auto& A=Strip->ProcVertexBuffer[Strip->ProcIndexBuffer[Index]];const auto& B=Strip->ProcVertexBuffer[Strip->ProcIndexBuffer[Index+1]];const auto& C=Strip->ProcVertexBuffer[Strip->ProcIndexBuffer[Index+2]];
                    // UE front-face convention, including all four walls and the closed periodic seam.
                    const FVector FaceNormal=FVector::CrossProduct(B.Position-C.Position,A.Position-C.Position).GetSafeNormal();
                    TestTrue(TEXT("Analytic normals face the same exterior side as UE triangle winding"),FVector::DotProduct(FaceNormal,(A.Normal+B.Normal+C.Normal).GetSafeNormal())>0);
                }
                TestTrue(TEXT("Actual closed gear strips contain vertices and triangles"),Flex&&Ring&&Flex->ProcVertexBuffer.Num()>=1536&&Flex->ProcIndexBuffer.Num()>=1536&&Ring->ProcVertexBuffer.Num()>=1536);
                const VW::Json Layer=MakeShared<FJsonObject>();Layer->SetNumberField(TEXT("flexVertices"),Flex?Flex->ProcVertexBuffer.Num():0);Layer->SetNumberField(TEXT("ringVertices"),Ring?Ring->ProcVertexBuffer.Num():0);
                if(R->PrincipleArmature){const FVector Actual=R->PrincipleArmature->GetRelativeLocation();const auto P=VW::Object(R->Mechanism,TEXT("principle"));const FVector Expected=VW::Position(FVector(0,-VW::Number(P,TEXT("radius"))*1.7,State.closure*R->JointDynamics->config.armatureTravel));TestTrue(TEXT("Illustrative armature actual transform follows closure"),Actual.Equals(Expected,1e-8));Layer->SetArrayField(TEXT("armatureTranslationCm"),{MakeShared<FJsonValueNumber>(Actual.X),MakeShared<FJsonValueNumber>(Actual.Y),MakeShared<FJsonValueNumber>(Actual.Z)});}
                if(TestNotNull(TEXT("Fixed illustrative brake pole"),R->PrincipleBrakePole)&&R->PrincipleArmature)
                {
                    const FVector Axis=VW::Position(FVector(0,0,1)).GetSafeNormal();const double GapCm=FVector::DotProduct(R->PrincipleBrakePole->GetRelativeLocation()-R->PrincipleArmature->GetRelativeLocation(),Axis)-.04;
                    TestTrue(TEXT("Actual illustrative air gap closes to contact"),FMath::Abs(GapCm-R->JointDynamics->config.armatureTravel*(1-State.closure)*100)<1e-8);Layer->SetNumberField(TEXT("brakeGapMetres"),GapCm/100);
                    for(auto* Part:{R->PrincipleArmature,R->PrincipleBrakePole})if(auto* Primitive=Cast<UPrimitiveComponent>(Part))TestNotNull(TEXT("Brake principle uses explicit material"),Primitive->GetMaterial(0));
                }
                Report->SetObjectField(TEXT("principleReadback"),Layer);
            }
            Report->SetArrayField(TEXT("components"),Readbacks);FFileHelper::SaveStringToFile(VW::Serialize(Report),*(Directory/(Name+TEXT(".json"))));
        },.1f));
        AddCommand(new FDelayedFunctionLatentCommand([Directory,Name](){FScreenshotRequest::RequestScreenshot(Directory/(Name+TEXT(".png")),false,false);},.3f));AddCommand(new FDelayedFunctionLatentCommand([](){},.3f));
        if(Name.StartsWith(TEXT("brake-")))
        {
            const TSharedPtr<FVector> OffsetBefore=MakeShared<FVector>(),UpBefore=MakeShared<FVector>(),TargetBefore=MakeShared<FVector>();
            AddCommand(new FDelayedFunctionLatentCommand([R,OffsetBefore,UpBefore,TargetBefore](){*OffsetBefore=R->CameraOffset;*UpBefore=R->CameraUp;*TargetBefore=R->CameraTarget;R->bPrinciple=true;R->ApplyVisibility();R->FrameCadBrakeInspection();},.1f));
            AddCommand(new FDelayedFunctionLatentCommand([Directory,Name](){FScreenshotRequest::RequestScreenshot(Directory/(Name+TEXT("-principle-brake.png")),false,false);},.3f));
            AddCommand(new FDelayedFunctionLatentCommand([R,OffsetBefore,UpBefore,TargetBefore](){R->CameraOffset=*OffsetBefore;R->CameraUp=*UpBefore;R->CameraTarget=*TargetBefore;R->bPrinciple=false;R->ApplyVisibility();R->UpdateCamera();},.3f));
        }
    };
    Stage(TEXT("phase-a-released"),.2,-1);Stage(TEXT("phase-b-released"),.13,-1);Stage(TEXT("brake-delay"),.0125,0);Stage(TEXT("brake-engaging"),.025,-1);Stage(TEXT("brake-holding"),.1,-1);Stage(TEXT("brake-release-delay"),.01,1);Stage(TEXT("brake-releasing"),.025,-1);Stage(TEXT("brake-released-no-autostart"),.1,-1);
    AddCommand(new FDelayedFunctionLatentCommand([R](){R->bPrinciple=true;R->ApplyVisibility();R->FrameCadPrincipleInspection();R->UpdateCamera();},.1f));
    AddCommand(new FDelayedFunctionLatentCommand([Directory](){FScreenshotRequest::RequestScreenshot(Directory/TEXT("principle-closeup.png"),false,false);},.3f));AddCommand(new FDelayedFunctionLatentCommand([](){},.3f));
    AddCommand(new FDelayedFunctionLatentCommand([R,Saved,Paused,Markers,Section,Principle,Offset,SavedTarget,SavedOffset,SavedUp,SavedRpm](){R->JointDynamics=MakeUnique<VWJoint::Dynamics>(*Saved);R->bPaused=Paused;R->bRollingMarkers=Markers;R->bSection=Section;R->bPrinciple=Principle;R->KinematicOffset=Offset;R->Rpm=SavedRpm;R->CameraTarget=SavedTarget;R->CameraOffset=SavedOffset;R->CameraUp=SavedUp;R->UpdateCamera();R->bRunning=Saved->snapshot().running;R->ApplyMechanism();R->ApplyVisibility();},.1f));return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCadJointWorkBudgetTest,"VirtualWorld.CadJoint.RuntimeWorkBudget",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldCadJointWorkBudgetTest::RunTest(const FString& Parameters)
{
    AVirtualWorldRuntime* R=nullptr;for(const FWorldContext& Context:GEngine->GetWorldContexts())if(auto* World=Context.World())for(TActorIterator<AVirtualWorldRuntime> It(World);It;++It)if(It->JointDynamics&&It->PrincipleMesh){R=*It;break;}
    if(!TestNotNull(TEXT("Real imported CAD runtime for CPU benchmark"),R))return false;
    const bool SavedPrinciple=R->bPrinciple;const double SavedOffset=R->KinematicOffset;
    ON_SCOPE_EXIT{R->bPrinciple=SavedPrinciple;R->KinematicOffset=SavedOffset;R->ApplyMechanism();R->ApplyVisibility();};
    R->bPrinciple=true;R->ApplyCadJoint();R->bPrinciple=false;R->ApplyVisibility();
    const FVector Initial=R->PrincipleMesh->GetProcMeshSection(0)->ProcVertexBuffer[1].Position;
    const VW::Json Report=MakeShared<FJsonObject>();
    for(bool Visible:{false,true})
    {
        R->bPrinciple=Visible;TArray<double> Samples;
        for(int I=0;I<40;++I){R->KinematicOffset=SavedOffset+.137*(I+1);const double Start=FPlatformTime::Seconds();R->ApplyCadJoint();Samples.Add((FPlatformTime::Seconds()-Start)*1000);}
        Samples.Sort();const auto Mode=MakeShared<FJsonObject>();Mode->SetNumberField(TEXT("medianMs"),Samples[20]);Mode->SetNumberField(TEXT("p95Ms"),Samples[38]);Mode->SetNumberField(TEXT("iterations"),Samples.Num());Report->SetObjectField(Visible?TEXT("principleVisible"):TEXT("principleHidden"),Mode);
        if(!Visible)TestTrue(TEXT("Hidden principle keeps its initial vertex buffers until shown"),R->PrincipleMesh->GetProcMeshSection(0)->ProcVertexBuffer[1].Position.Equals(Initial,1e-9));
    }
    FString Label=TEXT("current");FParse::Value(FCommandLine::Get(),TEXT("VirtualWorldPerfLabel="),Label);
    const FString Directory=FPaths::ProjectSavedDir()/TEXT("Automation/CadJointPerformance");IFileManager::Get().MakeDirectory(*Directory,true);
    FFileHelper::SaveStringToFile(VW::Serialize(Report),*(Directory/Label+TEXT(".json")),FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCadWindowMaterialTest,"VirtualWorld.CadJoint.CentralWindowMaterialSlots",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldCadWindowMaterialTest::RunTest(const FString& Parameters)
{
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);auto* R=World->SpawnActor<AVirtualWorldRuntime>();
    auto* Inside=NewObject<UProceduralMeshComponent>(R);R->AddInstanceComponent(Inside);Inside->SetupAttachment(R->GetRootComponent());Inside->RegisterComponent();
    auto* Base=LoadObject<UMaterialInterface>(nullptr,TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
    for(int S=0;S<2;++S)
    {
        const double Size=S==0?.001:.04,Z=S*.001;TArray<FVector> Vertices;
        for(FVector P:{FVector(-Size,-Size,Z),FVector(Size,-Size,Z),FVector(Size,Size,Z),FVector(-Size,Size,Z)})Vertices.Add(VW::Position(P));
        Inside->CreateMeshSection_LinearColor(S,Vertices,{0,1,2,0,2,3},{},{},{},{},false);Inside->SetMaterial(S,UMaterialInstanceDynamic::Create(Base,R));
    }
    TArray<FProcMeshSection> Outside;VWPartitionCadWindow(Inside,FTransform::Identity,FVector(0,0,1),FVector::ZeroVector,.019,Outside);
    TestTrue(TEXT("Wholly central first material contributes no opaque rim fragments"),Outside[0].ProcIndexBuffer.IsEmpty());
    TestTrue(TEXT("Second material retains its rim despite compacted Other sections"),Outside[1].ProcIndexBuffer.Num()>0);
    for(const auto& V:Outside[1].ProcVertexBuffer)TestTrue(TEXT("Opaque second-slot vertices keep original CAD plane"),FMath::IsNearlyEqual(VW::SourcePosition(V.Position).Z,.001,1e-7));
    World->DestroyWorld(false);return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldInspectionPointerTest,"VirtualWorld.CadJoint.InspectionPointerRouting",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldInspectionPointerTest::RunTest(const FString& Parameters)
{
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);auto* R=World->SpawnActor<AVirtualWorldRuntime>();R->CameraOffset=FVector(20,0,0);R->CameraUp=FVector::UpVector;R->CameraTarget=FVector::ZeroVector;
    const FVector Offset=R->CameraOffset;
    R->UpdateInspectionPointer(FVector2D(100,100),true,FVector2D(100,50),true,false,0,1000,800);
    TestTrue(TEXT("Dragging from panel cannot orbit"),R->CameraOffset.Equals(Offset));
    R->UpdateInspectionPointer(FVector2D(600,100),true,FVector2D(100,50),true,false,0,1000,800);
    TestTrue(TEXT("Panel drag crossing viewport stays in panel until release"),!R->bPointerOrbit&&R->CameraOffset.Equals(Offset));
    R->UpdateInspectionPointer(FVector2D(600,100),true,FVector2D(100,50),false,false,0,1000,800);
    R->UpdateInspectionPointer(FVector2D(600,100),true,FVector2D(100,50),true,false,0,1000,800);
    TestTrue(TEXT("First drag event has no camera jump"),R->CameraOffset.Equals(Offset));
    R->UpdateInspectionPointer(FVector2D(620,110),true,FVector2D::ZeroVector,true,false,0,1000,800);
    TestFalse(TEXT("Visible-cursor position fallback orbits without raw deltas"),R->CameraOffset.Equals(Offset));TestTrue(TEXT("Orbit preserves distance"),FMath::IsNearlyEqual(R->CameraOffset.Size(),20.,1e-8));
    R->UpdateInspectionPointer(FVector2D(620,110),true,FVector2D::ZeroVector,false,false,0,1000,800);
    R->UpdateInspectionPointer(FVector2D(620,110),true,FVector2D::ZeroVector,false,true,0,1000,800);const FVector BeforePan=R->CameraOffset;
    R->UpdateInspectionPointer(FVector2D(630,120),true,FVector2D(10,10),false,true,0,1000,800);
    TestFalse(TEXT("Middle drag pans target"),R->CameraTarget.IsNearlyZero());TestTrue(TEXT("Pan does not orbit"),R->CameraOffset.Equals(BeforePan));
    R->UpdateInspectionPointer(FVector2D(100,100),true,FVector2D::ZeroVector,false,false,2,480,800);
    TestTrue(TEXT("Panel wheel stays in HUD"),R->PendingPanelWheel==2&&R->CameraOffset.Equals(BeforePan));
    R->UpdateInspectionPointer(FVector2D(250,100),true,FVector2D::ZeroVector,false,false,1,480,800);
    TestTrue(TEXT("Narrow viewport uses actual panel edge rather than fixed460"),R->CameraOffset.Size()<BeforePan.Size());
    for(bool Pan:{false,true})
    {
        auto* Raw=World->SpawnActor<AVirtualWorldRuntime>();auto* Absolute=World->SpawnActor<AVirtualWorldRuntime>();
        for(auto* Runtime:{Raw,Absolute})
        {
            Runtime->CameraOffset=FVector(20,0,0);Runtime->CameraUp=FVector::UpVector;Runtime->CameraTarget=FVector::ZeroVector;
            Runtime->UpdateInspectionPointer(FVector2D(600,100),true,FVector2D::ZeroVector,!Pan,Pan,0,1000,800);
        }
        Raw->UpdateInspectionPointer(FVector2D(620,110),true,FVector2D(20,-10),!Pan,Pan,0,1000,800);
        Absolute->UpdateInspectionPointer(FVector2D(620,110),true,FVector2D::ZeroVector,!Pan,Pan,0,1000,800);
        TestTrue(TEXT("Equivalent raw and screen-position input has the same orbit direction"),Raw->CameraOffset.Equals(Absolute->CameraOffset,1e-8)&&Raw->CameraUp.Equals(Absolute->CameraUp,1e-8));
        TestTrue(TEXT("Equivalent raw and screen-position input has the same pan direction"),Raw->CameraTarget.Equals(Absolute->CameraTarget,1e-8));
    }
    World->DestroyWorld(false);return true;
}
#endif
