#include "VirtualWorldRuntime.h"
#include "VirtualWorldModel.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/Engine.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"
#include "Engine/World.h"
#include "Misc/App.h"
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
        // Exercise actual authored prerequisite/flag/completion logic. Positioning here is a test fixture,
        // not evidence that keyboard locomotion, sweeps or visual framing passed.
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
        const auto& Exposure=Camera->GetCameraComponent()->PostProcessSettings;
        Require(Exposure.bOverride_AutoExposureMethod&&Exposure.AutoExposureMethod==AEM_Manual,
            TEXT("Inspection lighting must lock exposure to prevent brightness pumping."));
        Require(Exposure.bOverride_BloomIntensity&&Exposure.BloomIntensity==0,
            TEXT("Inspection must preserve machined edges without bloom glare."));
        bool bReflections=false,bViewFill=false;
        for(AActor* Actor:SpawnedActors)
        {
            if(ASkyLight* Sky=Cast<ASkyLight>(Actor))
            {
                const USkyLightComponent* Component=Sky->GetLightComponent();
                bReflections|=Component->SourceType==SLS_SpecifiedCubemap&&Component->Cubemap!=nullptr;
                Require(!Component->IsRealTimeCaptureEnabled()&&(!Component->bLowerHemisphereIsBlack||Component->LowerHemisphereColor.GetLuminance()>.1f),
                    TEXT("Down-facing metal requires a persistent illuminated lower reflection hemisphere."));
            }
            if(ADirectionalLight* Light=Cast<ADirectionalLight>(Actor))
            {
                Require(Light->GetLightComponent()->Mobility==EComponentMobility::Movable,
                    TEXT("Inspection lights must work without baked lighting."));
                if(Light->GetAttachParentActor()==Camera)
                    bViewFill|=!Light->GetLightComponent()->CastShadows&&Light->GetLightComponent()->Intensity>0;
            }
        }
        Require(bReflections,TEXT("Metal inspection requires a fixed, non-black environment reflection."));
        Require(bViewFill,TEXT("Cutaways require a persistent unshadowed fill following the inspection camera."));
        Result->SetBoolField(TEXT("stableInspectionLighting"),FatalError.IsEmpty());
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
        for(const auto& Id:VW::Array(Mechanism,TEXT("fullHousingIds")))Require(!Nodes[Id->AsString()].bVisible,TEXT("Full housing was visible in section mode."));
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
    Report->SetBoolField(TEXT("nativeExecution"),true);
    Report->SetBoolField(TEXT("passed"),FatalError.IsEmpty()&&SmokeScenes.Num()==Scenes.Num()&&!Scenes.IsEmpty());
    Report->SetBoolField(TEXT("visualParityVerified"),false);
    Report->SetBoolField(TEXT("keyboardLocomotionVerified"),false);
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
