#include "VirtualWorldModel.h"
#include "glTFRuntimeAnimationCurve.h"
#include "Animation/AnimSequence.h"
#include "Components/SkeletalMeshComponent.h"

AVirtualWorldModel::AVirtualWorldModel()
{
    bAutoPlayAnimations = false;
    bLoadAllSkeletalAnimations = true;
    bAllowNodeAnimations = true;
    bAllowSkeletalAnimations = true;
    bAllowCameras = false;
    bAllowLights = false;
    bStaticMeshesAsSkeletalOnMorphTargets = true;
    SkeletalMeshConfig.bDisableMorphTargets = false;
    SkeletalMeshConfig.bIgnoreEmptyMorphTargets = false;
    SkeletalMeshConfig.MorphTargetsDuplicateStrategy = EglTFRuntimeMorphTargetsDuplicateStrategy::Merge;
    // Collision settings and component outers must not leak between differently bound instances.
    StaticMeshConfig.CacheMode = EglTFRuntimeCacheMode::None;
    SkeletalMeshConfig.CacheMode = EglTFRuntimeCacheMode::None;
}

bool AVirtualWorldModel::HasSkeletalClip(const FString& Name) const
{
    TArray<USkeletalMeshComponent*> Components;
    GetComponents<USkeletalMeshComponent>(Components);
    for (USkeletalMeshComponent* Component : Components)
        if (GetSkeletalAnimationByName(Component, Name)) return true;
    return false;
}

float AVirtualWorldModel::ClipDuration(const FString& Name) const
{
    float Duration = 0;
    TArray<USkeletalMeshComponent*> Components;
    GetComponents<USkeletalMeshComponent>(Components);
    for (USkeletalMeshComponent* Component : Components)
        if (UAnimSequence* Clip = GetSkeletalAnimationByName(Component, Name)) Duration = FMath::Max(Duration, Clip->GetPlayLength());
    return Duration;
}

bool AVirtualWorldModel::PlayClip(const FString& Name, bool bLoop, float Speed)
{
    bool bFound = false;
    TArray<USkeletalMeshComponent*> Components;
    GetComponents<USkeletalMeshComponent>(Components);
    for (USkeletalMeshComponent* Component : Components)
    {
        if (UAnimSequence* Clip = GetSkeletalAnimationByName(Component, Name))
        {
            Component->PlayAnimation(Clip, bLoop);
            Component->SetPlayRate(FMath::Clamp(Speed, 0.f, 10.f));
            Component->bPauseAnims = bPlaybackPaused;
            bFound = true;
        }
    }
    bCurvePlaying = DiscoveredCurveAnimationsNames.Contains(Name);
    if (bCurvePlaying)
    {
        SetCurveAnimationByName(Name);
        bCurveLoop = bLoop;
        CurveSpeed = FMath::Clamp(Speed, 0.f, 10.f);
        CurveTime = 0;
        bFound = true;
    }
    return bFound;
}

void AVirtualWorldModel::PausePlayback(bool bPaused)
{
    bPlaybackPaused = bPaused;
    TArray<USkeletalMeshComponent*> Components;
    GetComponents<USkeletalMeshComponent>(Components);
    for (USkeletalMeshComponent* Component : Components) Component->bPauseAnims = bPaused;
}

void AVirtualWorldModel::Tick(float DeltaSeconds)
{
    // Replace the plugin's always-looping curve clock; skeletal components keep their native ticks.
    AActor::Tick(DeltaSeconds);
    if (!bCurvePlaying || bPlaybackPaused) return;
    CurveTime += FMath::Max(0.f, DeltaSeconds) * CurveSpeed;
    for (const TPair<USceneComponent*, UglTFRuntimeAnimationCurve*>& Pair : CurveBasedAnimations)
    {
        if (!Pair.Key || !Pair.Value) continue;
        const double Duration = Pair.Value->glTFCurveAnimationDuration;
        const float Time = Duration > 0 ? static_cast<float>(bCurveLoop ? FMath::Fmod(CurveTime, Duration) : FMath::Min(CurveTime, Duration)) : 0.f;
        Pair.Key->SetRelativeTransform(Pair.Value->GetTransformValue(Time));
    }
}
