#include "VirtualWorldRuntime.h"
#include "VirtualWorldModel.h"
#include "glTFRuntimeFunctionLibrary.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/BoxComponent.h"
#include "Components/SphereComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/World.h"
#include "Engine/Engine.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "HAL/FileManager.h"
#include "PhysicsEngine/BodySetup.h"

AVirtualWorldRuntime::AVirtualWorldRuntime()
{
    PrimaryActorTick.bCanEverTick = true;
    RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("VirtualWorldRoot"));
}

bool AVirtualWorldRuntime::Fail(const FString& Message)
{
    if (FatalError.IsEmpty()) FatalError = Message;
    UE_LOG(LogTemp, Error, TEXT("VirtualWorld: %s"), *Message);
    return false;
}

void AVirtualWorldRuntime::OnImportError(const FString Context, const FString Message)
{
    Fail(FString::Printf(TEXT("glTFRuntime %s: %s"), *Context, *Message));
}

void AVirtualWorldRuntime::BeginPlay()
{
    Super::BeginPlay();
    DataDirectory = FPaths::ConvertRelativePathToFull(FPaths::ProjectContentDir() / TEXT("VirtualWorldData"));
    ProgressPath = FPaths::ProjectSavedDir() / TEXT("VirtualWorld/progress.json");
    bSmokeRequested = FParse::Param(FCommandLine::Get(), TEXT("VirtualWorldSmoke"));
    FParse::Value(FCommandLine::Get(), TEXT("VirtualWorldSmokeRun="), SmokeRunId);
    if (!ReadCatalog()) return;
    FString Requested = VW::String(Manifest, TEXT("entrySceneId"));
    FParse::Value(FCommandLine::Get(), TEXT("VirtualWorldScene="), Requested);
    int32 Index = SceneOrder.IndexOfByKey(Requested);
    if (Index == INDEX_NONE) { Fail(TEXT("Unknown requested scene: ") + Requested); return; }
    LaunchSceneId=Requested;
    if (!bSmokeRequested) ReadProgress();
    LoadScene(bSmokeRequested ? 0 : Index, bSmokeRequested);
    if (APlayerController* PC = GetWorld()->GetFirstPlayerController())
    {
        PC->bShowMouseCursor = true;
        PC->bEnableClickEvents = true;
        FInputModeGameAndUI Mode;
        Mode.SetHideCursorDuringCapture(false);
        Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
        PC->SetInputMode(Mode);
    }
}

