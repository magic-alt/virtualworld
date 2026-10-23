#include "VirtualWorldRuntime.h"
#include "VirtualWorldModel.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "Misc/App.h"
#include "Misc/EngineVersion.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformMisc.h"

void AVirtualWorldRuntime::RunSmokeStep()
{
    if(bSmokeFinished)return;
    if(!FatalError.IsEmpty()) {FinishSmoke();return;}
    if(++SmokeFrame<16)return; // Let native component/resource ticks run before checking the loaded scene.
    if(!FApp::CanEverRender()||!Camera) {Fail(TEXT("Native smoke requires a rendering-capable game world and camera."));FinishSmoke();return;}
    const VW::Json Result=MakeShared<FJsonObject>();
    Result->SetStringField(TEXT("sceneId"),SceneOrder[SceneIndex]);
    Result->SetNumberField(TEXT("nodeWrappers"),Nodes.Num());
    Result->SetNumberField(TEXT("nativeColliders"),ColliderCount);
    Result->SetNumberField(TEXT("playerInstances"),PlayerModel?1:0);
    const auto Require=[this](bool Condition,const FString& Message){if(!Condition)Fail(Message);return Condition;};
    if(PlayerModel)
    {
        const VW::Json Actor=VW::Object(Metadata,TEXT("actor"));
        const FString Preview=VW::String(Actor,TEXT("nodeId"));
        Require(Preview.IsEmpty()||!Nodes.FindChecked(Preview).Model,TEXT("Player preview geometry was duplicated."));
        const VW::Json Clips=VW::Object(Actor,TEXT("clips"));
        for(const TCHAR* State:{TEXT("idle"),TEXT("walk"),TEXT("interact")})
            Require(PlayerModel->HasSkeletalClip(VW::String(Clips,State))&&PlayerModel->PlayClip(VW::String(Clips,State)),TEXT("Native player clip binding failed: ")+VW::String(Clips,State));
        Require(ColliderCount>0,TEXT("Current playable showcase has no native collision."));
        const VW::Json Navigation=VW::Object(Metadata,TEXT("navigation"));
        if(VW::String(Navigation,TEXT("kind"))==TEXT("sphere"))
        {
            const FVector Center=VW::Position(VW::Vector(Navigation,TEXT("center")));
            Require(FMath::Abs(FVector::Dist(PlayerFeet,Center)-VW::Number(Navigation,TEXT("radius"))*100.)<.01,TEXT("Spherical player spawn is off its authored surface."));
        }
        FHitResult Ground;FCollisionQueryParams Params(SCENE_QUERY_STAT(VirtualWorldSmokeGround),true);Params.AddIgnoredActor(PlayerModel);
        Require(GetWorld()->LineTraceSingleByChannel(Ground,PlayerFeet+PlayerUp*200.,PlayerFeet-PlayerUp*300.,ECC_Pawn,Params),TEXT("Native collision query did not find the showcase surface."));
        // Exercise the exact movement function used by keyboard play against the imported world.
        // This is programmatic native coverage; real input, rendered animation and framing remain manual gates.
        const FVector SavedFeet=PlayerFeet,SavedUp=PlayerUp,SavedForward=PlayerForward,SavedGrounded=LastGroundedFeet;
        const FVector SavedCameraOffset=CameraOffset,SavedCameraUp=CameraUp;
        const double SavedVerticalSpeed=PlayerVerticalSpeed;const bool bSavedGrounded=bPlayerGrounded;
        for(int32 Frame=0;Frame<20;++Frame) StepPlayerMovement(FVector::ZeroVector,false,1.f/60.f);
        Require(bPlayerGrounded,TEXT("Player did not settle onto native collision before jumping."));
        const FVector JumpStart=PlayerFeet,JumpUp=PlayerUp;
        const bool bSphere=VW::String(Navigation,TEXT("kind"))==TEXT("sphere");
        const FVector Centre=VW::Position(VW::Vector(Navigation,TEXT("center")));
        const double StartRadius=FVector::Dist(JumpStart,Centre);
        const auto Height=[&]() {return bSphere?FVector::Dist(PlayerFeet,Centre)-StartRadius:FVector::DotProduct(PlayerFeet-JumpStart,JumpUp);};
        StepPlayerMovement(FVector::ZeroVector,true,1.f/60.f);
        Require(PlayerVerticalSpeed>0&&!bPlayerGrounded&&Height()>0,TEXT("Grounded native jump did not leave the surface."));
        const double FirstSpeed=PlayerVerticalSpeed;
        StepPlayerMovement(FVector::ZeroVector,true,1.f/60.f);
        Require(PlayerVerticalSpeed<FirstSpeed,TEXT("An airborne jump press incorrectly replenished vertical speed."));
        double Peak=Height(),PreviousHeight=Peak;bool bFell=false,bLanded=false;
        for(int32 Frame=0;Frame<100;++Frame)
        {
            StepPlayerMovement(FVector::ZeroVector,false,1.f/60.f);
            const double CurrentHeight=Height();Peak=FMath::Max(Peak,CurrentHeight);
            bFell|=CurrentHeight<PreviousHeight-.01&&Peak>20.;PreviousHeight=CurrentHeight;
            if(Frame>8&&bPlayerGrounded) {bLanded=true;break;}
        }
        Require(Peak>70.&&Peak<120.,TEXT("Native jump apex is inconsistent with 5.2 m/s launch and 14 m/s^2 gravity."));
        Require(bFell&&bLanded&&FMath::Abs(PlayerVerticalSpeed)<.001,TEXT("Player did not fall and land with no movement input."));
        const FVector WalkStart=PlayerFeet,WalkDirection=PlayerForward;
        for(int32 Frame=0;Frame<30;++Frame) StepPlayerMovement(WalkDirection,false,1.f/60.f);
        Require(FVector::Dist(PlayerFeet,WalkStart)>20.,TEXT("Native capsule movement could not move away from the showcase spawn."));
        if(bSphere)
        {
            Require(PlayerUp.Equals((PlayerFeet-Centre).GetSafeNormal(),.00001)&&PlayerRoot->GetUpVector().Equals(PlayerUp,.00001),TEXT("Spherical locomotion lost the radial player frame."));
            Require(FVector::Dist(PlayerFeet,Centre)>=VW::Number(Navigation,TEXT("radius"))*100.-.1,TEXT("Spherical locomotion penetrated the navigation surface."));
        }
        else
        {
            const FVector Bounded=VW::ConstrainPlanePosition(PlayerFeet,VW::Object(Navigation,TEXT("bounds")),PlayerRadius+FMath::Max(1.,PlayerHeight*.01));
            Require(PlayerFeet.Equals(Bounded,.001),TEXT("Native locomotion escaped its planar capsule bounds."));
        }
        Result->SetBoolField(TEXT("playerMotionExercised"),FatalError.IsEmpty());
        Result->SetNumberField(TEXT("jumpPeakCentimetres"),Peak);
        PlayerFeet=SavedFeet;PlayerUp=SavedUp;PlayerForward=SavedForward;LastGroundedFeet=SavedGrounded;
        PlayerVerticalSpeed=SavedVerticalSpeed;bPlayerGrounded=bSavedGrounded;CameraOffset=SavedCameraOffset;CameraUp=SavedCameraUp;
        PlayerRoot->SetWorldLocationAndRotation(PlayerFeet,FRotationMatrix::MakeFromXZ(PlayerForward,PlayerUp).ToQuat());
        // Exercise actual authored prerequisite/flag/completion logic. Positioning here is a test fixture,
        // not evidence that the user walked to each task or that visual framing passed.
        FVirtualWorldProgress& State=Progress[SceneOrder[SceneIndex]];
        const auto PlaceNear=[this,&Navigation](const FVirtualWorldNode& Node)
        {
            PlayerFeet=Node.Wrapper->GetComponentLocation();
            if(VW::String(Navigation,TEXT("kind"))==TEXT("sphere"))
            {
                const FVector Center=VW::Position(VW::Vector(Navigation,TEXT("center")));
                PlayerUp=(PlayerFeet-Center).GetSafeNormal(SMALL_NUMBER,FVector::UpVector);
                PlayerFeet=Center+PlayerUp*VW::Number(Navigation,TEXT("radius"))*100.;
            }
            PlayerRoot->SetWorldLocation(PlayerFeet);
        };
        for(const auto& Pair:Nodes)
        {
            const VW::Json Interaction=VW::Object(Pair.Value.Metadata,TEXT("interaction"));
            if(Interaction&&!VW::Requires(Interaction,State.Flags))
            {
                PlaceNear(Pair.Value);const int32 Before=State.Flags.Num();
                Require(!Interact(Pair.Key)&&State.Flags.Num()==Before,TEXT("Locked native interaction granted progress."));
            }
        }
        TSet<FString> Visited;bool bChanged=true;
        while(bChanged)
        {
            bChanged=false;
            for(const auto& Pair:Nodes)
            {
                const VW::Json Interaction=VW::Object(Pair.Value.Metadata,TEXT("interaction"));
                if(!Interaction||Visited.Contains(Pair.Key)||!VW::Requires(Interaction,State.Flags))continue;
                PlaceNear(Pair.Value);
                Require(Interact(Pair.Key),TEXT("Reachable authored interaction failed: ")+Pair.Key);
                const auto Choices=VW::Array(Interaction,TEXT("choices"));
                if(!Choices.IsEmpty()) {Command(TEXT("choice:0"));Require(Dialogue==VW::String(Choices[0]->AsObject(),TEXT("text")),TEXT("Dialogue choice text was not applied."));}
                Visited.Add(Pair.Key);bChanged=true;
            }
        }
        for(const auto& Task:VW::Array(Metadata,TEXT("tasks"))) Require(State.Flags.Contains(VW::String(Task->AsObject(),TEXT("flag"))),TEXT("An authored task was unreachable."));
        bool bHasCompleter=false;for(const auto& Pair:Nodes)bHasCompleter|=VW::Bool(VW::Object(Pair.Value.Metadata,TEXT("interaction")),TEXT("completes"));
        Require(!bHasCompleter||State.bCompleted,TEXT("Authored chapter could not complete."));
        Result->SetBoolField(TEXT("storyBindingsExercised"),true);
    }
    if(Mechanism)
    {
        const VW::Harmonic Base=VW::Transmission(1,VW::Number(Mechanism,TEXT("flexTeeth")),VW::Number(Mechanism,TEXT("ringTeeth")));
        Require(Base.Output<0,TEXT("Harmonic output must reverse sign."));
        InputAngle=1.75/(1-Base.Ratio);ApplyMechanism();
        const FName Cos(*VW::String(Mechanism,TEXT("cosMorph"))),Sin(*VW::String(Mechanism,TEXT("sinMorph")));
        for(USkeletalMeshComponent* Skin:MorphComponents)
            Require(Skin->GetMorphTarget(Cos)<0&&Skin->GetMorphTarget(Sin)<0,TEXT("Native morph weights lost their signed phase."));
        if(bHasBrake)
        {
            bBrakeInstalled=true;bBrakePowered=false;bRunning=true;
            const double Before=InputAngle;StepMechanism(.5f);Command(TEXT("step"));
            Require(InputAngle==Before,TEXT("Power-off brake failed to hold angle."));
            Command(TEXT("brake-power"));Command(TEXT("run"));StepMechanism(.5f);
            Require(InputAngle!=Before,TEXT("Powered brake did not release input motion."));
        }
        bSection=true;ApplyVisibility();
        for(const auto& Id:VW::Array(Mechanism,TEXT("fullHousingIds")))
        {
            const FVirtualWorldNode& Node=Nodes[Id->AsString()];
            Require(!Node.bVisible,TEXT("Full housing was visible in section mode."));
            Require(!Node.Model||!Node.Model->GetActorEnableCollision(),TEXT("Hidden imported housing retained actor collision."));
        }
        bool bSectionShown=false;for(const auto& Id:VW::Array(Mechanism,TEXT("sectionHousingIds")))bSectionShown|=Nodes[Id->AsString()].bVisible;
        Require(bSectionShown,TEXT("Section geometry was not revealed."));
        Explosion=1;ApplyMechanism();
        for(const auto& Pair:Nodes)
        {
            const FVector Expected=VW::Position(VW::Vector(Pair.Value.Native,TEXT("translation"))+VW::Vector(Pair.Value.Metadata,TEXT("explode")));
            Require(Pair.Value.Wrapper->GetRelativeLocation().Equals(Expected,.001),TEXT("Explode offset lost the authored metre conversion."));
        }
        const auto Systems=VW::Array(Mechanism,TEXT("subsystems"));
        if(!Systems.IsEmpty())
        {
            const VW::Json System=Systems[0]->AsObject();Command(TEXT("hide:")+VW::String(System,TEXT("id")));
            for(const auto& Id:VW::Array(System,TEXT("nodeIds")))Require(!Nodes[Id->AsString()].bVisible,TEXT("Subsystem hide failed."));
        }
        Require(GNearClippingPlane<=.011f,TEXT("Near plane clips the metre-scale harmonic mechanism."));
        Result->SetNumberField(TEXT("signedMorphComponents"),MorphComponents.Num());
        Result->SetBoolField(TEXT("mechanismControlsExercised"),true);
    }
    const double BeforeResetAngle=InputAngle;const float BeforeResetExplosion=Explosion;
    const FVirtualWorldProgress BeforeResetProgress=Progress.FindRef(SceneOrder[SceneIndex]);
    const VW::Json SourceCamera=VW::Object(Scene,TEXT("camera"));
    FVector ExpectedOffset=VW::Position(VW::Vector(SourceCamera,TEXT("position")))-VW::Position(VW::Vector(SourceCamera,TEXT("target")));
    if(ExpectedOffset.IsNearlyZero()) ExpectedOffset=FVector(300,300,200);
    const VW::Json Navigation=VW::Object(Metadata,TEXT("navigation"));
    if(PlayerRoot&&VW::String(Navigation,TEXT("kind"))==TEXT("sphere"))
    {
        const FVector Centre=VW::Position(VW::Vector(Navigation,TEXT("center")));
        const FVector SpawnUp=(VW::Position(VW::Vector(Scene,TEXT("spawn")))-Centre).GetSafeNormal(SMALL_NUMBER,FVector::UpVector);
        ExpectedOffset=FQuat::FindBetweenNormals(SpawnUp,PlayerUp).RotateVector(ExpectedOffset);
    }
    CameraOffset=FVector(123,234,345);CameraUp=FVector::RightVector;Command(TEXT("camera-reset"));
    const FVirtualWorldProgress AfterResetProgress=Progress.FindRef(SceneOrder[SceneIndex]);
    Require(CameraOffset.Equals(ExpectedOffset,.001),TEXT("Reset view did not restore the authored camera offset."));
    Require(InputAngle==BeforeResetAngle&&Explosion==BeforeResetExplosion&&BeforeResetProgress.Flags.Difference(AfterResetProgress.Flags).IsEmpty()&&AfterResetProgress.Flags.Difference(BeforeResetProgress.Flags).IsEmpty()&&BeforeResetProgress.bCompleted==AfterResetProgress.bCompleted,TEXT("Reset view changed mechanism or story state."));
    Result->SetBoolField(TEXT("cameraResetExercised"),FatalError.IsEmpty());
    Result->SetBoolField(TEXT("passed"),FatalError.IsEmpty());SmokeScenes.Add(MakeShared<FJsonValueObject>(Result));
    if(!FatalError.IsEmpty()) {FinishSmoke();return;}
    if(++SmokeIndex>=Scenes.Num()) {FinishSmoke();return;}
    SmokeFrame=0;LoadScene(SmokeIndex,true);
}

