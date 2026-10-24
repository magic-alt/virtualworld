#include "VirtualWorldRuntime.h"
#include "VirtualWorldModel.h"
#include "Components/SceneComponent.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "HAL/FileManager.h"

bool AVirtualWorldRuntime::IsUnlocked(const FString& Id) const
{
    TSet<FString> Completed;
    for(const auto& Pair:Progress) if(Pair.Value.bCompleted) Completed.Add(Pair.Key);
    return VW::ChapterUnlocked(VW::Object(Manifest,TEXT("campaign")),Id,Completed,LaunchSceneId);
}

double AVirtualWorldRuntime::InteractionDistance(const FString& Id) const
{
    const FVirtualWorldNode* Node=Nodes.Find(Id);
    if(!Node||!Node->bVisible||!PlayerRoot) return TNumericLimits<double>::Max();
    const FVector Point=Node->Wrapper->GetComponentLocation();
    const VW::Json Navigation=VW::Object(Metadata,TEXT("navigation"));
    if(VW::String(Navigation,TEXT("kind"))==TEXT("sphere"))
    {
        const FVector Center=VW::Position(VW::Vector(Navigation,TEXT("center")));
        const double Angle=FMath::Acos(FMath::Clamp(FVector::DotProduct((Point-Center).GetSafeNormal(),PlayerUp),-1.,1.));
        return Angle*VW::Number(Navigation,TEXT("radius"))*100.;
    }
    return FVector::Distance(Point,PlayerFeet);
}

FString AVirtualWorldRuntime::NearbyInteraction() const
{
    FString Closest;double Distance=TNumericLimits<double>::Max();
    for(const auto& Pair:Nodes)
    {
        if(!VW::Object(Pair.Value.Metadata,TEXT("interaction"))) continue;
        const double D=InteractionDistance(Pair.Key);
        if(D<Distance) {Distance=D;Closest=Pair.Key;}
    }
    return Closest;
}

bool AVirtualWorldRuntime::Interact(const FString& Id)
{
    if(!Nodes.Contains(Id)||!PlayerRoot) return false;
    const VW::Json Interaction=VW::Object(Nodes[Id].Metadata,TEXT("interaction"));
    if(!Interaction) return false;
    if(InteractionDistance(Id)>300.) { Notice=TEXT("Move within 3 metres to interact.");return false; }
    FVirtualWorldProgress& State=Progress.FindOrAdd(SceneOrder[SceneIndex]);
    if(!VW::Requires(Interaction,State.Flags)) { Notice=TEXT("Complete the prerequisite task first.");return false; }
    const FString Gives=VW::String(Interaction,TEXT("gives"));
    if(!Gives.IsEmpty()) State.Flags.Add(Gives);
    State.bCompleted|=VW::Bool(Interaction,TEXT("completes"));
    SelectedInteraction=Id;Dialogue=VW::String(Interaction,TEXT("title"))+TEXT("\n")+VW::String(Interaction,TEXT("text"));
    const FString Name=VW::String(VW::Object(VW::Object(Metadata,TEXT("actor")),TEXT("clips")),TEXT("interact"));
    InteractionRemaining=FMath::Max(.25f,PlayerModel->ClipDuration(Name));
    PlayerClip.Empty();PlayPlayerClip(TEXT("interact"));
    Notice=State.bCompleted?TEXT("Chapter completed. Next unlocked chapter: Tab."):TEXT("Progress saved.");
    SaveProgress();return true;
}

FString AVirtualWorldRuntime::ProgressFingerprint(int32 Index) const
{
    return VW::DigestText(TEXT("virtualworld-unreal-progress-v1:")+VW::String(Scenes[Index],TEXT("metadataJson")));
}

FVirtualWorldProgress AVirtualWorldRuntime::ValidatedProgress(const VW::Json& Source,const VW::Json& Saved) const
{
    FVirtualWorldProgress Result;
    TSet<FString> Requested;
    for(const auto& Value:VW::Array(Saved,TEXT("flags"))) Requested.Add(Value->AsString());
    bool bChanged=true;
    while(bChanged)
    {
        bChanged=false;
        for(const auto& Value:VW::Array(Source,TEXT("nodes")))
        {
            const VW::Json Interaction=VW::Object(Value->AsObject(),TEXT("interaction"));const FString Gives=VW::String(Interaction,TEXT("gives"));
            if(!Gives.IsEmpty()&&Requested.Contains(Gives)&&!Result.Flags.Contains(Gives)&&VW::Requires(Interaction,Result.Flags)) {Result.Flags.Add(Gives);bChanged=true;}
        }
    }
    if(Result.Flags.Num()!=Requested.Num()) return FVirtualWorldProgress();
    if(VW::Bool(Saved,TEXT("completed")))
        for(const auto& Value:VW::Array(Source,TEXT("nodes")))
        {
            const VW::Json Interaction=VW::Object(Value->AsObject(),TEXT("interaction"));const FString Gives=VW::String(Interaction,TEXT("gives"));
            if(VW::Bool(Interaction,TEXT("completes"))&&VW::Requires(Interaction,Result.Flags)&&(Gives.IsEmpty()||Result.Flags.Contains(Gives))) {Result.bCompleted=true;break;}
        }
    return Result;
}