bool AVirtualWorldRuntime::ReadCatalog()
{
    FString Text;TArray<uint8> ManifestBytes;
    if (!FFileHelper::LoadFileToArray(ManifestBytes, *(DataDirectory / TEXT("engine-manifest.json"))))
        return Fail(TEXT("Missing or invalid Content/VirtualWorldData/engine-manifest.json"));
    ManifestSha256=VW::Digest(ManifestBytes);
    FFileHelper::BufferToString(Text,ManifestBytes.GetData(),ManifestBytes.Num());
    if (!VW::Parse(Text, Manifest))
        return Fail(TEXT("Missing or invalid Content/VirtualWorldData/engine-manifest.json"));
    if (VW::Number(Manifest, TEXT("version")) != 1 || VW::String(Manifest, TEXT("target")) != TEXT("unreal"))
        return Fail(TEXT("Expected Unreal manifest version 1."));
    const VW::Json Coordinates = VW::Object(Manifest, TEXT("coordinates"));
    if (VW::String(Coordinates,TEXT("handedness"))!=TEXT("right") || VW::String(Coordinates,TEXT("up"))!=TEXT("Y") || VW::String(Coordinates,TEXT("units"))!=TEXT("metres") || VW::String(Coordinates,TEXT("quaternion"))!=TEXT("xyzw"))
        return Fail(TEXT("Unsupported source coordinate contract."));
    for (const auto& Value : VW::Array(Manifest,TEXT("assets")))
    {
        VW::Json Asset = Value->AsObject();
        const FString Id=VW::String(Asset,TEXT("id"));
        bool bHex=Id.Len()==64;
        for(TCHAR C:Id) bHex &= (C>='0'&&C<='9')||(C>='a'&&C<='f');
        if(!bHex || ModelRecords.Contains(Id) || VW::String(Asset,TEXT("sha256"))!=Id || VW::String(Asset,TEXT("path"))!=TEXT("models/")+Id+TEXT(".glb"))
            return Fail(TEXT("Invalid canonical model record: ")+Id);
        const double Size=VW::Number(Asset,TEXT("bytes"));
        if(Size<20 || Size>512.*1024*1024 || Size!=FMath::FloorToDouble(Size)) return Fail(TEXT("Canonical model size exceeds supported bounds: ")+Id);
        ModelRecords.Add(Id,Asset);
    }
    for (const auto& Value : VW::Array(Manifest,TEXT("scenes")))
    {
        VW::Json Entry=Value->AsObject(), Source;
        const FString Id=VW::String(Entry,TEXT("id"));
        if(!VW::SafeId(Id) || SceneOrder.Contains(Id) || !VW::Parse(VW::String(Entry,TEXT("metadataJson")),Source) || VW::String(Source,TEXT("id"))!=Id)
            return Fail(TEXT("Invalid scene metadata: ")+Id);
        if(VW::Object(Source,TEXT("actor")) && !ModelRecords.Contains(VW::String(Entry,TEXT("actorModel"))))
            return Fail(TEXT("Missing whole-GLB actorModel binding: ")+Id);
        SceneOrder.Add(Id);Scenes.Add(Entry);Metadatas.Add(Source);Progress.Add(Id,FVirtualWorldProgress());
    }
    if(!SceneOrder.Contains(VW::String(Manifest,TEXT("entrySceneId")))) return Fail(TEXT("Unknown entrySceneId."));
    TSet<FString> Previous;
    for(const auto& Value:VW::Array(VW::Object(Manifest,TEXT("campaign")),TEXT("chapters")))
    {
        const VW::Json Chapter=Value->AsObject();const FString Id=VW::String(Chapter,TEXT("id"));
        if(!SceneOrder.Contains(Id)||Previous.Contains(Id)) return Fail(TEXT("Invalid campaign chapter: ")+Id);
        for(const auto& Required:VW::Array(Chapter,TEXT("requires"))) if(!Previous.Contains(Required->AsString())) return Fail(TEXT("Invalid campaign prerequisite."));
        Previous.Add(Id);
    }
    return true;
}

void AVirtualWorldRuntime::ClearScene()
{
    for (AActor* Actor : SpawnedActors) if (IsValid(Actor)) Actor->Destroy();
    SpawnedActors.Reset();
    for (int32 I=SceneComponents.Num()-1; I>=0; --I) if (IsValid(SceneComponents[I])) SceneComponents[I]->DestroyComponent();
    SceneComponents.Reset();
    AssetCache.Reset();Nodes.Reset();MorphComponents.Reset();
    PlayerModel=nullptr;PlayerRoot=nullptr;Camera=nullptr;
    SelectedInteraction.Empty();Dialogue.Empty();PlayerClip.Empty();
    ColliderCount=0;InteractionRemaining=0;PlayerVerticalSpeed=0;bPlayerGrounded=false;
    LastGroundedFeet=FVector::ZeroVector;
    HiddenSubsystems.Reset();IsolatedNodes.Reset();IsolatedSubsystem.Empty();
    InputAngle=0;Rpm=6;Explosion=0;bRunning=false;bPaused=false;bSection=false;
}

