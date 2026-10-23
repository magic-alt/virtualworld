#if WITH_DEV_AUTOMATION_TESTS
#include "VirtualWorldRuntime.h"
#include "Misc/AutomationTest.h"
#include "VirtualWorldPointer.h"
#include "VirtualWorldImportState.h"
#include "VirtualWorldModel.h"
#include "EngineUtils.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "HAL/PlatformTime.h"
#include "Components/StaticMeshComponent.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldImportReplacementTest,"VirtualWorld.Import.NativeReplacement",EAutomationTestFlags::ClientContext|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldImportReplacementTest::RunTest(const FString& Parameters)
{
    FString Fixtures;
    if(!FParse::Value(FCommandLine::Get(),TEXT("VirtualWorldImportFixtures="),Fixtures))
    {AddWarning(TEXT("Native STEP replacement test requires -VirtualWorldImportFixtures=<converted fixture directory>."));return true;}
    AVirtualWorldRuntime* Runtime=nullptr;
    for(const auto& Context:GEngine->GetWorldContexts())
        if(Context.World()&&Context.World()->IsGameWorld())
            for(TActorIterator<AVirtualWorldRuntime> It(Context.World());It;++It) {Runtime=*It;break;}
    if(!TestNotNull(TEXT("Live native runtime exists"),Runtime)) return false;
    const int32 DefaultIndex=Runtime->SceneIndex;
    TestTrue(TEXT("Initial H-100 is a mechanism"),Runtime->IsMechanism());
    Runtime->StartStepImport(Fixtures/TEXT("cube/source/cube-mm.step"));
    TestTrue(TEXT("Real native converter process starts"),Runtime->ImportGeneration.bBusy);
    const double Deadline=FPlatformTime::Seconds()+95.;
    while(Runtime->ImportGeneration.bBusy&&FPlatformTime::Seconds()<Deadline)
    {Runtime->PollStepImport();FPlatformProcess::Sleep(.02f);}
    TestTrue(TEXT("Real cube conversion process commits"),Runtime->bImportedModule);
    TestEqual(TEXT("Cube is one module"),Runtime->Nodes.Num(),1);
    TestFalse(TEXT("Imported STEP has no H-100 mechanism"),Runtime->IsMechanism());
    TestTrue(TEXT("Imported STEP keeps module camera gestures"),Runtime->IsModuleViewer());
    TestFalse(TEXT("Static module has no H-100 Run action"),Runtime->Actions().ContainsByPredicate([](const FVirtualWorldAction& Action){return Action.Id==TEXT("run");}));
    if(!Runtime->Nodes.Contains(TEXT("module"))) return false;
    AVirtualWorldModel* Cube=Runtime->Nodes[TEXT("module")].Model;
    TestTrue(TEXT("10 mm cube is 1 native centimetre"),FMath::Abs(Cube->GetComponentsBoundingBox(true).GetSize().X-1.)<.001);
    const int32 ActorsBefore=Runtime->SpawnedActors.Num();
    TestFalse(TEXT("Missing import cannot commit"),Runtime->CommitStepImport(Fixtures/TEXT("missing")));
    TestTrue(TEXT("Failed import preserves exact current model"),Runtime->Nodes[TEXT("module")].Model==Cube);
    TestEqual(TEXT("Failed import does not leak scene actors"),Runtime->SpawnedActors.Num(),ActorsBefore);
    TestFalse(TEXT("Empty GLB is rejected by actual native geometry loading"),Runtime->CommitStepImport(Fixtures/TEXT("empty")));
    TestTrue(TEXT("Native load failure preserves original actor and nonfatal state"),Runtime->Nodes[TEXT("module")].Model==Cube&&Runtime->FatalError.IsEmpty());
    TestEqual(TEXT("Candidate actor released after native failure"),Runtime->SpawnedActors.Num(),ActorsBefore);
    TestTrue(TEXT("Assembly replaces cube"),Runtime->CommitStepImport(Fixtures/TEXT("assembly")));
    TestEqual(TEXT("Assembly remains one module"),Runtime->Nodes.Num(),1);
    TArray<UStaticMeshComponent*> Parts;Runtime->Nodes[TEXT("module")].Model->GetComponents<UStaticMeshComponent>(Parts);
    TestTrue(TEXT("Native assembly retains multiple actual mesh parts"),Parts.Num()>1);
    TestFalse(TEXT("Old cube has been destroyed"),IsValid(Cube));
    Runtime->Command(TEXT("scene:")+Runtime->SceneOrder[DefaultIndex]);
    TestTrue(TEXT("Scene navigation remains available from a static import"),Runtime->IsMechanism());
    TestTrue(TEXT("A new assembly may replace restored default"),Runtime->CommitStepImport(Fixtures/TEXT("assembly")));
    Runtime->Command(TEXT("restore-module"));
    TestEqual(TEXT("Restored original scene index"),Runtime->SceneIndex,DefaultIndex);
    TestTrue(TEXT("Default mechanism controls restored"),Runtime->IsMechanism());
    TestFalse(TEXT("Restore leaves no import in progress"),Runtime->ImportGeneration.bBusy);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldImportGenerationTest,"VirtualWorld.Import.CancelAndSceneIdentity",EAutomationTestFlags::EditorContext|EAutomationTestFlags::ClientContext|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldImportGenerationTest::RunTest(const FString& Parameters)
{
    VW::FImportGeneration State;
    const uint64 A=State.Begin(TEXT("joint"));
    TestTrue(TEXT("Current import may commit"),State.CanCommit(A,TEXT("joint")));
    TestFalse(TEXT("Another scene may never receive an import"),State.CanCommit(A,TEXT("prince")));
    State.Cancel();
    TestFalse(TEXT("Cancelled result cannot commit"),State.CanCommit(A,TEXT("joint")));
    const uint64 B=State.Begin(TEXT("joint"));
    TestFalse(TEXT("Older import cannot replace newer work"),State.CanCommit(A,TEXT("joint")));
    TestTrue(TEXT("Newest import may commit"),State.CanCommit(B,TEXT("joint")));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCoordinateTest,"VirtualWorld.Coordinates.MatchPinnedImporter",(EAutomationTestFlags::EditorContext|EAutomationTestFlags::ClientContext|EAutomationTestFlags::ServerContext|EAutomationTestFlags::CommandletContext|EAutomationTestFlags::ProgramContext)|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldCoordinateTest::RunTest(const FString& Parameters)
{
    const FVector Point(.13,-.2,.45),Position(2,3,-4),Scale(1.2,.8,2.1);
    const FQuat Rotation=VW::EulerXYZ(FVector(.3,-.9,.2));
    const FTransform Source(Rotation,Position,Scale);
    const FVector Expected=VW::Position(Source.TransformPosition(Point));
    const FVector Actual=VW::Transform(Position,Rotation,Scale).TransformPosition(VW::Position(Point));
    TestTrue(TEXT("Geometry and wrapper transformations commute with the importer's basis exactly once"),Actual.Equals(Expected,.0001));
    TestTrue(TEXT("Metres/native conversion round trip"),VW::SourcePosition(VW::Position(Point)).Equals(Point,.000001));
    TestTrue(TEXT("One source metre is 100 native centimetres"),FMath::Abs(VW::Position(FVector(0,1,0)).Size()-100)<.0001);
    TestTrue(TEXT("Authored character +Z faces the native movement +X"),VW::CharacterFacing().RotateVector(VW::Position(FVector(0,0,1)).GetSafeNormal()).Equals(FVector::ForwardVector,.000001));
    TestTrue(TEXT("Character facing correction preserves up"),VW::CharacterFacing().RotateVector(VW::Position(FVector(0,1,0)).GetSafeNormal()).Equals(FVector::UpVector,.000001));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldTransmissionTest,"VirtualWorld.Harmonic.SignedPhase",(EAutomationTestFlags::EditorContext|EAutomationTestFlags::ClientContext|EAutomationTestFlags::ServerContext|EAutomationTestFlags::CommandletContext|EAutomationTestFlags::ProgramContext)|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldTransmissionTest::RunTest(const FString& Parameters)
{
    const auto Zero=VW::Transmission(0,200,202),State=VW::Transmission(1.75/1.01,200,202);
    TestTrue(TEXT("200/202 teeth produce -0.01 transmission"),FMath::Abs(Zero.Ratio+.01)<1e-9);
    TestTrue(TEXT("Output rotates opposite input"),State.Output<0);
    TestTrue(TEXT("Both named morph amplitudes may be negative"),State.Cos<0&&State.Sin<0);
    TestTrue(TEXT("Harmonic phase amplitude stays one"),FMath::Abs(State.Cos*State.Cos+State.Sin*State.Sin-1)<.0001);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldProgressTest,"VirtualWorld.Story.ValidateSavedPrerequisites",(EAutomationTestFlags::EditorContext|EAutomationTestFlags::ClientContext|EAutomationTestFlags::ServerContext|EAutomationTestFlags::CommandletContext|EAutomationTestFlags::ProgramContext)|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldProgressTest::RunTest(const FString& Parameters)
{
    VW::Json Source,Saved;
    VW::Parse(TEXT(R"({"nodes":[{"interaction":{"gives":"a"}},{"interaction":{"requires":["a"],"gives":"b","completes":true}}]})"),Source);
    const AVirtualWorldRuntime* Runtime=GetDefault<AVirtualWorldRuntime>();
    VW::Parse(TEXT(R"({"flags":["b"],"completed":true})"),Saved);
    const auto Locked=Runtime->ValidatedProgress(Source,Saved);
    TestTrue(TEXT("A later flag cannot bypass an absent prerequisite"),Locked.Flags.IsEmpty()&&!Locked.bCompleted);
    VW::Parse(TEXT(R"({"flags":["a","b"],"completed":true})"),Saved);
    const auto Valid=Runtime->ValidatedProgress(Source,Saved);
    TestTrue(TEXT("Reachable completed progress survives"),Valid.Flags.Num()==2&&Valid.bCompleted);
    VW::Parse(TEXT(R"({"flags":["unknown"],"completed":true})"),Saved);
    TestTrue(TEXT("Unknown saved flags are rejected"),Runtime->ValidatedProgress(Source,Saved).Flags.IsEmpty());
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldEntryTest,"VirtualWorld.Campaign.ExplicitEntryAndLaterGates",(EAutomationTestFlags::EditorContext|EAutomationTestFlags::ClientContext|EAutomationTestFlags::ServerContext|EAutomationTestFlags::CommandletContext|EAutomationTestFlags::ProgramContext)|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldEntryTest::RunTest(const FString& Parameters)
{
    VW::Json Campaign;VW::Parse(TEXT(R"({"chapters":[{"id":"desert"},{"id":"b612","requires":["desert"]},{"id":"earth","requires":["b612"]}]})"),Campaign);
    TSet<FString> Completed;
    TestFalse(TEXT("Default desert entry gates B612"),VW::ChapterUnlocked(Campaign,TEXT("b612"),Completed,TEXT("desert")));
    TestTrue(TEXT("Explicit B612 entry works on a clean save"),VW::ChapterUnlocked(Campaign,TEXT("b612"),Completed,TEXT("b612")));
    TestTrue(TEXT("Explicit Earth entry works on a clean save"),VW::ChapterUnlocked(Campaign,TEXT("earth"),Completed,TEXT("earth")));
    TestFalse(TEXT("Starting B612 does not pre-complete it for Earth"),VW::ChapterUnlocked(Campaign,TEXT("earth"),Completed,TEXT("b612")));
    Completed.Add(TEXT("b612"));
    TestTrue(TEXT("Completing the explicit entry unlocks its next chapter"),VW::ChapterUnlocked(Campaign,TEXT("earth"),Completed,TEXT("b612")));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldJumpTest,"VirtualWorld.Player.JumpAndAirborneGravity",(EAutomationTestFlags::EditorContext|EAutomationTestFlags::ClientContext|EAutomationTestFlags::ServerContext|EAutomationTestFlags::CommandletContext|EAutomationTestFlags::ProgramContext)|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldJumpTest::RunTest(const FString& Parameters)
{
    const auto Jump=VW::StepVerticalMotion(0,true,true,.02);
    TestTrue(TEXT("A grounded jump starts with 5.2 metres per second and gravity acts immediately"),FMath::Abs(Jump.Speed-492.)<.000001&&FMath::Abs(Jump.Distance-10.12)<.000001);
    const auto Airborne=VW::StepVerticalMotion(Jump.Speed,false,true,.02);
    TestTrue(TEXT("A second jump press while airborne cannot replenish upward speed"),Airborne.Speed<Jump.Speed&&FMath::Abs(Airborne.Speed-464.)<.000001);
    const auto Landed=VW::StepVerticalMotion(-800,true,true,.02);
    TestTrue(TEXT("Landing permits a new jump independent of the previous fall speed"),FMath::Abs(Landed.Speed-Jump.Speed)<.000001);
    double Height=0,Speed=0;
    for(int32 I=0;I<10;++I)
    {
        const auto Step=VW::StepVerticalMotion(Speed,I==0,I==0,.02);
        Height+=Step.Distance;Speed=Step.Speed;
    }
    TestTrue(TEXT("Ballistic integration matches a 0.2 second jump under 14 metres per second squared"),FMath::Abs(Height-76.)<.000001&&FMath::Abs(Speed-240.)<.000001);
    const auto Stopped=VW::StepVerticalMotion(Speed,false,false,0);
    TestTrue(TEXT("A zero-duration step preserves motion"),Stopped.Distance==0&&Stopped.Speed==Speed);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldPlayerBoundsTest,"VirtualWorld.Player.BoundsPreserveAltitude",(EAutomationTestFlags::EditorContext|EAutomationTestFlags::ClientContext|EAutomationTestFlags::ServerContext|EAutomationTestFlags::CommandletContext|EAutomationTestFlags::ProgramContext)|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldPlayerBoundsTest::RunTest(const FString& Parameters)
{
    VW::Json Bounds;VW::Parse(TEXT(R"({"min":[-2,-3],"max":[2,3]})"),Bounds);
    const FVector Clamped=VW::SourcePosition(VW::ConstrainPlanePosition(VW::Position(FVector(8,1.25,-9)),Bounds,25.));
    TestTrue(TEXT("Capsule clearance constrains both horizontal bounds"),FMath::Abs(Clamped.X-1.75)<.000001&&FMath::Abs(Clamped.Z+2.75)<.000001);
    TestTrue(TEXT("Bounds do not cancel a jump or falling altitude"),FMath::Abs(Clamped.Y-1.25)<.000001);
    VW::Parse(TEXT(R"({"min":[-0.1,-0.1],"max":[0.1,0.1]})"),Bounds);
    const FVector Narrow=VW::SourcePosition(VW::ConstrainPlanePosition(VW::Position(FVector(8,-2,-9)),Bounds,25.));
    TestTrue(TEXT("An interval narrower than the capsule resolves to its centre"),FMath::Abs(Narrow.X)<.000001&&FMath::Abs(Narrow.Z)<.000001&&FMath::Abs(Narrow.Y+2)<.000001);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldRadialMotionTest,"VirtualWorld.Player.SphericalMotionPreservesAltitude",(EAutomationTestFlags::EditorContext|EAutomationTestFlags::ClientContext|EAutomationTestFlags::ServerContext|EAutomationTestFlags::CommandletContext|EAutomationTestFlags::ProgramContext)|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldRadialMotionTest::RunTest(const FString& Parameters)
{
    const FVector Centre(130,-280,70),Feet=Centre+FVector::UpVector*640.;
    const FVector Next=VW::SphericalPlayerStep(Feet,Centre,FVector::ForwardVector*12.,10.);
    TestTrue(TEXT("Tangent movement preserves existing airborne height and adds radial jump displacement"),FMath::Abs(FVector::Dist(Next,Centre)-650.)<.000001);
    const FVector Up=(Next-Centre).GetSafeNormal();
    TestTrue(TEXT("The radial frame moves with the player"),Up.X>0&&FMath::Abs(Up.SizeSquared()-1)<.000001);
    const FVector Side=Centre+FVector::ForwardVector*600.;
    const FVector SideJump=VW::SphericalPlayerStep(Side,Centre,FVector::UpVector*12.,10.);
    TestTrue(TEXT("Jump displacement uses local radial up away from the north pole"),FMath::Abs(FVector::Dist(SideJump,Centre)-610.)<.000001&&SideJump.Z>Centre.Z);
    return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldPointerGestureTest,"VirtualWorld.Input.MouseGestureBoundaries",EAutomationTestFlags::EditorContext|EAutomationTestFlags::ClientContext|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldPointerGestureTest::RunTest(const FString& Parameters)
{
    const FVector Pan=VW::PointerPan(FVector(-100,0,0),FVector::UpVector,FVector2D(50,25),1000,90.);
    TestTrue(TEXT("Horizontal FOV and width map 50 pixels to ten world units"),Pan.Equals(FVector(0,-10,5),.000001));
    const FVector TiltedPan=VW::PointerPan(FVector(-100,0,0),FVector(1,0,1),FVector2D(50,25),1000,90.);
    TestTrue(TEXT("Pan uses camera-plane up instead of changing view depth"),TiltedPan.Equals(FVector(0,-10,5),.000001));
    VW::FPointerDrag Drag;
    const auto Move=[&](double X,double Y,bool InView,bool Orbit,bool Pan,bool Focus=true,bool HasPosition=true)
    {return Drag.Update(FVector2D(X,Y),HasPosition,Focus,InView,Orbit,Pan);};
    TestTrue(TEXT("A HUD press produces no orbit"),Move(100,100,false,true,false).IsNearlyZero());
    TestTrue(TEXT("Crossing out of HUD while holding cannot start orbit"),Move(600,100,true,true,false).IsNearlyZero()&&Drag.Mode==0);
    Move(600,100,true,false,false);
    TestTrue(TEXT("A fresh viewport press establishes its origin"),Move(600,100,true,true,false).IsNearlyZero());
    TestTrue(TEXT("Visible-cursor movement yields actual pixel delta"),Move(624,112,true,true,false).Equals(FVector2D(24,12))&&Drag.Mode==1);
    TestTrue(TEXT("Dragging across panel stays in the existing gesture"),Move(424,112,false,true,false).Equals(FVector2D(-200,0)));
    TestTrue(TEXT("Release stops the camera"),Move(430,114,false,false,false).IsNearlyZero()&&Drag.Mode==0);
    Move(600,100,true,true,false);
    TestTrue(TEXT("Focus loss cancels a held drag"),Move(900,500,true,true,false,false).IsNearlyZero()&&Drag.Mode==0);
    TestTrue(TEXT("Refocus cannot reuse an old cursor origin"),Move(1000,600,true,true,false).IsNearlyZero());
    TestTrue(TEXT("Switching to pan does not jump"),Move(1050,640,true,false,true).IsNearlyZero()&&Drag.Mode==2);
    TestTrue(TEXT("Middle drag has its own displacement"),Move(1060,635,true,false,true).Equals(FVector2D(10,-5)));
    TestTrue(TEXT("Leaving the viewport cancels stale mouse position"),Move(0,0,true,false,true,true,false).IsNearlyZero()&&Drag.Mode==0);
    return true;
}

#endif
