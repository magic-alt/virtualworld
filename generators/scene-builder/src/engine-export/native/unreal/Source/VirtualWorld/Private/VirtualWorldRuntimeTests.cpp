#if WITH_DEV_AUTOMATION_TESTS
#include "VirtualWorldRuntime.h"
#include "Misc/AutomationTest.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldCoordinateTest,"VirtualWorld.Coordinates.MatchPinnedImporter",EAutomationTestFlags::ApplicationContextMask|EAutomationTestFlags::EngineFilter)
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

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldTransmissionTest,"VirtualWorld.Harmonic.SignedPhase",EAutomationTestFlags::ApplicationContextMask|EAutomationTestFlags::EngineFilter)
bool FVirtualWorldTransmissionTest::RunTest(const FString& Parameters)
{
    const auto Zero=VW::Transmission(0,200,202),State=VW::Transmission(1.75/1.01,200,202);
    TestTrue(TEXT("200/202 teeth produce -0.01 transmission"),FMath::Abs(Zero.Ratio+.01)<1e-9);
    TestTrue(TEXT("Output rotates opposite input"),State.Output<0);
    TestTrue(TEXT("Both named morph amplitudes may be negative"),State.Cos<0&&State.Sin<0);
    TestTrue(TEXT("Harmonic phase amplitude stays one"),FMath::Abs(State.Cos*State.Cos+State.Sin*State.Sin-1)<.0001);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldProgressTest,"VirtualWorld.Story.ValidateSavedPrerequisites",EAutomationTestFlags::ApplicationContextMask|EAutomationTestFlags::EngineFilter)
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

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FVirtualWorldEntryTest,"VirtualWorld.Campaign.ExplicitEntryAndLaterGates",EAutomationTestFlags::ApplicationContextMask|EAutomationTestFlags::EngineFilter)
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
#endif