void AVirtualWorldRuntime::ReadProgress()
{
    FString Text;VW::Json Saved;
    if(!FPaths::FileExists(ProgressPath)) return;
    if(!FFileHelper::LoadFileToString(Text,*ProgressPath)||!VW::Parse(Text,Saved)||VW::Number(Saved,TEXT("version"))!=1) {Notice=TEXT("Invalid local progress was ignored.");return;}
    const VW::Json States=VW::Object(Saved,TEXT("scenes"));
    for(int32 I=0;I<Scenes.Num();++I)
    {
        const VW::Json State=VW::Object(States,*SceneOrder[I]);
        if(State&&VW::String(State,TEXT("fingerprint"))==ProgressFingerprint(I)) Progress[SceneOrder[I]]=ValidatedProgress(Metadatas[I],State);
    }
    // Preserve each validated chapter's progress even when another launch entry locks it.
    // ChapterUnlocked applies transitive gates without deleting independently earned state.
}

void AVirtualWorldRuntime::SaveProgress()
{
    if(bSmokeRequested) return;
    const VW::Json Saved=MakeShared<FJsonObject>(),States=MakeShared<FJsonObject>();
    Saved->SetNumberField(TEXT("version"),1);
    for(int32 I=0;I<SceneOrder.Num();++I)
    {
        const FVirtualWorldProgress& State=Progress[SceneOrder[I]];const VW::Json Entry=MakeShared<FJsonObject>();
        TArray<FString> Sorted=State.Flags.Array();Sorted.Sort();TArray<TSharedPtr<FJsonValue>> Flags;
        for(const FString& Flag:Sorted) Flags.Add(MakeShared<FJsonValueString>(Flag));
        Entry->SetArrayField(TEXT("flags"),Flags);Entry->SetBoolField(TEXT("completed"),State.bCompleted);Entry->SetStringField(TEXT("fingerprint"),ProgressFingerprint(I));
        States->SetObjectField(SceneOrder[I],Entry);
    }
    Saved->SetObjectField(TEXT("scenes"),States);
    IFileManager::Get().MakeDirectory(*FPaths::GetPath(ProgressPath),true);
    const FString Temporary=ProgressPath+TEXT(".tmp");
    if(!FFileHelper::SaveStringToFile(VW::Serialize(Saved),*Temporary,FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM)||!IFileManager::Get().Move(*ProgressPath,*Temporary,true,true))
        Notice=TEXT("Progress is in memory; writing the local save failed.");
}