void AVirtualWorldRuntime::FinishSmoke()
{
    if(bSmokeFinished)return;bSmokeFinished=true;
    const VW::Json Report=MakeShared<FJsonObject>();
    Report->SetStringField(TEXT("runId"),SmokeRunId);
    Report->SetStringField(TEXT("engineVersion"),FEngineVersion::Current().ToString());
    Report->SetStringField(TEXT("manifestSha256"),ManifestSha256);
    Report->SetBoolField(TEXT("nativeExecution"),true);
    Report->SetBoolField(TEXT("passed"),FatalError.IsEmpty()&&SmokeScenes.Num()==Scenes.Num()&&!Scenes.IsEmpty());
    Report->SetBoolField(TEXT("visualParityVerified"),false);
    Report->SetBoolField(TEXT("keyboardLocomotionVerified"),false);
    bool bAnyPlayer=false,bPlayerMotionPassed=true;
    for(const auto& Value:SmokeScenes)
    {
        const VW::Json Result=Value->AsObject();
        if(VW::Number(Result,TEXT("playerInstances"))>0) {bAnyPlayer=true;bPlayerMotionPassed&=VW::Bool(Result,TEXT("playerMotionExercised"));}
    }
    Report->SetBoolField(TEXT("programmaticLocomotionVerified"),bAnyPlayer&&bPlayerMotionPassed&&FatalError.IsEmpty());
    Report->SetStringField(TEXT("pluginRevision"),TEXT("0b22180d5d5d48b13457b683f4405113b6afd87b"));
    Report->SetStringField(TEXT("error"),FatalError);
    Report->SetArrayField(TEXT("scenes"),SmokeScenes);
    const FString Path=FPaths::ProjectSavedDir()/TEXT("VirtualWorld/smoke-report.json");
    IFileManager::Get().MakeDirectory(*FPaths::GetPath(Path),true);
    const bool bWritten=FFileHelper::SaveStringToFile(VW::Serialize(Report),*Path,FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
    const bool bPass=bWritten&&VW::Bool(Report,TEXT("passed"));
    UE_LOG(LogTemp,Display,TEXT("VirtualWorld native smoke %s: %s"),bPass?TEXT("passed"):TEXT("FAILED"),*Path);
    FPlatformMisc::RequestExitWithStatus(false,bPass?0:1);
}
