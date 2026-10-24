#if WITH_DEV_AUTOMATION_TESTS
#include "VirtualWorldRuntime.h"
#include "Misc/AutomationTest.h"
#include "Engine/World.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"
#include "UnrealClient.h"
#include "Misc/Paths.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCoordinateTest,"VirtualWorld.Coordinates.MatchPinnedImporter",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
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

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldTransmissionTest,"VirtualWorld.Harmonic.SignedPhase",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldTransmissionTest::RunTest(const FString& Parameters)
{
    const auto Zero=VW::Transmission(0,200,202),State=VW::Transmission(1.75/1.01,200,202);
    TestTrue(TEXT("200/202 teeth produce -0.01 transmission"),FMath::Abs(Zero.Ratio+.01)<1e-9);
    TestTrue(TEXT("Output rotates opposite input"),State.Output<0);
    TestTrue(TEXT("Both named morph amplitudes may be negative"),State.Cos<0&&State.Sin<0);
    TestTrue(TEXT("Harmonic phase amplitude stays one"),FMath::Abs(State.Cos*State.Cos+State.Sin*State.Sin-1)<.0001);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldProgressTest,"VirtualWorld.Story.ValidateSavedPrerequisites",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
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

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldEntryTest,"VirtualWorld.Campaign.ExplicitEntryAndLaterGates",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
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
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldMechanismTimingTest,"VirtualWorld.Harmonic.ElapsedTimeAndActualSpeed",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldMechanismTimingTest::RunTest(const FString& Parameters)
{
    UWorld* World=UWorld::CreateWorld(EWorldType::Game,false);
    if(!TestNotNull(TEXT("Test world"),World)) return false;
    AVirtualWorldRuntime* Runtime=World->SpawnActor<AVirtualWorldRuntime>();
    VW::Parse(TEXT(R"({"kind":"harmonic","flexTeeth":200,"ringTeeth":202})"),Runtime->Mechanism);
    Runtime->Metadata=MakeShared<FJsonObject>();Runtime->Rpm=6;
    for(const int32 Fps:{60,20,10,5})
    {
        Runtime->InputAngle=0;Runtime->bRunning=true;
        for(int32 Frame=0;Frame<10*Fps;++Frame) Runtime->Tick(1.f/Fps);
        TestTrue(FString::Printf(TEXT("One input turn in ten seconds at %d FPS"),Fps),FMath::Abs(Runtime->InputAngle-2*PI)<.00001);
    }
    const auto Speed=[Runtime](){return Runtime->StatusLines().FilterByPredicate([](const FString& Line){return Line.StartsWith(TEXT("Input "));});};
    Runtime->bRunning=false;
    TestTrue(TEXT("Stopped HUD reports zero actual speed"),Speed().Contains(TEXT("Input 0.0 rpm | Output 0.000 rpm | Ratio -0.0100")));
    Runtime->bRunning=true;Runtime->bPaused=true;
    const double Held=Runtime->InputAngle;Runtime->Tick(10.f);
    TestEqual(TEXT("Pause holds phase without catch-up"),Runtime->InputAngle,Held);
    TestTrue(TEXT("Paused HUD reports zero actual speed"),Speed().Contains(TEXT("Input 0.0 rpm | Output 0.000 rpm | Ratio -0.0100")));
    Runtime->bPaused=false;Runtime->bBrakeInstalled=true;Runtime->bBrakePowered=false;Runtime->Tick(.1f);
    TestEqual(TEXT("Ideal power-off brake holds phase"),Runtime->InputAngle,Held);
    TestTrue(TEXT("Locked HUD reports zero actual speed"),Speed().Contains(TEXT("Input 0.0 rpm | Output 0.000 rpm | Ratio -0.0100")));
    Runtime->bBrakePowered=true;Runtime->Rpm=-6;Runtime->Tick(.1f);
    TestTrue(TEXT("Released reverse input uses full elapsed time"),FMath::Abs(Runtime->InputAngle-Held+PI/50)<.000001);
    World->DestroyWorld(false);
    return true;
}
// Captures are render artifacts for visual inspection, not an image-quality assertion.
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldInspectionTest,"VirtualWorld.Harmonic.InspectionViews",EAutomationTestFlags_ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldInspectionTest::RunTest(const FString& Parameters)
{
    AVirtualWorldRuntime* Runtime=nullptr;
    for(const FWorldContext& Context:GEngine->GetWorldContexts())
        if(Context.World()&&Context.World()->IsGameWorld())
            for(TActorIterator<AVirtualWorldRuntime> It(Context.World());It;++It) if(VW::String(It->Mechanism,TEXT("kind"))==TEXT("harmonic")) Runtime=*It;
    if(!Runtime) {AddInfo(TEXT("No active harmonic scene; render capture skipped."));return true;}
    const FVector SavedOffset=Runtime->CameraOffset,SavedUp=Runtime->CameraUp;
    const bool SavedSection=Runtime->bSection,SavedRunning=Runtime->bRunning;
    Runtime->bRunning=false;
    const auto View=[this,Runtime](const FString& Name,FVector Offset,bool Section)
    {
        AddCommand(new FDelayedFunctionLatentCommand([Runtime,Offset,Section](){Runtime->CameraOffset=Offset;Runtime->CameraUp=FVector::UpVector;Runtime->bSection=Section;Runtime->ApplyVisibility();Runtime->UpdateCamera();},.1f));
        AddCommand(new FDelayedFunctionLatentCommand([Name](){FScreenshotRequest::RequestScreenshot(FPaths::ProjectSavedDir()/TEXT("Screenshots/JointInspection")/Name+TEXT(".png"),false,false);},1.f));
        AddCommand(new FDelayedFunctionLatentCommand([](){},.3f));
    };
    View(TEXT("full"),SavedOffset,false);
    AddCommand(new FDelayedFunctionLatentCommand([](){FScreenshotRequest::RequestScreenshot(FPaths::ProjectSavedDir()/TEXT("Screenshots/JointInspection/full-stable.png"),false,false);},5.f));
    AddCommand(new FDelayedFunctionLatentCommand([](){},.3f));
    View(TEXT("bottom"),FVector(.03,.03,-1).GetSafeNormal()*SavedOffset.Size(),false);
    View(TEXT("section"),FVector(1,1,.15).GetSafeNormal()*SavedOffset.Size(),true);
    View(TEXT("section-bottom"),FVector(1,1,-.8).GetSafeNormal()*SavedOffset.Size(),true);
    AddCommand(new FDelayedFunctionLatentCommand([Runtime,SavedOffset,SavedUp,SavedSection,SavedRunning](){Runtime->CameraOffset=SavedOffset;Runtime->CameraUp=SavedUp;Runtime->bSection=SavedSection;Runtime->bRunning=SavedRunning;Runtime->ApplyVisibility();Runtime->UpdateCamera();},.1f));
    return true;
}
#endif
