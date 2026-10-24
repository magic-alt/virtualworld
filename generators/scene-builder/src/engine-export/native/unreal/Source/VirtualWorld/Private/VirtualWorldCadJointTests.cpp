#if WITH_DEV_AUTOMATION_TESTS
#include "VirtualWorldRuntime.h"
#include "VirtualWorldModel.h"
#include "Components/PrimitiveComponent.h"
#include "Components/StaticMeshComponent.h"
#include "ProceduralMeshComponent.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/PlayerController.h"
#include "EngineUtils.h"
#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/CoreDelegates.h"
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

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCadJointSuspensionTest,"VirtualWorld.CadJoint.SuspensionFreezesClock",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldCadJointSuspensionTest::RunTest(const FString& Parameters)
{
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);if(!TestNotNull(TEXT("Clock test world"),World))return false;
    auto* R=World->SpawnActor<AVirtualWorldRuntime>();R->JointDynamics=MakeUnique<VWJoint::Dynamics>();R->JointDynamics->start();R->bRunning=true;R->JointClockFocusOverride=1;R->BindJointClockLifecycle();
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
    const TSharedPtr<VWJoint::Dynamics> Saved=MakeShared<VWJoint::Dynamics>(*R->JointDynamics);const FVector SavedTarget=R->CameraTarget,SavedOffset=R->CameraOffset,SavedUp=R->CameraUp;const float SavedRpm=R->Rpm;
    const bool Paused=R->bPaused,Markers=R->bRollingMarkers,Section=R->bSection,Principle=R->bPrinciple;const double Offset=R->KinematicOffset;
    R->bPaused=true;R->bRollingMarkers=true;R->bSection=true;R->bPrinciple=true;R->KinematicOffset=0;R->JointDynamics->reset();R->JointDynamics->setRpm(30);R->Rpm=30;R->JointDynamics->start();
    const FString Directory=FPaths::ProjectSavedDir()/TEXT("Automation/CadJointMotion");IFileManager::Get().MakeDirectory(*Directory,true);
    AddCommand(new FDelayedFunctionLatentCommand([this,R](){R->ApplyMechanism();R->ApplyVisibility();R->FrameCadInspection();R->UpdateCamera();},.1f));
    AddCommand(new FDelayedFunctionLatentCommand([this,R](){
        auto* PC=R->GetWorld()->GetFirstPlayerController();int32 Width=0,Height=0;if(PC)PC->GetViewportSize(Width,Height);TestTrue(TEXT("Renderable viewport exists"),PC&&Width>0&&Height>0);
        const auto ProjectBounds=[this,PC,Width,Height](const FBox& Bounds){for(int I=0;I<8;++I){const FVector Point((I&1)?Bounds.Max.X:Bounds.Min.X,(I&2)?Bounds.Max.Y:Bounds.Min.Y,(I&4)?Bounds.Max.Z:Bounds.Min.Z);FVector2D Pixel;TestTrue(TEXT("Actual and principle bounds fit usable viewport outside HUD"),PC&&PC->ProjectWorldLocationToScreen(Point,Pixel)&&Pixel.X>FMath::Min(450.,Width*.48)&&Pixel.X<Width&&Pixel.Y>0&&Pixel.Y<Height);}};
        for(const auto& Entry:R->CadBindings)ProjectBounds(Entry.Component->Bounds.GetBox());if(R->PrincipleMesh)ProjectBounds(R->PrincipleMesh->Bounds.GetBox());
    },.1f));
    const auto Stage=[this,R,Directory](FString Name,double Dt,int Power)
    {
        AddCommand(new FDelayedFunctionLatentCommand([this,R,Directory,Name,Dt,Power]()
        {
            if(Power>=0)R->JointDynamics->setPowered(Power==1);R->JointDynamics->tick(Dt);R->ApplyMechanism();R->ApplyVisibility();
            const auto State=R->JointDynamics->snapshot();const VW::Json Report=MakeShared<FJsonObject>();Report->SetStringField(TEXT("stage"),Name);Report->SetStringField(TEXT("brakePhase"),UTF8_TO_TCHAR(State.brakePhase));Report->SetNumberField(TEXT("angle"),State.angle);Report->SetNumberField(TEXT("omega"),State.omega);Report->SetNumberField(TEXT("time"),State.time);Report->SetNumberField(TEXT("closure"),State.closure);Report->SetNumberField(TEXT("energy"),State.dissipatedEnergy);Report->SetNumberField(TEXT("principleSampledGap"),R->PrincipleMinGap);
            TArray<TSharedPtr<FJsonValue>> Readbacks;int32 Balls=0;
            for(const auto& Entry:R->CadBindings)
            {
                const auto B=Entry.Data;const FString Role=VW::String(B,TEXT("role"));const auto Actual=Entry.Component->GetComponentTransform().GetRelativeTransform(R->CadModelRoot->GetComponentTransform());
                TestTrue(Name+TEXT(" original scale"),Actual.GetScale3D().Equals(Entry.Original.GetScale3D(),1e-8));
                TestEqual(Name+TEXT(" section affects only documented components"),Entry.Component->IsVisible(),!VW::Bool(B,TEXT("inspectionHidden")));
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
            TestTrue(TEXT("Actual imported balls were read"),Balls>0);TestTrue(TEXT("Principle sampled gap finite and nonnegative"),FMath::IsFinite(R->PrincipleMinGap)&&R->PrincipleMinGap>=-1e-10);
            if(TestNotNull(TEXT("Actual principle procedural component"),R->PrincipleMesh))
            {
                const auto* Flex=R->PrincipleMesh->GetProcMeshSection(0);const auto* Ring=R->PrincipleMesh->GetProcMeshSection(1);
                TestTrue(TEXT("Actual closed gear strips contain vertices and triangles"),Flex&&Ring&&Flex->ProcVertexBuffer.Num()>=1536&&Flex->ProcIndexBuffer.Num()>=1536&&Ring->ProcVertexBuffer.Num()>=1536);
                const VW::Json Layer=MakeShared<FJsonObject>();Layer->SetNumberField(TEXT("flexVertices"),Flex?Flex->ProcVertexBuffer.Num():0);Layer->SetNumberField(TEXT("ringVertices"),Ring?Ring->ProcVertexBuffer.Num():0);
                if(R->PrincipleArmature){const FVector Actual=R->PrincipleArmature->GetRelativeLocation();const auto P=VW::Object(R->Mechanism,TEXT("principle"));const FVector Expected=VW::Position(FVector(0,-VW::Number(P,TEXT("radius"))*1.7,State.closure*R->JointDynamics->config.armatureTravel));TestTrue(TEXT("Illustrative armature actual transform follows closure"),Actual.Equals(Expected,1e-8));Layer->SetArrayField(TEXT("armatureTranslationCm"),{MakeShared<FJsonValueNumber>(Actual.X),MakeShared<FJsonValueNumber>(Actual.Y),MakeShared<FJsonValueNumber>(Actual.Z)});}
                Report->SetObjectField(TEXT("principleReadback"),Layer);
            }
            Report->SetArrayField(TEXT("components"),Readbacks);FFileHelper::SaveStringToFile(VW::Serialize(Report),*(Directory/(Name+TEXT(".json"))));
        },.1f));
        AddCommand(new FDelayedFunctionLatentCommand([Directory,Name](){FScreenshotRequest::RequestScreenshot(Directory/(Name+TEXT(".png")),false,false);},.3f));AddCommand(new FDelayedFunctionLatentCommand([](){},.3f));
    };
    Stage(TEXT("phase-a-released"),.2,-1);Stage(TEXT("phase-b-released"),.13,-1);Stage(TEXT("brake-delay"),.0125,0);Stage(TEXT("brake-engaging"),.025,-1);Stage(TEXT("brake-holding"),.1,-1);Stage(TEXT("brake-release-delay"),.01,1);Stage(TEXT("brake-releasing"),.025,-1);Stage(TEXT("brake-released-no-autostart"),.1,-1);
    AddCommand(new FDelayedFunctionLatentCommand([R](){R->CameraOffset=VW::Position(FVector(0,0,1)).GetSafeNormal()*R->CameraOffset.Size();R->CameraUp=VW::Position(FVector(0,1,0)).GetSafeNormal();R->FrameCadInspection(true);R->UpdateCamera();},.1f));
    AddCommand(new FDelayedFunctionLatentCommand([Directory](){FScreenshotRequest::RequestScreenshot(Directory/TEXT("principle-closeup.png"),false,false);},.3f));AddCommand(new FDelayedFunctionLatentCommand([](){},.3f));
    AddCommand(new FDelayedFunctionLatentCommand([R,Saved,Paused,Markers,Section,Principle,Offset,SavedTarget,SavedOffset,SavedUp,SavedRpm](){R->JointDynamics=MakeUnique<VWJoint::Dynamics>(*Saved);R->bPaused=Paused;R->bRollingMarkers=Markers;R->bSection=Section;R->bPrinciple=Principle;R->KinematicOffset=Offset;R->Rpm=SavedRpm;R->CameraTarget=SavedTarget;R->CameraOffset=SavedOffset;R->CameraUp=SavedUp;R->UpdateCamera();R->bRunning=Saved->snapshot().running;R->ApplyMechanism();R->ApplyVisibility();},.1f));return true;
}
#endif