bool AVirtualWorldRuntime::LoadScene(int32 Index, bool bSmoke)
{
    if(!Scenes.IsValidIndex(Index)) return Fail(TEXT("Scene index is outside the catalog."));
    if(!bSmoke && !IsUnlocked(SceneOrder[Index])) { Notice=TEXT("Complete the prerequisite chapters first."); return false; }
    ClearScene();FatalError.Empty();SceneIndex=Index;Scene=Scenes[Index];Metadata=Metadatas[Index];Mechanism=VW::Object(Metadata,TEXT("mechanism"));
    const FString PreviewId=VW::String(VW::Object(Metadata,TEXT("actor")),TEXT("nodeId"));
    const auto Entries=VW::Array(Scene,TEXT("nodes"));
    for(const auto& Value:Entries)
    {
        FVirtualWorldNode Node;Node.Native=Value->AsObject();Node.Id=VW::String(Node.Native,TEXT("id"));Node.Parent=VW::String(Node.Native,TEXT("parentId"));
        if(!VW::SafeId(Node.Id)||Nodes.Contains(Node.Id)||!VW::Parse(VW::String(Node.Native,TEXT("metadataJson")),Node.Metadata)) return Fail(TEXT("Invalid node metadata: ")+Node.Id);
        Node.Wrapper=NewObject<USceneComponent>(this);
        AddInstanceComponent(Node.Wrapper);Node.Wrapper->SetupAttachment(RootComponent);Node.Wrapper->RegisterComponent();SceneComponents.Add(Node.Wrapper);
        Node.Wrapper->ComponentTags.Add(FName(*Node.Id));
        Nodes.Add(Node.Id,Node);
    }
    if(!PreviewId.IsEmpty()&&!Nodes.Contains(PreviewId)) return Fail(TEXT("Missing actor preview node binding: ")+PreviewId);
    for(auto& Pair:Nodes)
    {
        FVirtualWorldNode& Node=Pair.Value;
        TSet<FString> Seen;Seen.Add(Node.Id);FString Parent=Node.Parent;
        while(!Parent.IsEmpty())
        {
            if(!Nodes.Contains(Parent)||Seen.Contains(Parent)) return Fail(TEXT("Missing or cyclic parent of ")+Node.Id);
            Seen.Add(Parent);Parent=Nodes[Parent].Parent;
        }
        if(!Node.Parent.IsEmpty()) Node.Wrapper->AttachToComponent(Nodes[Node.Parent].Wrapper,FAttachmentTransformRules::KeepRelativeTransform);
        Node.Wrapper->SetRelativeTransform(VW::Transform(VW::Vector(Node.Native,TEXT("translation")),VW::Quaternion(Node.Native,TEXT("rotation")),VW::Vector(Node.Native,TEXT("scale"),FVector::OneVector)));
        const FString ModelId=VW::String(Node.Native,TEXT("model"));
        const VW::Json Collider=VW::Object(Node.Native,TEXT("collider"));
        const bool bMeshCollision=VW::String(Collider,TEXT("shape"))==TEXT("mesh")&&VW::Bool(Node.Native,TEXT("effectiveVisible"),true);
        // Actor preview is a source editing aid. The only gameplay actor is actorModel below.
        if(!ModelId.IsEmpty() && Node.Id!=PreviewId)
        {
            Node.Model=SpawnModel(ModelId,Node.Wrapper,bMeshCollision,false);
            if(!Node.Model || !FatalError.IsEmpty()) return false;
            const VW::Json Animation=VW::Object(Node.Metadata,TEXT("animation"));
            if(Animation && !Node.Model->PlayClip(VW::String(Animation,TEXT("clip")),VW::Bool(Animation,TEXT("loop"),true),static_cast<float>(VW::Number(Animation,TEXT("speed"),1))))
                return Fail(TEXT("Missing authored node animation: ")+Node.Id+TEXT(" / ")+VW::String(Animation,TEXT("clip")));
        }
        if(Node.Id!=PreviewId && !BuildColliders(Node)) return false;
    }
    if(VW::Object(Metadata,TEXT("actor")) && !BuildPlayer()) return false;
    if(Mechanism && !BindMechanism()) return false;
    BuildCameraAndLight();ApplyVisibility();ApplyMechanism();UpdateCamera();
    return FatalError.IsEmpty();
}

