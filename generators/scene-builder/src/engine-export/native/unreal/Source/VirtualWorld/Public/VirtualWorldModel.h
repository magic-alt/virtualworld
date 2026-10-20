#pragma once
#include "CoreMinimal.h"
#include "glTFRuntimeAssetActor.h"
#include "VirtualWorldModel.generated.h"

/** Full glTF hierarchy and original clips, with an explicit authored playback clock. */
UCLASS()
class VIRTUALWORLD_API AVirtualWorldModel : public AglTFRuntimeAssetActor
{
    GENERATED_BODY()
public:
    AVirtualWorldModel();
    virtual void Tick(float DeltaSeconds) override;
    bool PlayClip(const FString& Name, bool bLoop = true, float Speed = 1.f);
    bool HasSkeletalClip(const FString& Name) const;
    float ClipDuration(const FString& Name) const;
    void PausePlayback(bool bPaused);
private:
    bool bCurvePlaying = false;
    bool bCurveLoop = true;
    bool bPlaybackPaused = false;
    double CurveTime = 0;
    float CurveSpeed = 1;
};
