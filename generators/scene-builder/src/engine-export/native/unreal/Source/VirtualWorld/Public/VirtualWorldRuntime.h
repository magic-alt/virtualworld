#pragma once
#include "CoreMinimal.h"
#include "HAL/PlatformProcess.h"
#include "GameFramework/Actor.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "VirtualWorldData.h"
#include "VirtualWorldJointDynamics.h"
#include "VirtualWorldRuntime.generated.h"

class AVirtualWorldModel;
class ACameraActor;
class UglTFRuntimeAsset;
class USkeletalMeshComponent;
class UPrimitiveComponent;
class UProceduralMeshComponent;

struct FVirtualWorldCadBinding
{
    VW::Json Data;
    UPrimitiveComponent* Component = nullptr;
    USceneComponent* Marker = nullptr;
    FTransform Original; // Native basis, model-relative, before any motion.
};

struct FVirtualWorldNode
{
    FString Id;
    FString Parent;
    VW::Json Native;
    VW::Json Metadata;
    USceneComponent* Wrapper = nullptr;
    AVirtualWorldModel* Model = nullptr;
    bool bVisible = true;
};
struct FVirtualWorldProgress
{
    TSet<FString> Flags;
    bool bCompleted = false;
};
struct FVirtualWorldAction
{
    FString Id;
    FString Label;
    bool bEnabled = true;
};

UCLASS()
class VIRTUALWORLD_API AVirtualWorldRuntime : public AActor
{
    GENERATED_BODY()
public:
    AVirtualWorldRuntime();
    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;
    bool LoadScene(int32 Index, bool bSmoke = false);
    void Command(const FString& Action);
    TArray<FString> StatusLines() const;
    TArray<FVirtualWorldAction> Actions() const;
    const FString& Error() const { return FatalError; }
    bool IsMechanism() const { return Mechanism.IsValid(); }
    UFUNCTION() void OnImportError(const FString ErrorContext, const FString ErrorMessage);

private:
    friend class AVirtualWorldHUD;
    friend class FVirtualWorldProgressTest;
    friend class FVirtualWorldMechanismTimingTest;
    friend class FVirtualWorldInspectionTest;
    friend class FVirtualWorldCadJointComponentTest;
    friend class FVirtualWorldCadJointPivotTest;
    friend class FVirtualWorldCadJointSuspensionTest;
    friend class FVirtualWorldCadJointInspectionTest;
    bool Fail(const FString& Message);
    bool ReadCatalog();
    void ClearScene();
    AVirtualWorldModel* SpawnModel(const FString& ModelId, USceneComponent* Parent, bool bMeshCollision, bool bPlayer);
    bool BuildColliders(FVirtualWorldNode& Node);
    bool BuildPlayer();
    bool BindMechanism();
    bool BindCadJoint();
    void ApplyCadJoint();
    void BuildCadPrinciple();
    void UpdateCadPrinciple();
    void FrameCadInspection(bool bPrincipleOnly = false);
    void BuildCameraAndLight();
    void ChooseCadFile();
    void BeginCadImport(const FString& Path);
    void TickCadImport();
    void CancelCadImport(const FString& Message);
    bool InstallCadCatalog(const FString& Directory, const FString& SceneId);
    void WriteCadReport(bool bSuccess, const FString& Message);
    FProcHandle CadProcess;
    void* CadReadPipe = nullptr;
    void* CadWritePipe = nullptr;
    FString CadDirectory;
    FString CadRequestId;
    FString CadLog;
    double CadStartedAt = 0;
    uint64 SceneGeneration = 0;
    uint64 CadGeneration = 0;
    void StepPlayer(float DeltaSeconds);
    void UpdateCamera();
    void HandleInput(float DeltaSeconds);
    void PlayPlayerClip(const FString& State);
    void ApplyMechanism();
    void StepMechanism(float DeltaSeconds);
    void BindJointClockLifecycle();
    void UnbindJointClockLifecycle();
    void ApplyVisibility();
    bool IsDescendant(const FString& Id, const FString& Ancestor) const;
    bool IsUnlocked(const FString& SceneId) const;
    FString NearbyInteraction() const;
    double InteractionDistance(const FString& Id) const;
    bool Interact(const FString& Id);
    void ReadProgress();
    void SaveProgress();
    FVirtualWorldProgress ValidatedProgress(const VW::Json& Metadata, const VW::Json& Saved) const;
    FString ProgressFingerprint(int32 Index) const;
    void RunSmokeStep();
    void FinishSmoke();