void AVirtualWorldRuntime::Command(const FString& Action)
{
    if(Action==TEXT("import-cad")) {ChooseCadFile();return;}
    if(Action==TEXT("cancel-import")) {CancelCadImport(TEXT("Import cancelled; current scene retained."));return;}
    if(!FatalError.IsEmpty()||!Metadata) return;
    if(Action==TEXT("interact")) {Interact(NearbyInteraction());return;}
    if(Action.StartsWith(TEXT("talk:"))) {Interact(Action.Mid(5));return;}
    if(Action.StartsWith(TEXT("choice:")))
    {
        if(!Nodes.Contains(SelectedInteraction)||InteractionDistance(SelectedInteraction)>300.) {Notice=TEXT("Return to the interaction to choose.");return;}
        const VW::Json Interaction=VW::Object(Nodes[SelectedInteraction].Metadata,TEXT("interaction"));
        const auto Choices=VW::Array(Interaction,TEXT("choices"));const int32 Choice=FCString::Atoi(*Action.Mid(7));
        if(Choices.IsValidIndex(Choice)&&VW::Requires(Interaction,Progress[SceneOrder[SceneIndex]].Flags)) Dialogue=VW::String(Choices[Choice]->AsObject(),TEXT("text"));
        return;
    }
    if(Action==TEXT("next"))
    {
        for(int32 Offset=1;Offset<SceneOrder.Num();++Offset)
        {
            const int32 Next=(SceneIndex+Offset)%SceneOrder.Num();
            if(IsUnlocked(SceneOrder[Next])) {LoadScene(Next);return;}
        }
        Notice=TEXT("No other chapter is unlocked.");return;
    }
    if(Action.StartsWith(TEXT("scene:"))) {LoadScene(SceneOrder.IndexOfByKey(Action.Mid(6)));return;}
    if(Action==TEXT("reset"))
    {
        if(Mechanism) {InputAngle=0;KinematicOffset=0;bRunning=false;if(JointDynamics){JointDynamics->reset();Rpm=6;bBrakeInstalled=bBrakePowered=true;JointTimeScale=1;}ApplyMechanism();ApplyVisibility();}
        else if(!PlayerRoot) {LoadScene(SceneIndex);Notice=TEXT("Model view reset.");}
        else {for(auto& Pair:Progress) Pair.Value=FVirtualWorldProgress();SaveProgress();LoadScene(SceneOrder.IndexOfByKey(LaunchSceneId));Notice=TEXT("Campaign progress reset.");}
        return;
    }
    if(Action==TEXT("pause"))
    {
        bPaused=!bPaused;
        for(AActor* Actor:SpawnedActors) if(AVirtualWorldModel* Model=Cast<AVirtualWorldModel>(Actor)) Model->PausePlayback(bPaused);
        return;
    }
    if(!Mechanism) return;
    if(JointDynamics)
    {
        const auto State=JointDynamics->snapshot();
        if(Action==TEXT("run")){if(State.running)JointDynamics->stop();else if(!JointDynamics->start())Notice=TEXT("Wait for complete brake release before starting.");}
        else if(Action==TEXT("step")||Action==TEXT("step-back")){if(!bPaused&&!State.running&&State.omega==0&&State.closure==0&&State.powered)KinematicOffset+=(Action==TEXT("step")?1:-1)*PI/12.;}
        else if(Action==TEXT("speed-up")||Action==TEXT("speed-down")){Rpm=FMath::Clamp(Rpm+(Action==TEXT("speed-up")?1:-1),-30.f,30.f);JointDynamics->setRpm(Rpm);}
        else if(Action==TEXT("brake-power")&&bBrakeInstalled){bBrakePowered=!bBrakePowered;JointDynamics->setPowered(bBrakePowered);}
        else if(Action==TEXT("brake-install")){bBrakeInstalled=!bBrakeInstalled;JointDynamics->setInstalled(bBrakeInstalled);}
        else if(Action==TEXT("markers"))bRollingMarkers=!bRollingMarkers;
        else if(Action==TEXT("principle"))bPrinciple=!bPrinciple;
        else if(Action==TEXT("slow-motion"))JointTimeScale=JointTimeScale==1?.1:JointTimeScale==.1?.02:1;
        else if(Action==TEXT("section"))bSection=!bSection;
        bRunning=JointDynamics->snapshot().running;ApplyMechanism();ApplyVisibility();if(Action==TEXT("principle"))FrameCadInspection();return;
    }
    const bool bLocked=bBrakeInstalled&&!bBrakePowered;
    if(Action==TEXT("run")) bRunning=!bRunning&&!bLocked;
    else if(Action==TEXT("step")||Action==TEXT("step-back"))
    {
        if(!bRunning&&!bPaused&&!bLocked) InputAngle+=(Action==TEXT("step")?1:-1)*PI/12.;
    }
    else if(Action==TEXT("speed-up")) Rpm=FMath::Clamp(Rpm+1,-30.f,30.f);
    else if(Action==TEXT("speed-down")) Rpm=FMath::Clamp(Rpm-1,-30.f,30.f);
    else if(Action==TEXT("section")) bSection=!bSection;
    else if(Action==TEXT("explode")) Explosion=Explosion>=.99f?0.f:FMath::Min(1.f,Explosion+.25f);
    else if(Action==TEXT("brake-power")&&bBrakeInstalled) {bBrakePowered=!bBrakePowered;bRunning=false;}
    else if(Action==TEXT("brake-install")&&bHasBrake) {bBrakeInstalled=!bBrakeInstalled;bBrakePowered=true;bRunning=false;}
    else if(Action.StartsWith(TEXT("hide:")))
    {
        const FString Id=Action.Mid(5);if(HiddenSubsystems.Contains(Id)) HiddenSubsystems.Remove(Id);else HiddenSubsystems.Add(Id);
    }
    else if(Action.StartsWith(TEXT("isolate:")))
    {
        const FString Id=Action.Mid(8);IsolatedNodes.Reset();
        if(IsolatedSubsystem==Id) IsolatedSubsystem.Empty();
        else
        {
            IsolatedSubsystem=Id;
            for(const auto& Value:VW::Array(Mechanism,TEXT("subsystems")))
                if(VW::String(Value->AsObject(),TEXT("id"))==Id)
                {
                    Notice=VW::String(Value->AsObject(),TEXT("description"));
                    for(const auto& Node:VW::Array(Value->AsObject(),TEXT("nodeIds"))) IsolatedNodes.Add(Node->AsString());
                }
        }
    }
    ApplyMechanism();ApplyVisibility();
}