AVirtualWorldModel* AVirtualWorldRuntime::SpawnModel(const FString& ModelId,USceneComponent* Parent,bool bMeshCollision,bool bPlayer)
{
    if(!ModelRecords.Contains(ModelId)) { Fail(TEXT("Missing canonical model: ")+ModelId);return nullptr; }
    UglTFRuntimeAsset* Asset=AssetCache.FindRef(ModelId);
    if(!Asset)
    {
        const VW::Json Record=ModelRecords[ModelId];TArray<uint8> Bytes;
        const FString Path=DataDirectory/VW::String(Record,TEXT("path"));
        if(IFileManager::Get().FileSize(*Path)!=static_cast<int64>(VW::Number(Record,TEXT("bytes"))) || !FFileHelper::LoadFileToArray(Bytes,*Path)) { Fail(TEXT("Missing or changed canonical model length: ")+Path);return nullptr; }
        if(VW::Digest(Bytes)!=VW::String(Record,TEXT("sha256"))) { Fail(TEXT("Canonical model SHA-256 mismatch: ")+Path);return nullptr; }
        Asset=UglTFRuntimeFunctionLibrary::glTFLoadAssetFromData(Bytes,VW::LoaderConfig());
        if(!Asset) { Fail(TEXT("glTFRuntime could not parse: ")+Path);return nullptr; }
        AssetCache.Add(ModelId,Asset);
        Asset->OnError.AddDynamic(this,&AVirtualWorldRuntime::OnImportError);
    }
    AVirtualWorldModel* Model=GetWorld()->SpawnActorDeferred<AVirtualWorldModel>(AVirtualWorldModel::StaticClass(),FTransform::Identity,this,nullptr,ESpawnActorCollisionHandlingMethod::AlwaysSpawn);
    if(!Model) { Fail(TEXT("Cannot allocate native model actor."));return nullptr; }
    SpawnedActors.Add(Model);Model->Asset=Asset;
    Model->SkeletalAnimationConfig.bRemoveRootMotion=bPlayer;
    Model->StaticMeshConfig.bBuildComplexCollision=bMeshCollision;
    Model->StaticMeshConfig.bAllowCPUAccess=bMeshCollision;
    Model->StaticMeshConfig.CollisionComplexity=CTF_UseComplexAsSimple;
    Model->OnNodeProcessed.AddLambda([this,bMeshCollision,ModelId](const FglTFRuntimeNode& Node,USceneComponent* Component)
    {
        UPrimitiveComponent* Primitive=Cast<UPrimitiveComponent>(Component);
        if(Primitive) Primitive->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        if(UStaticMeshComponent* Static=Cast<UStaticMeshComponent>(Component))
        {
            if(!Static->GetStaticMesh()) { Fail(TEXT("Missing imported static mesh: ")+ModelId+TEXT(" / ")+Node.Name);return; }
            if(bMeshCollision)
            {
                Static->SetCollisionObjectType(ECC_WorldStatic);
                Static->SetCollisionResponseToAllChannels(ECR_Ignore);
                Static->SetCollisionResponseToChannel(ECC_Pawn,ECR_Block);
                Static->SetCollisionEnabled(ECollisionEnabled::QueryOnly);++ColliderCount;
            }
        }
        if(USkeletalMeshComponent* Skin=Cast<USkeletalMeshComponent>(Component))
        {
            if(!Skin->GetSkeletalMeshAsset()) Fail(TEXT("Missing imported skeletal mesh: ")+ModelId+TEXT(" / ")+Node.Name);
            if(bMeshCollision) Fail(TEXT("Animated or morphing mesh collision requires authored box/ball proxies: ")+ModelId);
        }
    });
    Model->FinishSpawning(FTransform::Identity);
    Model->AttachToComponent(Parent,FAttachmentTransformRules::KeepRelativeTransform);
    Model->SetActorRelativeTransform(FTransform::Identity);
    TArray<UStaticMeshComponent*> StaticMeshes;TArray<USkeletalMeshComponent*> Skins;
    Model->GetComponents<UStaticMeshComponent>(StaticMeshes);Model->GetComponents<USkeletalMeshComponent>(Skins);
    if(StaticMeshes.IsEmpty()&&Skins.IsEmpty()) { Fail(TEXT("Canonical model produced no renderable mesh: ")+ModelId);return nullptr; }
    return Model;
}