    VW::Json Manifest;
    VW::Json Scene;
    VW::Json Metadata;
    VW::Json Mechanism;
    TArray<VW::Json> Scenes;
    TArray<VW::Json> Metadatas;
    TMap<FString, VW::Json> ModelRecords;
    TMap<FString, FVirtualWorldNode> Nodes;
    TMap<FString, FVirtualWorldProgress> Progress;
    TArray<FString> SceneOrder;
    TSet<FString> HiddenSubsystems;
    TSet<FString> IsolatedNodes;
    FString IsolatedSubsystem;
    FString DataDirectory;
    FString ProgressPath;
    FString FatalError;
    FString Notice;
    FString Dialogue;
    FString SelectedInteraction;
    FString PlayerClip;
    FString SmokeRunId;
    FString LaunchSceneId;
    TArray<TSharedPtr<FJsonValue>> SmokeScenes;
    int32 SceneIndex = INDEX_NONE;
    int32 ColliderCount = 0;
    int32 SmokeFrame = 0;
    int32 SmokeIndex = 0;
    VWJoint::ClockGate JointClock;
    FDelegateHandle JointDeactivateHandle,JointReactivateHandle,JointBackgroundHandle,JointForegroundHandle;
#if WITH_DEV_AUTOMATION_TESTS
    int32 JointClockFocusOverride = -1;
#endif
    TUniquePtr<VWJoint::Dynamics> JointDynamics;
    TArray<FVirtualWorldCadBinding> CadBindings;
    USceneComponent* CadModelRoot = nullptr;
    UProceduralMeshComponent* PrincipleMesh = nullptr;
    USceneComponent* PrincipleArmature = nullptr;
    bool bRollingMarkers = false;
    bool bPrinciple = false;
    double JointTimeScale = 1;
    double KinematicOffset = 0;
    double PrincipleMinGap = 0;
    double InputAngle = 0;
    float Rpm = 6;
    float Explosion = 0;
    float PlayerHeight = 160;
    float PlayerRadius = 23;
    float InteractionRemaining = 0;
    bool bRunning = false;
    bool bPaused = false;
    bool bSection = false;
    bool bHasBrake = false;
    bool bBrakeInstalled = false;
    bool bBrakePowered = true;
    bool bSmokeRequested = false;
    bool bSmokeFinished = false;
    FVector PlayerFeet = FVector::ZeroVector;
    FVector PlayerUp = FVector::UpVector;
    FVector PlayerForward = FVector::ForwardVector;
    FVector CameraTarget = FVector::ZeroVector;
    FVector CameraOffset = FVector(400,400,300);
    FVector CameraUp = FVector::UpVector;
    float InspectionZoomMin = .02f;
    float InspectionZoomMax = 5000.f;
    UPROPERTY() TArray<TObjectPtr<AActor>> SpawnedActors;
    UPROPERTY() TArray<TObjectPtr<USceneComponent>> SceneComponents;
    UPROPERTY() TMap<FString, TObjectPtr<UglTFRuntimeAsset>> AssetCache;
    UPROPERTY() TObjectPtr<AVirtualWorldModel> PlayerModel;
    UPROPERTY() TObjectPtr<USceneComponent> PlayerRoot;
    UPROPERTY() TObjectPtr<ACameraActor> Camera;
    UPROPERTY() TArray<TObjectPtr<USkeletalMeshComponent>> MorphComponents;
};

UCLASS()
class VIRTUALWORLD_API AVirtualWorldGameMode : public AGameModeBase
{
    GENERATED_BODY()
public:
    AVirtualWorldGameMode();
    virtual void StartPlay() override;
};

UCLASS()
class VIRTUALWORLD_API AVirtualWorldHUD : public AHUD
{
    GENERATED_BODY()
public:
    virtual void DrawHUD() override;
    virtual void NotifyHitBoxClick(FName BoxName) override;
private:
    AVirtualWorldRuntime* Runtime() const;
    float PanelScroll = 0;
    float ContentHeight = 0;
    int32 LastScene = INDEX_NONE;
};