bool AVirtualWorldRuntime::BuildColliders(FVirtualWorldNode& Node)
{
    const VW::Json Data=VW::Object(Node.Native,TEXT("collider"));
    if(!Data || !VW::Bool(Node.Native,TEXT("effectiveVisible"),true)) return true;
    const FString Kind=VW::String(Data,TEXT("shape"));const FVector Size=VW::Vector(Data,TEXT("size"));
    UShapeComponent* Collider=nullptr;
    if(Kind==TEXT("box"))
    {
        UBoxComponent* Box=NewObject<UBoxComponent>(this);
        Box->SetBoxExtent(VW::Position(Size).GetAbs()*0.5);Collider=Box;
    }
    else if(Kind==TEXT("ball"))
    {
        USphereComponent* Ball=NewObject<USphereComponent>(this);Ball->SetSphereRadius(Size.X*100.);Collider=Ball;
    }
    else if(Kind==TEXT("mesh")) return Node.Model ? true : Fail(TEXT("Mesh collider has no model: ")+Node.Id);
    else return Fail(TEXT("Unknown collision shape: ")+Kind);
    AddInstanceComponent(Collider);Collider->SetupAttachment(Node.Wrapper);Collider->RegisterComponent();SceneComponents.Add(Collider);
    Collider->SetCollisionObjectType(ECC_WorldStatic);
    Collider->SetCollisionResponseToAllChannels(ECR_Ignore);Collider->SetCollisionResponseToChannel(ECC_Pawn,ECR_Block);
    Collider->SetCollisionEnabled(ECollisionEnabled::QueryOnly);Collider->SetHiddenInGame(true);++ColliderCount;
    return true;
}

void AVirtualWorldRuntime::BuildCameraAndLight()
{
    Camera=GetWorld()->SpawnActor<ACameraActor>();SpawnedActors.Add(Camera);
    Camera->GetCameraComponent()->FieldOfView=50.f;
    ResetCamera();
    if(APlayerController* PC=GetWorld()->GetFirstPlayerController()) PC->SetViewTarget(Camera);
    const VW::Json Environment=VW::Object(Scene,TEXT("environment"));
    ADirectionalLight* Sun=GetWorld()->SpawnActor<ADirectionalLight>();SpawnedActors.Add(Sun);
    Sun->SetActorRotation(FRotator(-45,-30,0));Sun->GetLightComponent()->SetMobility(EComponentMobility::Movable);
    Sun->GetLightComponent()->SetIntensity(static_cast<float>(VW::Number(Environment,TEXT("lightIntensity"),1)*3.14159));
    ADirectionalLight* Fill=GetWorld()->SpawnActor<ADirectionalLight>();SpawnedActors.Add(Fill);
    Fill->SetActorRotation(FRotator(35,150,0));Fill->GetLightComponent()->SetMobility(EComponentMobility::Movable);
    Fill->GetLightComponent()->SetCastShadows(false);Fill->GetLightComponent()->SetIntensity(static_cast<float>(VW::Number(Environment,TEXT("ambientIntensity"),0.5)));
    AExponentialHeightFog* Fog=GetWorld()->SpawnActor<AExponentialHeightFog>();SpawnedActors.Add(Fog);
    const FLinearColor Background=FLinearColor::FromSRGBColor(FColor::FromHex(VW::String(Environment,TEXT("background"),TEXT("17243A"))));
    Fog->GetComponent()->SetFogInscatteringColor(Background);
    Fog->GetComponent()->SetFogDensity(static_cast<float>(VW::Number(Environment,TEXT("fog"),0.0005)));
    ASkyLight* Sky=GetWorld()->SpawnActor<ASkyLight>();SpawnedActors.Add(Sky);
    Sky->GetLightComponent()->SetMobility(EComponentMobility::Movable);
    Sky->GetLightComponent()->SetIntensity(static_cast<float>(VW::Number(Environment,TEXT("ambientIntensity"),0.5)));
    Sky->GetLightComponent()->RecaptureSky();
}

void AVirtualWorldRuntime::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if(bSmokeRequested) { RunSmokeStep();return; }
    if(!FatalError.IsEmpty()) return;
    const float Delta=FMath::Clamp(DeltaSeconds,0.f,0.05f);
    HandleInput(Delta);
    if(!bPaused)
    {
        StepPlayer(Delta);
        StepMechanism(Delta);
    }
    UpdateCamera();
}

AVirtualWorldGameMode::AVirtualWorldGameMode()
{
    DefaultPawnClass=nullptr;HUDClass=AVirtualWorldHUD::StaticClass();
}
void AVirtualWorldGameMode::StartPlay()
{
    Super::StartPlay();
    GetWorld()->SpawnActor<AVirtualWorldRuntime>();
}
